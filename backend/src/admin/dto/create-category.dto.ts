import { IsString, Length, Matches } from 'class-validator';

export class CreateCategoryDto {
  @IsString()
  @Length(1, 64)
  @Matches(/^[a-z0-9-]+$/, {
    message: 'code must be lowercase letters, digits, and hyphens only',
  })
  code!: string;

  @IsString()
  @Length(1, 255)
  label!: string;
}
