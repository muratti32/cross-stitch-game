import { ForbiddenException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { AuthPrincipal } from '../auth/auth.types';
import { PrincipalType } from '../auth/entities';
import { ModerationNoticeEntity } from './entities';

@Injectable()
export class ModerationNoticeService {
  constructor(private readonly dataSource: DataSource) {}

  async listMine(principal: AuthPrincipal) {
    if (principal.type !== PrincipalType.Account) {
      throw new ForbiddenException('Registered Account required');
    }
    const notices = await this.dataSource.getRepository(ModerationNoticeEntity).find({
      order: { createdAt: 'DESC' },
      take: 100,
      where: { accountId: principal.id },
    });
    return notices.map((notice) => ({
      createdAt: notice.createdAt.toISOString(),
      id: notice.id,
      noticeType: notice.noticeType,
      patternId: notice.communityPatternId,
      patternTitle: notice.patternTitle,
      reason: notice.reason,
    }));
  }
}
