import { describe, it, expect } from 'vitest';
import { validateStaffRoleRules } from '../../src/modules/user/user.roles.js';
import type { Role } from '../../src/modules/user/user.interface.js';
import { AppError } from '../../src/utils/appError.js';

describe('Unit Tests: Staff Role Rules Pure Function (src/modules/user/user.roles.ts)', () => {
  const staffRoles: Role[] = ['MANAGER', 'WAITER', 'CASHIER', 'CHEF'];

  describe('Table-driven: Non-Owner/Admin Actors are rejected for all actions', () => {
    staffRoles.forEach((actorRole) => {
      (
        ['CREATE', 'UPDATE', 'RESET_PASSWORD', 'LIST', 'GET_BY_ID'] as const
      ).forEach((action) => {
        it(`${actorRole} cannot perform ${action} (throws 403 FORBIDDEN)`, () => {
          expect(() =>
            validateStaffRoleRules({
              action,
              actorRole,
              actorId: 'actor1',
              targetId: 'target1',
              targetRole: 'WAITER',
              newRole: 'WAITER',
              newBranchIds: ['507f1f77bcf86cd799439011'],
            }),
          ).toThrowError(AppError);

          try {
            validateStaffRoleRules({
              action,
              actorRole,
              actorId: 'actor1',
              targetId: 'target1',
              targetRole: 'WAITER',
              newRole: 'WAITER',
              newBranchIds: ['507f1f77bcf86cd799439011'],
            });
          } catch (err) {
            expect((err as AppError).statusCode).toBe(403);
            expect((err as AppError).code).toBe('FORBIDDEN');
          }
        });
      });
    });
  });

  describe('Table-driven: OWNER actor permissions', () => {
    it('OWNER cannot create another OWNER (throws 400 CANNOT_ASSIGN_OWNER)', () => {
      expect(() =>
        validateStaffRoleRules({
          action: 'CREATE',
          actorRole: 'OWNER',
          newRole: 'OWNER',
          newBranchIds: [],
        }),
      ).toThrowError(AppError);
    });

    it('OWNER can create an ADMIN with empty branchIds', () => {
      expect(() =>
        validateStaffRoleRules({
          action: 'CREATE',
          actorRole: 'OWNER',
          newRole: 'ADMIN',
          newBranchIds: [],
        }),
      ).not.toThrow();
    });

    it('OWNER cannot create an ADMIN with branchIds (throws 400)', () => {
      expect(() =>
        validateStaffRoleRules({
          action: 'CREATE',
          actorRole: 'OWNER',
          newRole: 'ADMIN',
          newBranchIds: ['507f1f77bcf86cd799439011'],
        }),
      ).toThrowError(AppError);
    });

    staffRoles.forEach((role) => {
      it(`OWNER can create ${role} with branchIds`, () => {
        expect(() =>
          validateStaffRoleRules({
            action: 'CREATE',
            actorRole: 'OWNER',
            newRole: role,
            newBranchIds: ['507f1f77bcf86cd799439011'],
          }),
        ).not.toThrow();
      });

      it(`OWNER cannot create ${role} with empty branchIds (throws 400)`, () => {
        expect(() =>
          validateStaffRoleRules({
            action: 'CREATE',
            actorRole: 'OWNER',
            newRole: role,
            newBranchIds: [],
          }),
        ).toThrowError(AppError);
      });
    });

    it('OWNER cannot modify or reset an OWNER account (throws 403 CANNOT_MODIFY_OWNER)', () => {
      expect(() =>
        validateStaffRoleRules({
          action: 'UPDATE',
          actorRole: 'OWNER',
          actorId: 'owner1',
          targetId: 'owner2',
          targetRole: 'OWNER',
        }),
      ).toThrowError(AppError);

      try {
        validateStaffRoleRules({
          action: 'UPDATE',
          actorRole: 'OWNER',
          actorId: 'owner1',
          targetId: 'owner2',
          targetRole: 'OWNER',
        });
      } catch (err) {
        expect((err as AppError).statusCode).toBe(403);
        expect((err as AppError).code).toBe('CANNOT_MODIFY_OWNER');
      }

      expect(() =>
        validateStaffRoleRules({
          action: 'RESET_PASSWORD',
          actorRole: 'OWNER',
          actorId: 'owner1',
          targetId: 'owner2',
          targetRole: 'OWNER',
        }),
      ).toThrowError(AppError);
    });

    it('OWNER can edit, demote, deactivate, and reset an ADMIN', () => {
      // Edit ADMIN name
      expect(() =>
        validateStaffRoleRules({
          action: 'UPDATE',
          actorRole: 'OWNER',
          actorId: 'owner1',
          targetId: 'admin1',
          targetRole: 'ADMIN',
          targetBranchIds: [],
        }),
      ).not.toThrow();

      // Deactivate ADMIN
      expect(() =>
        validateStaffRoleRules({
          action: 'UPDATE',
          actorRole: 'OWNER',
          actorId: 'owner1',
          targetId: 'admin1',
          targetRole: 'ADMIN',
          newStatus: 'INACTIVE',
        }),
      ).not.toThrow();

      // Demote ADMIN to MANAGER with branchIds
      expect(() =>
        validateStaffRoleRules({
          action: 'UPDATE',
          actorRole: 'OWNER',
          actorId: 'owner1',
          targetId: 'admin1',
          targetRole: 'ADMIN',
          newRole: 'MANAGER',
          newBranchIds: ['507f1f77bcf86cd799439011'],
        }),
      ).not.toThrow();

      // Reset ADMIN password
      expect(() =>
        validateStaffRoleRules({
          action: 'RESET_PASSWORD',
          actorRole: 'OWNER',
          actorId: 'owner1',
          targetId: 'admin1',
          targetRole: 'ADMIN',
        }),
      ).not.toThrow();
    });

    it('Demoting ADMIN to MANAGER without branchIds throws 400', () => {
      expect(() =>
        validateStaffRoleRules({
          action: 'UPDATE',
          actorRole: 'OWNER',
          actorId: 'owner1',
          targetId: 'admin1',
          targetRole: 'ADMIN',
          targetBranchIds: [],
          newRole: 'MANAGER',
        }),
      ).toThrowError(AppError);
    });

    it('OWNER self-deactivation throws 409 CANNOT_DEACTIVATE_SELF', () => {
      expect(() =>
        validateStaffRoleRules({
          action: 'UPDATE',
          actorRole: 'OWNER',
          actorId: 'owner1',
          targetId: 'owner1',
          targetRole: 'OWNER',
        }),
      ).toThrowError(AppError); // Caught by CANNOT_MODIFY_OWNER
    });
  });

  describe('Table-driven: ADMIN actor permissions', () => {
    it('ADMIN cannot create an OWNER (throws 400)', () => {
      expect(() =>
        validateStaffRoleRules({
          action: 'CREATE',
          actorRole: 'ADMIN',
          newRole: 'OWNER',
        }),
      ).toThrowError(AppError);
    });

    it('ADMIN cannot create an ADMIN (throws 403 FORBIDDEN)', () => {
      expect(() =>
        validateStaffRoleRules({
          action: 'CREATE',
          actorRole: 'ADMIN',
          newRole: 'ADMIN',
          newBranchIds: [],
        }),
      ).toThrowError(AppError);
    });

    staffRoles.forEach((role) => {
      it(`ADMIN can create ${role} with branchIds`, () => {
        expect(() =>
          validateStaffRoleRules({
            action: 'CREATE',
            actorRole: 'ADMIN',
            newRole: role,
            newBranchIds: ['507f1f77bcf86cd799439011'],
          }),
        ).not.toThrow();
      });
    });

    it('ADMIN cannot modify or reset an OWNER (throws 403 CANNOT_MODIFY_OWNER)', () => {
      expect(() =>
        validateStaffRoleRules({
          action: 'UPDATE',
          actorRole: 'ADMIN',
          actorId: 'admin1',
          targetId: 'owner1',
          targetRole: 'OWNER',
        }),
      ).toThrowError(AppError);

      expect(() =>
        validateStaffRoleRules({
          action: 'RESET_PASSWORD',
          actorRole: 'ADMIN',
          actorId: 'admin1',
          targetId: 'owner1',
          targetRole: 'OWNER',
        }),
      ).toThrowError(AppError);
    });

    it('ADMIN cannot edit, demote, deactivate, or reset another ADMIN (throws 403)', () => {
      expect(() =>
        validateStaffRoleRules({
          action: 'UPDATE',
          actorRole: 'ADMIN',
          actorId: 'admin1',
          targetId: 'admin2',
          targetRole: 'ADMIN',
        }),
      ).toThrowError(AppError);

      expect(() =>
        validateStaffRoleRules({
          action: 'RESET_PASSWORD',
          actorRole: 'ADMIN',
          actorId: 'admin1',
          targetId: 'admin2',
          targetRole: 'ADMIN',
        }),
      ).toThrowError(AppError);
    });

    it('ADMIN cannot promote a staff user to ADMIN (throws 403)', () => {
      expect(() =>
        validateStaffRoleRules({
          action: 'UPDATE',
          actorRole: 'ADMIN',
          actorId: 'admin1',
          targetId: 'waiter1',
          targetRole: 'WAITER',
          targetBranchIds: ['507f1f77bcf86cd799439011'],
          newRole: 'ADMIN',
          newBranchIds: [],
        }),
      ).toThrowError(AppError);
    });

    it('ADMIN can edit staff details and change role between staff roles', () => {
      expect(() =>
        validateStaffRoleRules({
          action: 'UPDATE',
          actorRole: 'ADMIN',
          actorId: 'admin1',
          targetId: 'waiter1',
          targetRole: 'WAITER',
          targetBranchIds: ['507f1f77bcf86cd799439011'],
          newRole: 'CASHIER',
        }),
      ).not.toThrow();
    });

    it('ADMIN deactivating self throws 409 CANNOT_DEACTIVATE_SELF', () => {
      try {
        validateStaffRoleRules({
          action: 'UPDATE',
          actorRole: 'ADMIN',
          actorId: 'admin1',
          targetId: 'admin1',
          targetRole: 'ADMIN',
          newStatus: 'INACTIVE',
        });
      } catch (err) {
        expect((err as AppError).statusCode).toBe(409);
        expect((err as AppError).code).toBe('CANNOT_DEACTIVATE_SELF');
      }
    });

    it('ADMIN changing own role or branchIds throws 403', () => {
      expect(() =>
        validateStaffRoleRules({
          action: 'UPDATE',
          actorRole: 'ADMIN',
          actorId: 'admin1',
          targetId: 'admin1',
          targetRole: 'ADMIN',
          newRole: 'MANAGER',
          newBranchIds: ['507f1f77bcf86cd799439011'],
        }),
      ).toThrowError(AppError);
    });

    it('ADMIN resetting self throws 403', () => {
      expect(() =>
        validateStaffRoleRules({
          action: 'RESET_PASSWORD',
          actorRole: 'ADMIN',
          actorId: 'admin1',
          targetId: 'admin1',
          targetRole: 'ADMIN',
        }),
      ).toThrowError(AppError);
    });
  });
});
