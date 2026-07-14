import { Entity, PrimaryColumn, Column, OneToOne, JoinColumn } from 'typeorm';
import { PatternEntity } from './pattern.entity';

@Entity({ name: 'staff_picks', schema: 'catalog' })
export class StaffPickEntity {
  @PrimaryColumn({ name: 'pattern_id', type: 'uuid' })
  patternId!: string;

  @Column({ unique: true, type: 'integer' })
  position!: number;

  @OneToOne(() => PatternEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'pattern_id',
    foreignKeyConstraintName: 'FK_staff_picks_patterns',
  })
  pattern!: PatternEntity;
}
