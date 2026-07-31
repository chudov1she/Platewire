import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { UserStatus } from '../../generated/prisma/client.js';

export class CreateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  login?: string;

  @ApiPropertyOptional({ minLength: 6 })
  @ValidateIf((dto: CreateUserDto) => dto.login !== undefined)
  @IsString()
  @MinLength(6)
  password?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  telegramId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  telegramUsername?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  displayName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsUrl(
    { require_protocol: true },
    { message: 'avatarUrl must be a valid URL' },
  )
  avatarUrl?: string;

  @ApiPropertyOptional({ enum: [UserStatus.GUEST, UserStatus.USER] })
  @IsOptional()
  @IsIn([UserStatus.GUEST, UserStatus.USER])
  status?: Extract<UserStatus, 'GUEST' | 'USER'>;
}

export class UpdateUserStatusDto {
  @ApiProperty({ enum: [UserStatus.GUEST, UserStatus.USER] })
  @IsIn([UserStatus.GUEST, UserStatus.USER])
  status!: Extract<UserStatus, 'GUEST' | 'USER'>;
}

export class UpdateCredentialsDto {
  @ApiProperty()
  @IsString()
  login!: string;

  @ApiProperty({ minLength: 6 })
  @IsString()
  @MinLength(6)
  password!: string;
}
