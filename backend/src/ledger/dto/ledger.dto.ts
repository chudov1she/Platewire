import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class CaptureDecisionDto {
  @IsOptional()
  @IsString()
  track?: string;

  @IsOptional()
  @IsBoolean()
  force?: boolean;

  @IsOptional()
  @IsBoolean()
  allowUnlocked?: boolean;
}

export class PatchLedgerEntryDto {
  @IsBoolean()
  excludedFromStats!: boolean;
}
