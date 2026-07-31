import { Module } from '@nestjs/common';
import { FormulaModule } from '../formula/formula.module.js';
import { GamesModule } from '../games/games.module.js';
import { LedgerAnalyticsModule } from '../ledger/ledger-analytics.module.js';
import { AiController } from './ai.controller.js';
import { AiModelProvider } from './ai-model.provider.js';
import { AgentChatController } from './agent-chat.controller.js';
import { AgentChatService } from './agent-chat.service.js';
import { AgentProposalService } from './agent-proposal.service.js';
import { DecisionAgentService } from './decision-agent.service.js';
import { CurationAgentService } from './curation-agent.service.js';
import { CurationScheduler } from './curation.scheduler.js';

@Module({
  imports: [FormulaModule, GamesModule, LedgerAnalyticsModule],
  controllers: [AiController, AgentChatController],
  providers: [
    AiModelProvider,
    AgentProposalService,
    DecisionAgentService,
    CurationAgentService,
    CurationScheduler,
    AgentChatService,
  ],
  exports: [
    AiModelProvider,
    AgentProposalService,
    DecisionAgentService,
    CurationAgentService,
    AgentChatService,
  ],
})
export class AiModule {}
