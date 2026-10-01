import { timingSafeEqual } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

@Injectable()
export class McpTokenGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>('MCP_SERVICE_TOKEN')?.trim() ?? '';
    if (!expected) {
      throw new UnauthorizedException('MCP service token is not configured');
    }

    const req = context.switchToHttp().getRequest<Request>();
    const raw = req.params?.token;
    const token = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? '';
    const provided = Buffer.from(token);
    const wanted = Buffer.from(expected);
    if (provided.length !== wanted.length || !timingSafeEqual(provided, wanted)) {
      throw new UnauthorizedException('Invalid MCP service token');
    }
    return true;
  }
}
