import { IsString, Length } from 'class-validator';

export class UpdateCategoryLabelDto {
  @IsString()
  @Length(1, 255)
  label!: string;
}
