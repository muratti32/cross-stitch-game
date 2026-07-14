import { IsEmail, IsString, Matches, MaxLength } from 'class-validator';

export class VerifyEmailOtpDto {
  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;

  @IsEmail()
  @IsString()
  @MaxLength(254)
  email!: string;
}
