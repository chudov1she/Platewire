import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { END, MemorySaver, MessagesAnnotation, START, StateGraph } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { GamesService } from '../games/games.service.js';
import { FormulaRunnerService } from '../formula/formula-runner.service.js';
import { FormulaStoreService } from '../formula/formula-store.service.js';
import { MatchupInputsService } from '../formula/matchup-inputs.service.js';
import { MarketLoaderService } from '../formula/market-loader.service.js';
import { SignalReadinessService } from '../formula/signal-readiness.service.js';
import { LedgerAnalyticsService } from '../ledger/ledger-analytics.service.js';
import { LedgerBacktestService } from '../ledger/ledger-backtest.service.js';
import { AiModelProvider } from './ai-model.provider.js';
import { AgentProposalService } from './agent-proposal.service.js';
import { buildAgentChatSystemPrompt } from './agent-chat-prompt.js';
import { buildAgentChatTools } from './agent-chat-tools.js';

const HISTORY_TURNS = 20;

/**
 * The Agent chat: a per-user, persisted conversation with the same
 * tool-loop the Curation agent uses, plus two read-only tools (list_games,
 * eval_game) so the operator can ask about specific matchups. Unlike
 * curation, this never runs on a schedule — it only responds to messages.
 */
@Injectable()
export class AgentChatService {
  private readonly logger = new Logger(AgentChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly modelProvider: AiModelProvider,
    private readonly games: GamesService,
    private readonly store: FormulaStoreService,
    private readonly runner: FormulaRunnerService,
    private readonly matchup: MatchupInputsService,
    private readonly markets: MarketLoaderService,
    private readonly readiness: SignalReadinessService,
    private readonly analytics: LedgerAnalyticsService,
    private readonly backtest: LedgerBacktestService,
    private readonly proposals: AgentProposalService,
  ) {}

  async history(userId: string, limit = 50) {
    const rows = await this.prisma.agentChatMessage.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      take: Math.min(200, Math.max(1, limit)),
    });
    return rows.map((r) => this.serialize(r));
  }

  async clear(userId: string) {
    await this.prisma.agentChatMessage.deleteMany({ where: { userId } });
    return { ok: true };
  }

  async send(
    userId: string,
    message: string,
    isAdmin: boolean,
  ): Promise<{ message: string; toolsUsed: string[] }> {
    const trimmed = message.trim();
    if (!trimmed) {
      throw new BadRequestException('Сообщение не может быть пустым');
    }

    await this.prisma.agentChatMessage.create({
      data: { userId, role: 'user', content: trimmed },
    });

    const recent = await this.prisma.agentChatMessage.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_TURNS,
    });
    const ordered = [...recent].reverse();

    const tools = buildAgentChatTools({
      games: this.games,
      store: this.store,
      runner: this.runner,
      matchup: this.matchup,
      markets: this.markets,
      readiness: this.readiness,
      analytics: this.analytics,
      backtest: this.backtest,
      proposals: this.proposals,
    });
    const model = this.modelProvider.build('curation').bindTools(tools);
    const toolNode = new ToolNode(tools);
    const toolsUsed: string[] = [];
    const maxRounds = this.modelProvider.maxToolRounds() * 2;

    const system = new SystemMessage(buildAgentChatSystemPrompt(isAdmin));
    // The last row in `ordered` is the user message we just persisted.
    const priorTurns = ordered.slice(0, -1);
    const messages = [
      system,
      ...priorTurns.map((m) =>
        m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content),
      ),
      new HumanMessage(trimmed),
    ];

    const graph = new StateGraph(MessagesAnnotation)
      .addNode('agent', async (state) => {
        const response = await model.invoke(state.messages);
        if (AIMessage.isInstance(response) && response.tool_calls?.length) {
          for (const tc of response.tool_calls) toolsUsed.push(tc.name);
        }
        return { messages: [response] };
      })
      .addNode('tools', toolNode)
      .addEdge(START, 'agent')
      .addConditionalEdges('agent', (state) => {
        const last = state.messages[state.messages.length - 1];
        if (
          AIMessage.isInstance(last) &&
          last.tool_calls &&
          last.tool_calls.length > 0 &&
          toolsUsed.length <= maxRounds
        ) {
          return 'tools';
        }
        return END;
      })
      .addEdge('tools', 'agent')
      .compile({ checkpointer: new MemorySaver() });

    let assistantText: string;
    try {
      const result = await graph.invoke(
        { messages },
        { configurable: { thread_id: `chat-${userId}-${Date.now()}` } },
      );
      const last = result.messages[result.messages.length - 1];
      assistantText =
        typeof last.content === 'string' ? last.content : JSON.stringify(last.content);
    } catch (err) {
      this.logger.error(
        `agent chat failed user=${userId}: ${err instanceof Error ? err.message : err}`,
      );
      assistantText = `Не удалось получить ответ от ИИ: ${err instanceof Error ? err.message : String(err)}`;
    }

    const uniqueTools = [...new Set(toolsUsed)];
    await this.prisma.agentChatMessage.create({
      data: {
        userId,
        role: 'assistant',
        content: assistantText,
        toolsUsedJson: uniqueTools as unknown as Prisma.InputJsonValue,
      },
    });

    return { message: assistantText, toolsUsed: uniqueTools };
  }

  private serialize(row: {
    id: string;
    role: string;
    content: string;
    toolsUsedJson: unknown;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      role: row.role,
      content: row.content,
      toolsUsed: Array.isArray(row.toolsUsedJson) ? (row.toolsUsedJson as string[]) : [],
      createdAt: row.createdAt.toISOString(),
    };
  }
}
