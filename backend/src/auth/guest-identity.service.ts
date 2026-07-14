import {
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';

import { AuthHashingService } from './auth-hashing.service';
import { AuthSessionService } from './auth-session.service';
import { GuestAuthResponse } from './auth.types';
import { GuestInstallationStatus } from './entities';
import {
  GuestInstallationRecord,
  GuestInstallationsRepository,
} from './guest-installations.repository';

@Injectable()
export class GuestIdentityService {
  constructor(
    private readonly hashing: AuthHashingService,
    private readonly guestInstallations: GuestInstallationsRepository,
    private readonly sessions: AuthSessionService,
  ) {}

  async issue(
    installationKey: string,
    credentialSecret: string,
  ): Promise<GuestAuthResponse> {
    const installationKeyHash =
      this.hashing.hashInstallationKey(installationKey);
    let guest = await this.guestInstallations.findByInstallationKeyHash(
      installationKeyHash,
    );
    let created = false;

    if (guest === null) {
      const credentialHash =
        await this.hashing.hashCredentialSecret(credentialSecret);
      guest = await this.guestInstallations.insertIfAbsent(
        installationKeyHash,
        credentialHash,
      );
      created = guest !== null;

      if (guest === null) {
        guest = await this.guestInstallations.findByInstallationKeyHash(
          installationKeyHash,
        );
      }
    }

    if (guest === null) {
      throw new InternalServerErrorException(
        'Guest identity could not be established',
      );
    }

    if (!created) {
      await this.authenticateExistingGuest(guest, credentialSecret);
    }

    const tokens = await this.sessions.issueForGuest(guest.id);
    return { guestId: guest.id, ...tokens };
  }

  private async authenticateExistingGuest(
    guest: GuestInstallationRecord,
    credentialSecret: string,
  ): Promise<void> {
    const credentialMatches = await this.hashing.verifyCredentialSecret(
      credentialSecret,
      guest.credentialHash,
    );
    if (
      !credentialMatches ||
      guest.status !== GuestInstallationStatus.Active
    ) {
      throw this.invalidGuestCredentials();
    }

    if (!(await this.guestInstallations.touchIfActive(guest.id))) {
      throw this.invalidGuestCredentials();
    }
  }

  private invalidGuestCredentials(): UnauthorizedException {
    return new UnauthorizedException('Invalid guest credentials');
  }

  async reset(guestId: string): Promise<void> {
    await this.guestInstallations.reset(guestId);
  }
}
