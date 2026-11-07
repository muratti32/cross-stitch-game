import { Type } from 'class-transformer';
import {
  IsArray,
  IsBase64,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import type { CellStateValue } from './progress-merge';

export class IncomingProgressOperationDto {
  @IsUUID()
  opId!: string;

  @IsInt()
  @Min(0)
  deviceSeq!: number;

  @IsInt()
  @Min(0)
  cellIndex!: number;

  @IsIn(['completed', 'incomplete'])
  desiredState!: CellStateValue;

  @IsInt()
  @Min(0)
  baseRevision!: number;
}

export class ProgressSyncDto {
  @IsUUID()
  deviceId!: string;

  @IsInt()
  @Min(0)
  sinceRevision!: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IncomingProgressOperationDto)
  operations!: IncomingProgressOperationDto[];
}

export class CompleteProgressDto {
  @IsUUID()
  deviceId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  completedCells?: number;
}

export class RegisterBundledSessionDto {
  @IsUUID()
  patternId!: string;

  @IsIn(['in_progress', 'completed'])
  localState!: 'in_progress' | 'completed';

  @IsOptional()
  @IsISO8601({ strict: true })
  completedAt?: string | null;

  @IsOptional()
  @IsBase64()
  @MaxLength(256)
  packedBitmapBase64?: string | null;
}
