import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class ApproveAiArtworkDto {
  @IsString() @MaxLength(120) title!: string;
  @IsIn(['easy', 'standard', 'detailed', 'custom']) profile!: 'easy' | 'standard' | 'detailed' | 'custom';
  @IsOptional() @IsInt() @Min(20) @Max(300) shortEdgeCells?: number;
  @IsOptional() @IsInt() @Min(5) @Max(60) maxColors?: number;
}
