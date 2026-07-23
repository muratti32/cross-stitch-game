import { IsString, Length, Matches } from 'class-validator';

export class CreateCreatorProfileDto {
  @IsString()
  @Length(3, 30)
  @Matches(/^[A-Za-z0-9_]+$/)
  username!: string;

  @IsString()
  @Length(1, 50)
  displayName!: string;
}
