import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';

import { OptionalJwtAuthGuard } from '../auth';
import { configureApi } from '../api/configure-api';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';

describe('CatalogController GET catalog/patterns/:id', () => {
  const getPatternById = jest.fn();
  let app: INestApplication;
  let httpServer: Server;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CatalogController],
      providers: [{ provide: CatalogService, useValue: { getPatternById } }],
    })
      .overrideGuard(OptionalJwtAuthGuard)
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

  beforeEach(() => jest.clearAllMocks());

  it('rejects a non-UUID id with 400 before reaching the service', async () => {
    await request(httpServer).get('/v1/catalog/patterns/not-a-uuid').expect(400);
    expect(getPatternById).not.toHaveBeenCalled();
  });

  it('passes a UUID id to the service', async () => {
    const id = '7f2a4f0e-9f27-4a57-9d1b-3a6f2e0f5c11';
    getPatternById.mockResolvedValue({ id });
    await request(httpServer).get(`/v1/catalog/patterns/${id}`).expect(200);
    expect(getPatternById).toHaveBeenCalledWith(id, 'en', undefined);
  });
});
