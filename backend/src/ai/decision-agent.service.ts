import { Injectable, Logger } from '@nestjs/common';
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { END, MessagesAnnotation, START, StateGraph } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { FormulaRunnerService } from '../formula/formula-runner.service.js';
import { FormulaStoreService } from '../formula/formula-store.service.js';
import { MatchupInputsService } from '../formula/matchup-inputs.service.js';
import { MarketLoaderService } from '../formula/market-loader.service.js';
import { SignalReadinessService } from '../formula/signal-readiness.service.js';
import type { ReadinessResult } from '../formula/signal-readiness.service.js';
import { LedgerAnalyticsService } from '../ledger/ledger-analytics.service.js';
import type { After5Analysis } from '../formula/formula.types.js';
import { AiModelProvider } from './ai-model.provider.js';
import { buildDecisionBrief, DECISION_SYSTEM_PROMPT } from './decision-prompt.js';
import { buildDecisionTools, type CapturedDecision } from './decision-tools.js';
import {
  AiDecisionOutputSchema,
  ALLOWED_BET_MARKETS,
  validateDecisionAgainstAnalysis,
  type AiDecisionOutput,
} from './decision-schema.js';
import { computeStakeUnits } from './stake-sizing.js';

export type DecisionAgentResult = {
  decision: AiDecisionOutput;
  matched: {
    decimal_odds: number;
    value_pct: number;
    roi_pct: number;
    model_prob: number;
    line: number | null;
  } | null;
  stakeUnits: number | null;
  analysis: After5Analysis;
  formulaVersionId: string;
  formulaVersionLabel: string;
  readiness: ReadinessResult;
  matchup: string;
  trace: {
    model: string;
    latencyMs: number;
    promptJson: unknown;
    rawOutputJson: unknown;
  };
};

const FAIL_SAFE_PASS = (reason: string, extraFlags: string[] = []): AiDecisionOutput => ({
  action: 'pass',
  market: null,
  side: null,
  line: null,
  confidence_tier: null,
  risk_flags: ['fail_safe', ...extraFlags],
  rationale: reason,
  notify_brief: reason.length > 400 ? `${reason.slice(0, 397)}…` : reason,
});

/**
 * The Decision agent: one LLM call-loop per (gameId, track) that turns the
 * deterministic FormulaSpec output + full match context into a single
 * auditable bet/pass decision. This is the "strong analyst who would really
 * stake money" — Formula, AI and Ledger meet here.
 */
@Injectable()
export class DecisionAgentService {
  private readonly logger = new Logger(DecisionAgentService.name);

  constructor(
    private readonly modelProvider: AiModelProvider,
    private readonly store: FormulaStoreService,
    private readonly runner: FormulaRunnerService,
    private readonly matchup: MatchupInputsService,
    private readonly markets: MarketLoaderService,
    private readonly readiness: SignalReadinessService,
    private readonly analytics: LedgerAnalyticsService,
  ) {}

