import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, ValidateNested } from 'class-validator';
import { CategoryLabelInputDto } from './category-label-input.dto';

export class UpdateCategoryLabelsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CategoryLabelInputDto)
  labels!: CategoryLabelInputDto[];
}
