import { Column, Entity, PrimaryColumn } from 'typeorm';

import type { ConversionProfile } from './pattern-conversion.entity';

@Entity({ name: 'conversion_recipes', schema: 'conversion' })
export class ConversionRecipeEntity {
  @PrimaryColumn({ name: 'pattern_id', type: 'uuid' })
  patternId!: string;

  @Column({ name: 'engine_version', type: 'varchar', length: 64 })
  engineVersion!: string;

  @Column({ name: 'dmc_palette_version', type: 'varchar', length: 64 })
  dmcPaletteVersion!: string;

  @Column({ name: 'recipe_version', type: 'varchar', length: 64 })
  recipeVersion!: string;

  @Column({ type: 'varchar', length: 16 })
  profile!: ConversionProfile;

  @Column({ name: 'short_edge_cells', type: 'integer' })
  shortEdgeCells!: number;

  @Column({ name: 'max_colors', type: 'integer' })
  maxColors!: number;

  @Column({ type: 'integer' })
  width!: number;

  @Column({ type: 'integer' })
  height!: number;
}
