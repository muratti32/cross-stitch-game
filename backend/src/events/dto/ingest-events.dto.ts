import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsISO8601,
  IsObject,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class IngestGameplayEventDto {
  @IsUUID()
  eventId!: string;

  @IsISO8601()
  occurredAt!: string;

  @IsString()
  kind!: string;

  @IsObject()
  payload!: Record<string, unknown>;
}

export class IngestGameplayEventsDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => IngestGameplayEventDto)
  events!: IngestGameplayEventDto[];
}
