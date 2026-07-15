import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsUUID,
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
}
