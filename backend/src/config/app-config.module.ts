import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AppConfigService } from './app-config.service';
import { validateEnvironment } from './environment';

@Global()
@Module({
  exports: [AppConfigService],
  imports: [
    ConfigModule.forRoot({
      cache: true,
      // Under test execution, the environment seeded by Jest must be authoritative,
      // and we must prevent any values from the backend/.env file from leaking in.
      ignoreEnvFile: process.env.NODE_ENV === 'test',
      isGlobal: true,
      validate: validateEnvironment,
    }),
  ],
  providers: [AppConfigService],
})
export class AppConfigModule {}
