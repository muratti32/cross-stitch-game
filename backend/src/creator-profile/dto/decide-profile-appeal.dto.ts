import { IsString, MaxLength, MinLength } from 'class-validator';

export class AcceptCreatorRestrictionAppealDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  reason!: string;
}

export class UpholdCreatorRestrictionAppealDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  reason!: string;
}
