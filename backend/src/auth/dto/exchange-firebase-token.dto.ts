import { IsJWT, IsString, MaxLength } from 'class-validator';

export class ExchangeFirebaseTokenDto {
  @IsJWT()
  @IsString()
  @MaxLength(10_000)
  idToken!: string;
}
