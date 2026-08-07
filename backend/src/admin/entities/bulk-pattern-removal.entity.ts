import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'bulk_pattern_removals', schema: 'admin' })
export class BulkPatternRemovalEntity {
  @PrimaryColumn({ name: 'operator_account_id', type: 'uuid' })
  operatorAccountId!: string;

  @PrimaryColumn({ name: 'batch_id', type: 'uuid' })
  batchId!: string;

  @Column({ name: 'pattern_ids', type: 'jsonb' })
  patternIds!: string[];

  @Column({ type: 'text' })
  reason!: string;

  @Column({ name: 'removed_count', type: 'integer' })
  removedCount!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
