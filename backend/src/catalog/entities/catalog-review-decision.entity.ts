import { Check, Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity({ name: 'catalog_review_decisions', schema: 'catalog' })
@Unique('UQ_catalog_review_decisions_round', ['submissionId', 'reviewRound'])
@Check('CHK_catalog_review_decisions_round', '"review_round" IN (\'initial\', \'appeal\')')
@Check('CHK_catalog_review_decisions_decision', '"decision" IN (\'accepted\', \'rejected\')')
export class CatalogReviewDecisionEntity {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_catalog_review_decisions' })
  id!: string;

  @Column({ name: 'submission_id', type: 'uuid' })
  submissionId!: string;

  @Column({ length: 16, name: 'review_round', type: 'varchar' })
  reviewRound!: 'initial' | 'appeal';

  @Column({ length: 16, type: 'varchar' })
  decision!: 'accepted' | 'rejected';

  @Column({ name: 'operator_account_id', type: 'uuid' })
  operatorAccountId!: string;

  @Column({ length: 32, name: 'rejection_reason', nullable: true, type: 'varchar' })
  rejectionReason!: string | null;

  @Column({ name: 'note', nullable: true, type: 'text' })
  note!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
