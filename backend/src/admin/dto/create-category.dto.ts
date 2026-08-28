import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsString, Length, Matches, ValidateNested } from 'class-validator';
import { CategoryLabelInputDto } from './category-label-input.dto';

export class CreateCategoryDto {
  @IsString()
  @Length(1, 64)
  @Matches(/^[a-z0-9-]+$/, {
    message: 'code must be lowercase letters, digits, and hyphens only',
  })
  code!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CategoryLabelInputDto)
  labels!: CategoryLabelInputDto[];
}
