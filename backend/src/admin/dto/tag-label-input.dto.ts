import { IsString, Length } from 'class-validator';

export class TagLabelInputDto {
  @IsString()
  @Length(2, 8)
  locale!: string;

  @IsString()
  @Length(1, 255)
  label!: string;
}
