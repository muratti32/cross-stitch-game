import { IsEmail, IsString, Matches, MaxLength } from 'class-validator';

export class LinkEmailDto {
  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;

  @IsEmail()
  @IsString()
  @MaxLength(254)
  email!: string;
}
