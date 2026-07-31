import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CurationAgentService } from './curation-agent.service.js';
import { AiModelProvider } from './ai-model.provider.js';

/** Runs the curation agent on a daily cadence so formula drift gets reviewed without manual triggering. */
@Injectable()
export class CurationScheduler {
  private readonly logger = new Logger(CurationScheduler.name);

  constructor(
    private readonly curation: CurationAgentService,
    private readonly modelProvider: AiModelProvider,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_NOON)
  async runDaily(): Promise<void> {
    if (!this.modelProvider.enabled()) return;
    if ((this.config.get<string>('AI_CURATION_CRON_ENABLED') ?? 'true').toLowerCase() !== 'true') {
      return;
    }
    try {
      const result = await this.curation.run();
      this.logger.log(`curation daily run ok tools=${result.toolsUsed.join(',')}`);
    } catch (err) {
      this.logger.error(`curation daily run failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}
