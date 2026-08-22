import { IsJWT, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class ExchangeFirebaseTokenDto {
  @IsJWT()
  @IsString()
  @MaxLength(10_000)
  idToken!: string;
  @IsOptional() @IsUUID() guestId?: string;
  @IsOptional() @IsString() @MaxLength(512) guestCredential?: string;
}
