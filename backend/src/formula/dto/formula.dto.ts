import {
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateFormulaVersionDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  versionLabel?: string;

  @IsOptional()
  @IsObject()
  spec?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  patch?: Record<string, unknown>;

  @IsOptional()
  @IsUUID()
  fromVersionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsBoolean()
  activate?: boolean;
}

export class PutProductionDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  versionLabel?: string;

  @IsOptional()
  @IsObject()
  spec?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  patch?: Record<string, unknown>;

  @IsOptional()
  @IsUUID()
  fromVersionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class ValidateFormulaDto {
  @IsObject()
  spec!: Record<string, unknown>;
}

export class EvalFormulaDto {
  @IsOptional()
  @IsString()
  track?: string;

  @IsOptional()
  @IsUUID()
  versionId?: string;

  @IsOptional()
  @IsObject()
  spec?: Record<string, unknown>;
}
