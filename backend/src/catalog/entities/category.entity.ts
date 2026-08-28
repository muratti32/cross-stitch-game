import { Entity, PrimaryColumn, Column, CreateDateColumn, OneToMany } from 'typeorm';
import { CategoryLabelEntity } from './category-label.entity';

@Entity({ name: 'categories', schema: 'catalog' })
export class CategoryEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  code!: string;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @OneToMany(() => CategoryLabelEntity, (label) => label.category)
  labels!: CategoryLabelEntity[];
}
