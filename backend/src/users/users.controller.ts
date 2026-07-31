import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserStatus } from '../generated/prisma/client.js';
import type { User } from '../generated/prisma/client.js';
import { CurrentUser, Statuses } from '../common/index.js';
import {
  CreateUserDto,
  UpdateCredentialsDto,
  UpdateUserStatusDto,
} from './dto/users.dto.js';
import { UsersService } from './users.service.js';

@ApiTags('users')
@ApiBearerAuth()
@Statuses(UserStatus.ADMIN)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @ApiOperation({ summary: 'Create user (admin)' })
  create(@Body() dto: CreateUserDto, @CurrentUser() admin: User) {
    return this.usersService.createByAdmin(dto, admin.id);
  }

  @Get()
  @ApiOperation({ summary: 'List users (admin)' })
  findAll() {
    return this.usersService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get user by id (admin)' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.getByIdOrThrow(id);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update user status GUEST/USER (admin)' })
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserStatusDto,
  ) {
    return this.usersService.updateStatus(id, dto);
  }

  @Patch(':id/credentials')
  @ApiOperation({ summary: 'Set login/password for user (admin)' })
  setCredentials(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCredentialsDto,
  ) {
    return this.usersService.setCredentials(id, dto);
  }
}
