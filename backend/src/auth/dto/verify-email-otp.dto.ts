import { IsEmail, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

export class VerifyEmailOtpDto {
  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;

  @IsEmail()
  @IsString()
  @MaxLength(254)
  email!: string;
  @IsOptional() @IsUUID() guestId?: string;
  @IsOptional() @IsString() @MaxLength(512) guestCredential?: string;
}
