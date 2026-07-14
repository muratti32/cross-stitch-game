import { Entity, PrimaryColumn, CreateDateColumn, OneToMany } from 'typeorm';
import { TagLabelEntity } from './tag-label.entity';

@Entity({ name: 'tags', schema: 'catalog' })
export class TagEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  code!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @OneToMany(() => TagLabelEntity, (label) => label.tag)
  labels!: TagLabelEntity[];
}
