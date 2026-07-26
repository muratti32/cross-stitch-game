import { IsString, MaxLength, MinLength } from 'class-validator';

export class RejectSafetyRemovalAppealDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  reason!: string;
}
