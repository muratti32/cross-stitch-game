import {
  BadRequestException,
  ExecutionContext,
  INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';

import { configureApi } from '../api/configure-api';
import { AdminCatalogService } from './admin-catalog.service';
import { AdminPatternsController } from './admin-patterns.controller';
import { OperatorAuthGuard } from './operator-auth.guard';
import { OperatorPermissionsGuard } from './operator-permissions.guard';

describe('AdminPatternsController bulk removal API', () => {
  const bulkRemovePatterns = jest.fn();
  let app: INestApplication;
  let httpServer: Server;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminPatternsController],
      providers: [{ provide: AdminCatalogService, useValue: { bulkRemovePatterns } }],
    })
      .overrideGuard(OperatorAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          const incoming = context.switchToHttp().getRequest<{
            operatorPrincipal?: { id: string; role: string };
          }>();
          incoming.operatorPrincipal = { id: 'operator-id', role: 'owner' };
          return true;
        },
      })
      .overrideGuard(OperatorPermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    configureApi(app);
    await app.init();
    httpServer = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns the durable original result through the validated HTTP boundary', async () => {
    const result = {
      batchId: '00000000-0000-4000-8000-000000000099',
      patternIds: [
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
      ],
      removedCount: 2,
    };
    bulkRemovePatterns.mockResolvedValueOnce(result);
    const body = {
      batchId: result.batchId.toUpperCase(),
      patternIds: [...result.patternIds].reverse().map((id) => id.toUpperCase()),
      reason: '  Confirmed policy removal  ',
    };

    await request(httpServer)
      .post('/v1/admin/patterns/bulk-remove')
      .set('x-request-id', 'retry-request-id')
      .send(body)
      .expect(201)
      .expect(result);
    expect(bulkRemovePatterns).toHaveBeenCalledWith(
      'operator-id',
      body.patternIds,
      'Confirmed policy removal',
      body.batchId,
      'retry-request-id',
    );
  });

  it('returns a payload mismatch as a 400 API response without hiding the reason', async () => {
    bulkRemovePatterns.mockRejectedValueOnce(
      new BadRequestException('Bulk removal batch ID was already used with a different request'),
    );

    await request(httpServer)
      .post('/v1/admin/patterns/bulk-remove')
      .send({
        batchId: '00000000-0000-4000-8000-000000000099',
        patternIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'],
        reason: 'Confirmed different removal',
      })
      .expect(400)
      .expect(({ body }: { body: { message?: string } }) => {
        expect(body.message).toBe(
          'Bulk removal batch ID was already used with a different request',
        );
      });
  });

  it('rejects an invalid batch ID before the service is called', async () => {
    await request(httpServer)
      .post('/v1/admin/patterns/bulk-remove')
      .send({
        batchId: 'not-a-uuid',
        patternIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'],
        reason: 'Confirmed policy removal',
      })
      .expect(400);
    expect(bulkRemovePatterns).not.toHaveBeenCalled();
  });
});
