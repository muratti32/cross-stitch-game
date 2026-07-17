import { ArrayUnique, IsArray, IsUUID } from 'class-validator';

export class ReplaceStaffPicksDto {
  // Ordered list of Pattern ids; position is the array index + 1. An empty
  // array clears all Staff Picks. Replacement is one atomic batch operation.
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  patternIds!: string[];
}
