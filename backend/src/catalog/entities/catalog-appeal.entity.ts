import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity({ name: 'catalog_appeals', schema: 'catalog' })
@Unique('UQ_catalog_appeals_submission', ['submissionId'])
export class CatalogAppealEntity {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_catalog_appeals' })
  id!: string;

  @Column({ name: 'submission_id', type: 'uuid' })
  submissionId!: string;

  @Column({ name: 'account_id', type: 'uuid' })
  accountId!: string;

  @Column({ length: 1000, nullable: true, type: 'varchar' })
  note!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
