import { IsEmail, IsString, MaxLength } from 'class-validator';

export class RequestEmailOtpDto {
  @IsEmail()
  @IsString()
  @MaxLength(254)
  email!: string;
}
