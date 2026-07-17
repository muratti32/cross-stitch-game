import { IsOptional, IsString, Length, Matches } from 'class-validator';

export class OperatorMfaDto {
  @IsString()
  @Length(1, 512)
  challenge!: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'totpCode must be a 6-digit code' })
  totpCode?: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  recoveryCode?: string;
}
