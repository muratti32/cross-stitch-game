import { Body, Controller, Headers, NotFoundException, Post, UseGuards } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { SupportReferenceService } from '../support/support-reference.service';
import { CurrentOperator } from './current-operator.decorator';
import { LookupSupportReferenceDto } from './dto/lookup-support-reference.dto';
import { OperatorAuditLogService } from './operator-audit-log.service';
import { OperatorAuthGuard } from './operator-auth.guard';
import { OperatorPrincipal } from './operator-auth.types';
import { OperatorPermissionsGuard } from './operator-permissions.guard';
import { RequireOperatorPermissions } from './require-operator-permissions.decorator';

@Controller('admin/support-references')
@UseGuards(OperatorAuthGuard, OperatorPermissionsGuard)
export class AdminSupportReferencesController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly supportReferences: SupportReferenceService,
    private readonly auditLog: OperatorAuditLogService,
  ) {}

  @Post('lookup')
  @RequireOperatorPermissions('support.reference.lookup')
  async lookup(
    @CurrentOperator() operator: OperatorPrincipal,
    @Body() body: LookupSupportReferenceDto,
    @Headers('x-request-id') requestId?: string,
  ) {
    const resolved = await this.supportReferences.resolve(body.code);
    if (resolved === null) {
      await this.dataSource.transaction((manager) =>
        this.auditLog.record(manager, {
          action: 'support_reference.lookup',
          after: {
            reason: body.reason.trim(),
            referenceSuffix: body.code.trim().slice(-4).toUpperCase(),
          },
          operatorAccountId: operator.id,
          outcome: 'failure',
          requestId: requestId ?? null,
          targetType: 'support_reference',
        }),
      );
      throw new NotFoundException('Support Reference not found');
    }
    await this.dataSource.transaction((manager) =>
      this.auditLog.record(manager, {
        action: 'support_reference.lookup',
        after: {
          reason: body.reason.trim(),
          recordCount: resolved.records.length,
          referenceSuffix: resolved.code.slice(-4),
        },
        operatorAccountId: operator.id,
        outcome: 'success',
        requestId: requestId ?? null,
        targetId: resolved.id,
        targetType: 'support_reference',
      }),
    );
    return resolved;
  }
}
