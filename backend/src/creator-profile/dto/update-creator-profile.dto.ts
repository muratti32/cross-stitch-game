import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

function optionalBoolean(value: unknown): unknown {
  if (value === undefined || value === '') return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

export class UpdateCreatorProfileDto {
  @IsOptional()
  @IsString()
  @Length(1, 50)
  displayName?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => optionalBoolean(value))
  @IsBoolean()
  removeAvatar?: boolean;
}
