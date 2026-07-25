import { CreatorBlockController } from './creator-block.controller';
import { CreatorBlockService } from './creator-block.service';
import { PrincipalType } from '../auth/entities';
import { AuthPrincipal } from '../auth/auth.types';
import { ForbiddenException } from '@nestjs/common';

describe('CreatorBlockController', () => {
  let controller: CreatorBlockController;
  let service: CreatorBlockService;

  beforeEach(() => {
    service = {
      block: jest.fn(),
      unblock: jest.fn(),
      getBlockedCreators: jest.fn(),
    } as unknown as CreatorBlockService;

    controller = new CreatorBlockController(service);
  });

  describe('block', () => {
    it('throws ForbiddenException for guest principals', async () => {
      const guestPrincipal: AuthPrincipal = {
        id: 'guest-uuid',
        tokenVersion: 1,
        type: PrincipalType.Guest,
      };

      await expect(controller.block('creator-uuid', guestPrincipal))
        .rejects.toThrow(ForbiddenException);
      expect(service.block).not.toHaveBeenCalled();
    });

    it('delegates to the service for registered accounts', async () => {
      const accountPrincipal: AuthPrincipal = {
        id: 'account-uuid',
        tokenVersion: 1,
        type: PrincipalType.Account,
      };
      jest.spyOn(service, 'block').mockResolvedValue({ blocked: true });

      const result = await controller.block('creator-uuid', accountPrincipal);

      expect(result).toEqual({ blocked: true });
      expect(service.block).toHaveBeenCalledWith('account-uuid', 'creator-uuid');
    });
  });

  describe('unblock', () => {
    it('throws ForbiddenException for guest principals', async () => {
      const guestPrincipal: AuthPrincipal = {
        id: 'guest-uuid',
        tokenVersion: 1,
        type: PrincipalType.Guest,
      };

      await expect(controller.unblock('creator-uuid', guestPrincipal))
        .rejects.toThrow(ForbiddenException);
      expect(service.unblock).not.toHaveBeenCalled();
    });

    it('delegates to the service for registered accounts', async () => {
      const accountPrincipal: AuthPrincipal = {
        id: 'account-uuid',
        tokenVersion: 1,
        type: PrincipalType.Account,
      };
      jest.spyOn(service, 'unblock').mockResolvedValue({ blocked: false });

      const result = await controller.unblock('creator-uuid', accountPrincipal);

      expect(result).toEqual({ blocked: false });
      expect(service.unblock).toHaveBeenCalledWith('account-uuid', 'creator-uuid');
    });
  });

  describe('getBlockedCreators', () => {
    it('throws ForbiddenException for guest principals', async () => {
      const guestPrincipal: AuthPrincipal = {
        id: 'guest-uuid',
        tokenVersion: 1,
        type: PrincipalType.Guest,
      };

      await expect(controller.getBlockedCreators(guestPrincipal))
        .rejects.toThrow(ForbiddenException);
      expect(service.getBlockedCreators).not.toHaveBeenCalled();
    });

    it('delegates to the service for registered accounts', async () => {
      const accountPrincipal: AuthPrincipal = {
        id: 'account-uuid',
        tokenVersion: 1,
        type: PrincipalType.Account,
      };
      const blockedList = [{ id: 'cp1', username: 'creator1', displayName: 'Creator One' }];
      jest.spyOn(service, 'getBlockedCreators').mockResolvedValue(blockedList);

      const result = await controller.getBlockedCreators(accountPrincipal);

      expect(result).toEqual(blockedList);
      expect(service.getBlockedCreators).toHaveBeenCalledWith('account-uuid');
    });
  });
});
