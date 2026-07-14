import 'dotenv/config';

import { DataSource } from 'typeorm';

import { parseEnvironment } from '../config/environment';
import { createTypeOrmOptions } from './typeorm-options';

const environment = parseEnvironment(process.env);

export const appDataSource = new DataSource(
  createTypeOrmOptions(environment.DATABASE_URL),
);

export default appDataSource;
