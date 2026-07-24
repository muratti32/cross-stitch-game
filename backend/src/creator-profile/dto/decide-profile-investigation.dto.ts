import { IsString, MaxLength, MinLength } from 'class-validator';

export class CloseProfileInvestigationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  reason!: string;
}

export class RemediateProfileInvestigationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  reason!: string;
}

export class ResetProfileUsernameDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  reason!: string;
}
