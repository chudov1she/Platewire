import { All, Controller, Req, Res, UseGuards } from '@nestjs/common';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';
import { Public } from '../common/index.js';
import { McpTokenGuard } from './mcp-token.guard.js';
import { PlatewireMcpService } from './platewire-mcp.service.js';

@Controller('mcp/:token')
@Public()
@UseGuards(McpTokenGuard)
export class McpController {
  constructor(private readonly mcp: PlatewireMcpService) {}

  @All()
  async handle(@Req() req: Request, @Res() res: Response): Promise<void> {
    const server = this.mcp.createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      void transport.close().catch(() => undefined);
      void server.close().catch(() => undefined);
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }
}
