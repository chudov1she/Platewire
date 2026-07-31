import { Injectable, Logger } from '@nestjs/common';
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { END, MemorySaver, MessagesAnnotation, START, StateGraph } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { FormulaStoreService } from '../formula/formula-store.service.js';
import { LedgerAnalyticsService } from '../ledger/ledger-analytics.service.js';
import { LedgerBacktestService } from '../ledger/ledger-backtest.service.js';
import { AiModelProvider } from './ai-model.provider.js';
import { AgentProposalService } from './agent-proposal.service.js';
import { CURATION_SYSTEM_PROMPT } from './curation-prompt.js';
import { buildCurationTools } from './curation-tools.js';

const DEFAULT_TASK =
  'Проанализируй эффективность продакшн-формулы за последние 14 дней по ledger. ' +
  'Если есть статистически обоснованная гипотеза для точечного улучшения FormulaSpec — ' +
  'сделай backtest_patch и, если он подтверждает пользу, вызови propose_formula_patch. ' +
  'Если оснований для изменений нет — прямо скажи об этом и ничего не предлагай.';

/**
 * The Curation agent: a slower, analytical loop that reviews aggregate
 * ledger performance and may propose (never activate) FormulaSpec patches.
 */
@Injectable()
export class CurationAgentService {
  private readonly logger = new Logger(CurationAgentService.name);

  constructor(
    private readonly modelProvider: AiModelProvider,
    private readonly store: FormulaStoreService,
    private readonly analytics: LedgerAnalyticsService,
    private readonly backtest: LedgerBacktestService,
    private readonly proposals: AgentProposalService,
  ) {}

  async run(prompt?: string): Promise<{ message: string; toolsUsed: string[] }> {
    const tools = buildCurationTools({
      store: this.store,
      analytics: this.analytics,
      backtest: this.backtest,
      proposals: this.proposals,
    });
    const model = this.modelProvider.build('curation').bindTools(tools);
    const toolNode = new ToolNode(tools);
    const toolsUsed: string[] = [];
    const maxRounds = this.modelProvider.maxToolRounds() * 2;

    const system = new SystemMessage(CURATION_SYSTEM_PROMPT);
    const human = new HumanMessage(prompt?.trim() || DEFAULT_TASK);

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

    let result;
    try {
      result = await graph.invoke(
        { messages: [system, human] },
        { configurable: { thread_id: `curation-${Date.now()}` } },
      );
    } catch (err) {
      this.logger.error(`curation agent failed: ${err instanceof Error ? err.message : err}`);
      return { message: `Curation agent error: ${err instanceof Error ? err.message : err}`, toolsUsed };
    }

    const last = result.messages[result.messages.length - 1];
    const message =
      typeof last.content === 'string' ? last.content : JSON.stringify(last.content);
    return { message, toolsUsed: [...new Set(toolsUsed)] };
  }
}
