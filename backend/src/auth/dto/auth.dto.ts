import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

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
      'When true, issues a longer-lived JWT (JWT_REMEMBER_EXPIRES_IN).',
  })
  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}
