import 'dotenv/config';

import { DataSource } from 'typeorm';

import { parseEnvironment } from '../config/environment';
import { createTypeOrmOptions } from './typeorm-options';

const environment = parseEnvironment(process.env);

// The TypeORM CLI requires exactly one DataSource export from this file.
export default new DataSource(
  createTypeOrmOptions(environment.DATABASE_URL),
);
