import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Length, Min, ValidateNested } from 'class-validator';

export type GameplayEventKind = 'stitch_action' | 'color_completion';

export class GameplayEventDto {
  @IsUUID() eventId!: string;
  @IsIn(['stitch_action', 'color_completion']) kind!: GameplayEventKind;
  @IsUUID() sessionId!: string;
  @IsString() @Length(1, 16) dmcCode!: string;
  @IsInt() @Min(0) clientSeq!: number;
  @IsOptional() @IsISO8601() occurredAt?: string;
}

export class IngestEventsDto {
  @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => GameplayEventDto)
  events!: GameplayEventDto[];
}
