import { Entity, Column, PrimaryColumn, CreateDateColumn } from 'typeorm';

@Entity({ name: 'locks', schema: 'promotion' })
export class PromotionLockEntity {
  @PrimaryColumn('uuid', { name: 'guest_id' })
  guestId!: string;

  @Column('uuid')
  token!: string;

  @Column('timestamptz')
  expiry!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
