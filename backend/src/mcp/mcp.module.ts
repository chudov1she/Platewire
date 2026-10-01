import { Logger, Module, type DynamicModule } from '@nestjs/common';
import { ContextModule } from '../context/context.module.js';
import { GamesModule } from '../games/games.module.js';
import { OddsModule } from '../odds/odds.module.js';
import { PackModule } from '../pack/pack.module.js';
import { PipelineModule } from '../pipeline/pipeline.module.js';
import { OfficeModule } from '../office/office.module.js';
import { CollectorSearchService } from './collector-search.service.js';
import { McpController } from './mcp.controller.js';
import { McpTokenGuard } from './mcp-token.guard.js';
import { PlatewireMcpService } from './platewire-mcp.service.js';

@Module({})
export class McpModule {
  static register(): DynamicModule {
    const enabled = Boolean(process.env.MCP_SERVICE_TOKEN?.trim());
    if (!enabled) {
      Logger.warn(
        'MCP_SERVICE_TOKEN is empty — /mcp/:token is not mounted',
        McpModule.name,
      );
    }
    return {
      module: McpModule,
      imports: [
        GamesModule,
        PackModule,
        ContextModule,
        OddsModule,
        PipelineModule,
        OfficeModule,
      ],
      controllers: enabled ? [McpController] : [],
      providers: [CollectorSearchService, PlatewireMcpService, McpTokenGuard],
    };
  }
}
