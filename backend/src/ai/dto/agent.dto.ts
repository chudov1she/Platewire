import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class RunCurationDto {
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  prompt?: string;
}

export class SendChatMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  message!: string;
}
