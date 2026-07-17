import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class OperatorLoginDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  password!: string;
}
