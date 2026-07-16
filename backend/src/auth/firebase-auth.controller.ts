import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';

import type { FederatedAccountAuthResponse } from './auth.types';
import { ExchangeFirebaseTokenDto } from './dto/exchange-firebase-token.dto';
import { FirebaseAuthService } from './firebase-auth.service';

@Controller('auth/firebase')
export class FirebaseAuthController {
  constructor(private readonly firebaseAuth: FirebaseAuthService) {}

  @Post('exchange')
  @HttpCode(HttpStatus.OK)
  exchange(
    @Body() body: ExchangeFirebaseTokenDto,
  ): Promise<FederatedAccountAuthResponse> {
    return this.firebaseAuth.exchange(body.idToken);
  }
}
