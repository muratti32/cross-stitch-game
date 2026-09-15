import { IsBoolean } from 'class-validator';

export class SetPatternPaidDto {
  @IsBoolean()
  paid!: boolean;
}
