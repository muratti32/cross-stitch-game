import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateSafetyRemovalAppealDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
