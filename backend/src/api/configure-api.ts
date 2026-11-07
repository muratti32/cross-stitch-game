import { INestApplication, ValidationPipe } from '@nestjs/common';
import { json, NextFunction, Request, Response } from 'express';

const API_PREFIX = 'v1';
const PROMOTION_PACKAGE_BODY_LIMIT = '8mb';

const parsePromotionPackage = json({ limit: PROMOTION_PACKAGE_BODY_LIMIT });

export function configureApi(app: INestApplication): void {
  // The wrapper is load-bearing: Nest skips its global JSON parser when it finds
  // a handler named jsonParser on the app, which would leave every other route
  // unparsed. The global parser then skips this already parsed body.
  app.use(`/${API_PREFIX}/promotion/stage-package`, (request: Request, response: Response, next: NextFunction) => {
    parsePromotionPackage(request, response, next);
  });
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
}
