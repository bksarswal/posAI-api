import { describe, it, expect } from 'vitest';
import { Types } from 'mongoose';
import {
  canUserAccessBranch,
  filterAccessibleBranches,
} from '../../src/modules/branch/branch.access.js';

describe('Unit Tests: Branch Access Helper (src/modules/branch/branch.access.ts)', () => {
  const branchId1 = new Types.ObjectId();
  const branchId2 = new Types.ObjectId();
  const branchId3 = new Types.ObjectId();

  const branches = [
    { _id: branchId1, name: 'Main Branch' },
    { _id: branchId2, name: 'Koramangala' },
    { _id: branchId3, name: 'Indiranagar' },
  ];

  describe('canUserAccessBranch', () => {
    it('OWNER and ADMIN can access every branch regardless of branchIds', () => {
      expect(canUserAccessBranch({ role: 'OWNER' }, branchId1)).toBe(true);
      expect(
        canUserAccessBranch({ role: 'OWNER', branchIds: [] }, branchId2),
      ).toBe(true);
      expect(canUserAccessBranch({ role: 'ADMIN' }, branchId3)).toBe(true);
      expect(
        canUserAccessBranch({ role: 'ADMIN', branchIds: [] }, branchId1),
      ).toBe(true);
    });

    it('Other roles can access ONLY branches in their branchIds', () => {
      const manager = {
        role: 'MANAGER' as const,
        branchIds: [branchId1, branchId2],
      };
      expect(canUserAccessBranch(manager, branchId1)).toBe(true);
      expect(canUserAccessBranch(manager, branchId2)).toBe(true);
      expect(canUserAccessBranch(manager, branchId3)).toBe(false);

      const waiter = {
        role: 'WAITER' as const,
        branchIds: [branchId2.toString()],
      };
      expect(canUserAccessBranch(waiter, branchId2)).toBe(true);
      expect(canUserAccessBranch(waiter, branchId1)).toBe(false);
    });

    it('Empty or missing branchIds gives NO access to non-owner/admin roles', () => {
      expect(
        canUserAccessBranch({ role: 'WAITER', branchIds: [] }, branchId1),
      ).toBe(false);
      expect(canUserAccessBranch({ role: 'CASHIER' }, branchId1)).toBe(false);
      expect(
        canUserAccessBranch({ role: 'CHEF', branchIds: [] }, branchId2),
      ).toBe(false);
      expect(
        canUserAccessBranch({ role: 'MANAGER', branchIds: [] }, branchId3),
      ).toBe(false);
    });
  });

  describe('filterAccessibleBranches', () => {
    it('returns all branches for OWNER and ADMIN', () => {
      expect(filterAccessibleBranches({ role: 'OWNER' }, branches)).toEqual(
        branches,
      );
      expect(
        filterAccessibleBranches({ role: 'OWNER', branchIds: [] }, branches),
      ).toEqual(branches);
      expect(filterAccessibleBranches({ role: 'ADMIN' }, branches)).toEqual(
        branches,
      );
    });

    it('filters branches to only those listed in branchIds for staff roles', () => {
      const staffUser = {
        role: 'CASHIER' as const,
        branchIds: [branchId1, branchId3],
      };
      const filtered = filterAccessibleBranches(staffUser, branches);
      expect(filtered).toHaveLength(2);
      expect(filtered.map((b) => b._id.toString())).toEqual([
        branchId1.toString(),
        branchId3.toString(),
      ]);
    });

    it('returns empty array [] for non-owner/admin with empty branchIds', () => {
      expect(
        filterAccessibleBranches({ role: 'WAITER', branchIds: [] }, branches),
      ).toEqual([]);
      expect(filterAccessibleBranches({ role: 'MANAGER' }, branches)).toEqual(
        [],
      );
    });
  });
});
