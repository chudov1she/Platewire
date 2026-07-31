import { Body, Controller, Delete, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserStatus, type User } from '../generated/prisma/client.js';
import { CurrentUser } from '../common/index.js';
import { AgentChatService } from './agent-chat.service.js';
import { SendChatMessageDto } from './dto/agent.dto.js';

@ApiTags('agent')
@ApiBearerAuth()
@Controller('agent/chat')
export class AgentChatController {
  constructor(private readonly chat: AgentChatService) {}

  @Get()
  @ApiOperation({ summary: 'Chat history with the AI desk agent (current user only)' })
  history(@CurrentUser() user: User, @Query('limit') limit?: string) {
    const n = limit ? Number(limit) : 50;
    return this.chat.history(user.id, Number.isFinite(n) ? n : 50);
  }

  @Post()
  @ApiOperation({ summary: 'Send a message to the AI desk agent (tool-loop over games/formula/ledger)' })
  send(@CurrentUser() user: User, @Body() body: SendChatMessageDto) {
    return this.chat.send(user.id, body.message, user.status === UserStatus.ADMIN);
  }

  @Delete()
  @ApiOperation({ summary: 'Clear chat history for the current user' })
  clear(@CurrentUser() user: User) {
    return this.chat.clear(user.id);
  }
}