  async decide(
    gameId: string,
    track: string,
    matchupLabel: string,
  ): Promise<DecisionAgentResult> {
    const production = await this.store.getProduction();
    const built = await this.matchup.build(gameId);
    const marketLoad = await this.markets.load(gameId, track);
    const gate = this.readiness.evaluate({
      track,
      input_sources: built.input_sources,
      market: marketLoad,
      context: built.context,
    });
    const analysis = this.runner.analyze(built.inputs, marketLoad.markets, production.spec);
    const pool = [...analysis.signals, ...analysis.value_bets].filter((b) =>
      ALLOWED_BET_MARKETS.has(b.market),
    );

    if (!gate.ready) {
      const decision = FAIL_SAFE_PASS(
        `Данные недостаточно готовы для решения (hard gaps: ${gate.hardGaps.join(', ')}).`,
        ['not_ready'],
      );
      return {
        decision,
        matched: null,
        stakeUnits: null,
        analysis,
        formulaVersionId: production.versionId,
        formulaVersionLabel: production.versionLabel,
        readiness: gate,
        matchup: matchupLabel,
        trace: {
          model: 'none',
          latencyMs: 0,
          promptJson: { skipped: 'not_ready', hardGaps: gate.hardGaps },
          rawOutputJson: { decision },
        },
      };
    }

    const calibrationStats = await this.analytics.stats(14);
    const brief = buildDecisionBrief({
      gameId,
      track,
      matchup: matchupLabel,
      inputs: built.inputs,
      analysis,
      readiness: gate,
      formulaVersionLabel: production.versionLabel,
      calibration: {
        days: calibrationStats.days,
        n: calibrationStats.total,
        winrate: calibrationStats.winrate,
        roiPct: calibrationStats.roiPct,
        byConfidence: calibrationStats.byConfidence,
      },
    });

    const out: CapturedDecision = { value: null };
    const tools = buildDecisionTools(
      {
        matchup: this.matchup,
        markets: this.markets,
        runner: this.runner,
        readiness: this.readiness,
        analytics: this.analytics,
        gameId,
        track,
        spec: production.spec,
      },
      out,
    );

    const model = this.modelProvider.build('decision').bindTools(tools);
    const toolNode = new ToolNode(tools);
    const maxRounds = this.modelProvider.maxToolRounds();
    let rounds = 0;

    const system = new SystemMessage(DECISION_SYSTEM_PROMPT);
    const human = new HumanMessage(brief);

    const graph = new StateGraph(MessagesAnnotation)
      .addNode('agent', async (state) => {
        const response = await model.invoke(state.messages);
        return { messages: [response] };
      })
      .addNode('tools', toolNode)
      .addEdge(START, 'agent')
      .addConditionalEdges('agent', (state) => {
        if (out.value) return END;
        const last = state.messages[state.messages.length - 1];
        if (AIMessage.isInstance(last) && last.tool_calls && last.tool_calls.length > 0 && rounds < maxRounds) {
          rounds += 1;
          return 'tools';
        }
        return END;
      })
      .addEdge('tools', 'agent')
      .compile();

    const startedAt = Date.now();
    let result;
    try {
      result = await graph.invoke({ messages: [system, human] });
    } catch (err) {
      this.logger.error(
        `decision agent invoke failed game=${gameId} track=${track}: ${err instanceof Error ? err.message : err}`,
      );
      const decision = FAIL_SAFE_PASS(
        'AI-вызов завершился ошибкой; безопасный fallback на pass.',
        ['agent_error'],
      );
      return {
        decision,
        matched: null,
        stakeUnits: null,
        analysis,
        formulaVersionId: production.versionId,
        formulaVersionLabel: production.versionLabel,
        readiness: gate,
        matchup: matchupLabel,
        trace: {
          model: this.modelProvider.modelName('decision'),
          latencyMs: Date.now() - startedAt,
          promptJson: { system: DECISION_SYSTEM_PROMPT, brief },
          rawOutputJson: { error: err instanceof Error ? err.message : String(err) },
        },
      };
    }
    const latencyMs = Date.now() - startedAt;

    let decision: AiDecisionOutput;
    const parsed = out.value ? AiDecisionOutputSchema.safeParse(out.value) : null;
    if (parsed?.success) {
      decision = parsed.data;
    } else {
      decision = FAIL_SAFE_PASS(
        'ИИ не вызвал record_decision с корректной структурой; безопасный fallback на pass.',
        ['no_decision_recorded'],
      );
    }

    const validation = validateDecisionAgainstAnalysis(decision, pool);
    let matched: DecisionAgentResult['matched'] = null;
    if (!validation.ok) {
      decision = FAIL_SAFE_PASS(
        `${decision.rationale} [Отклонено валидацией: ${validation.reason}]`,
        ['invalid_ai_output', validation.reason],
      );
    } else {
      matched = validation.matched.decimal_odds > 0 ? validation.matched : null;
    }

    const stakeUnits =
      decision.action === 'bet' && matched ? computeStakeUnits() : null;

    const rawOutputJson = {
      toolsUsed: result.messages
        .filter((m) => AIMessage.isInstance(m))
        .flatMap((m) => (m as AIMessage).tool_calls?.map((tc) => tc.name) ?? []),
      messages: result.messages.map((m) => ({
        role: m.getType?.() ?? 'unknown',
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        toolCalls: AIMessage.isInstance(m) ? m.tool_calls : undefined,
        toolCallId: ToolMessage.isInstance(m) ? m.tool_call_id : undefined,
      })),
      finalDecision: decision,
    };

    return {
      decision,
      matched,
      stakeUnits,
      analysis,
      formulaVersionId: production.versionId,
      formulaVersionLabel: production.versionLabel,
      readiness: gate,
      matchup: matchupLabel,
      trace: {
        model: this.modelProvider.modelName('decision'),
        latencyMs,
        promptJson: { system: DECISION_SYSTEM_PROMPT, brief },
        rawOutputJson,
      },
    };
  }
}
