import { Body, Controller, HttpCode, INestApplication, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';

import { configureApi } from './configure-api';

@Controller('promotion')
class EchoController {
  @Post('stage-package')
  @HttpCode(200)
  stagePackage(@Body() body: { padding: string }) {
    return { received: body.padding.length };
  }

  @Post('lock')
  @HttpCode(200)
  lock(@Body() body: { padding: string }) {
    return { received: body.padding.length };
  }
}

describe('configureApi body limits', () => {
  let app: INestApplication;
  let httpServer: Server;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [EchoController] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApi(app);
    await app.init();
    httpServer = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  const bodyOf = (kilobytes: number) => ({ padding: 'x'.repeat(kilobytes * 1024) });

  it('accepts a Promotion Transfer Package over 100kb', async () => {
    const response = await request(httpServer).post('/v1/promotion/stage-package').send(bodyOf(500));
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: 500 * 1024 });
  });

  it('refuses a Promotion Transfer Package over 8mb', async () => {
    const response = await request(httpServer).post('/v1/promotion/stage-package').send(bodyOf(9 * 1024));
    expect(response.status).toBe(413);
  });

  it('keeps parsing JSON on other routes', async () => {
    const response = await request(httpServer).post('/v1/promotion/lock').send(bodyOf(1));
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: 1024 });
  });

  it('keeps the 100kb limit on other routes', async () => {
    const response = await request(httpServer).post('/v1/promotion/lock').send(bodyOf(500));
    expect(response.status).toBe(413);
  });
});
