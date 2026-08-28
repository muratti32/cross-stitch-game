import { Entity, PrimaryColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { CategoryEntity } from './category.entity';

@Entity({ name: 'category_labels', schema: 'catalog' })
export class CategoryLabelEntity {
  @PrimaryColumn({ name: 'category_code', type: 'varchar', length: 64 })
  categoryCode!: string;

  @PrimaryColumn({ type: 'varchar', length: 8 })
  locale!: string;

  @Column({ type: 'varchar', length: 255 })
  label!: string;

  @ManyToOne(() => CategoryEntity, (category) => category.labels, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'category_code', foreignKeyConstraintName: 'FK_category_labels_categories' })
  category!: CategoryEntity;
}
