import { IsBoolean, IsNumber, IsObject, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

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

export class FormulaBacktestDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(90)
  days?: number;

  @IsOptional()
  @IsString()
  track?: string;

  @IsOptional()
  @IsUUID()
  versionId?: string;

  @IsOptional()
  @IsObject()
  spec?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  patch?: Record<string, unknown>;

  @IsOptional()
  @IsUUID()
  fromVersionId?: string;
}

