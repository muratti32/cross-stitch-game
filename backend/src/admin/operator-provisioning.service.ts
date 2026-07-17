import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  OPERATOR_PASSWORD_MIN_LENGTH,
  OPERATOR_RECOVERY_CODE_COUNT,
} from './admin.constants';
import { OperatorAccountEntity, OperatorRecoveryCodeEntity, OperatorRole } from './entities';
import { OperatorHashingService } from './operator-hashing.service';
import { OperatorTotpService } from './operator-totp.service';
import { TotpSecretCipherService } from './totp-secret-cipher.service';

export interface ProvisionedOperator {
  operatorAccountId: string;
  email: string;
  otpauthUri: string;
  recoveryCodes: string[];
}

@Injectable()
export class OperatorProvisioningService {
  constructor(
    @InjectRepository(OperatorAccountEntity)
    private readonly operatorAccounts: Repository<OperatorAccountEntity>,
    @InjectRepository(OperatorRecoveryCodeEntity)
    private readonly recoveryCodes: Repository<OperatorRecoveryCodeEntity>,
    private readonly hashing: OperatorHashingService,
    private readonly totp: OperatorTotpService,
    private readonly totpCipher: TotpSecretCipherService,
  ) {}

  /**
   * Creates one Operator Account with role `owner`. Intended to be run
   * through `npm run operator:create` (backend/scripts/create-operator.ts);
   * there is deliberately no HTTP endpoint for this in the first release.
   */
  async createOperator(
    email: string,
    password: string,
  ): Promise<ProvisionedOperator> {
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      throw new BadRequestException('A valid operator email is required');
    }
    if (password.length < OPERATOR_PASSWORD_MIN_LENGTH) {
      throw new BadRequestException(
        `Operator password must be at least ${OPERATOR_PASSWORD_MIN_LENGTH} characters`,
      );
    }
    const existing = await this.operatorAccounts.findOne({
      where: { email: normalizedEmail },
    });
    if (existing !== null) {
      throw new BadRequestException(
        `An operator account already exists for ${normalizedEmail}`,
      );
    }

    const passwordHash = await this.hashing.hashPassword(password);
    const totpSecret = this.totp.generateSecret();
    const totpSecretEncrypted = this.totpCipher.encrypt(totpSecret);

    const operator = await this.operatorAccounts.save(
      this.operatorAccounts.create({
        disabled: false,
        email: normalizedEmail,
        passwordHash,
        role: OperatorRole.Owner,
        totpSecretEncrypted,
      }),
    );

    const recoveryCodes = Array.from({ length: OPERATOR_RECOVERY_CODE_COUNT }, () =>
      this.hashing.generateRecoveryCode(),
    );
    await this.recoveryCodes.save(
      recoveryCodes.map((code) =>
        this.recoveryCodes.create({
          codeHash: this.hashing.hashOpaqueValue(code),
          operatorAccountId: operator.id,
          usedAt: null,
        }),
      ),
    );

    return {
      email: normalizedEmail,
      operatorAccountId: operator.id,
      otpauthUri: this.totp.keyUri(normalizedEmail, totpSecret),
      recoveryCodes,
    };
  }
}
