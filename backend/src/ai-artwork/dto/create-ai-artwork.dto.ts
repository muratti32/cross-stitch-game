import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import type { ArtworkAspect } from '../entities';

export class CreateAiArtworkDto {
  @IsString() @MinLength(1) @MaxLength(2_000) prompt!: string;
  @IsIn(['square', 'portrait_4_3', 'landscape_4_3']) aspect!: ArtworkAspect;
}
