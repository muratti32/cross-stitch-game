import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity({ name: 'catalog_metadata_appeals', schema: 'catalog' })
@Unique('UQ_catalog_metadata_appeals_revision', ['revisionId'])
export class CatalogMetadataAppealEntity {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_catalog_metadata_appeals' })
  id!: string;

  @Column({ name: 'revision_id', type: 'uuid' })
  revisionId!: string;

  @Column({ name: 'account_id', type: 'uuid' })
  accountId!: string;

  @Column({ length: 1000, nullable: true, type: 'varchar' })
  note!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
