import { Entity, PrimaryColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { TagEntity } from './tag.entity';

@Entity({ name: 'tag_labels', schema: 'catalog' })
export class TagLabelEntity {
  @PrimaryColumn({ name: 'tag_code', type: 'varchar', length: 64 })
  tagCode!: string;

  @PrimaryColumn({ type: 'varchar', length: 8 })
  locale!: string;

  @Column({ type: 'varchar', length: 255 })
  label!: string;

  @ManyToOne(() => TagEntity, (tag) => tag.labels, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'tag_code',
    foreignKeyConstraintName: 'FK_tag_labels_tags',
  })
  tag!: TagEntity;
}
