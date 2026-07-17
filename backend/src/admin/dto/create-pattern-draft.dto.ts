import { Transform } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

function toInteger(value: unknown): unknown {
  return typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
}

export class CreatePatternDraftDto {
  @Transform(({ value }: { value: unknown }) => toInteger(value))
  @IsInt()
  @Min(20)
  @Max(300)
  shortEdgeCells!: number;

  @Transform(({ value }: { value: unknown }) => toInteger(value))
  @IsInt()
  @Min(5)
  @Max(60)
  maxColors!: number;
}
