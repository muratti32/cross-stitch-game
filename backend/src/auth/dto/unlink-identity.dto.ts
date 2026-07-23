import { IsIn, IsString, MaxLength } from 'class-validator';

export class UnlinkIdentityDto {
  @IsIn(['apple', 'email', 'google'])
  @IsString()
  provider!: 'apple' | 'email' | 'google';

  @IsString()
  @MaxLength(254)
  subject!: string;
}
