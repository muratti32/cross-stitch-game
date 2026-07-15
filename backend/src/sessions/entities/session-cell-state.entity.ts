import { Check, Column, Entity, PrimaryColumn } from 'typeorm';

import type { CellStateValue } from '../progress-merge';

@Entity({ name: 'session_cell_state', schema: 'sessions' })
@Check('CHK_session_cell_state_state', '"state" IN (\'completed\', \'incomplete\')')
export class SessionCellStateEntity {
  @PrimaryColumn({ name: 'session_id', type: 'uuid' })
  sessionId!: string;

  @PrimaryColumn({ name: 'cell_index', type: 'integer' })
  cellIndex!: number;

  @Column({ type: 'varchar', length: 16 })
  state!: CellStateValue;

  @Column({ type: 'bigint' })
  revision!: string;
}
