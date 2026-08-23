import { IsString, MinLength } from 'class-validator';

export class ReauthenticateFirebaseDto {
  @IsString()
  @MinLength(16)
  idToken!: string;
}
