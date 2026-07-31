import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class LoginDto {
  @ApiProperty()
  @IsString()
  login!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  password!: string;

  @ApiPropertyOptional({
    description:
      'When true, issues a longer-lived JWT (JWT_REMEMBER_EXPIRES_IN). Frontend stores in localStorage.',
  })
  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}

export class TelegramLoginDto {
  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  id!: number;

  @ApiProperty()
  @IsString()
  first_name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  last_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  username?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  photo_url?: string;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  auth_date!: number;

  @ApiProperty()
  @IsString()
  hash!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}

export class TelegramWebAppLoginDto {
  @ApiProperty({
    description: 'Raw Telegram.WebApp.initData query string',
  })
  @IsString()
  @MinLength(1)
  initData!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}
