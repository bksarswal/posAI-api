import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Tenant } from '../../src/modules/tenant/tenant.model.js';
import { Restaurant } from '../../src/modules/restaurant/restaurant.model.js';
import { Branch } from '../../src/modules/branch/branch.model.js';
import { runWithTenant } from '../../src/utils/tenantContext.js';
import { withGlobalScope } from '../../src/utils/tenantBypass.js';
import { TenantScopingError } from '../../src/utils/appError.js';

describe('Tenant, Restaurant, and Branch Models & Indexes', () => {
  let replSet: MongoMemoryReplSet;

  const sampleAddress = {
    line1: '100 Indiranagar 100ft Rd',
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560038',
  };

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());

    // Ensure all unique and partial indexes are synced in the database
    await Tenant.init();
    await Restaurant.init();
    await Branch.init();
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  beforeEach(async () => {
    await withGlobalScope(async () => {
      await Branch.deleteMany({});
      await Restaurant.deleteMany({});
      await Tenant.deleteMany({});
    });
  });

  describe('Tenant Model', () => {
    it('creates a tenant successfully and enforces unique slug', async () => {
      const tenant1 = await Tenant.create({
        name: 'Spice Route',
        slug: 'spice-route',
      });
      expect(tenant1._id).toBeDefined();
      expect(tenant1.status).toBe('ACTIVE');

      // Duplicate slug must fail with Mongo code 11000
      await expect(
        Tenant.create({
          name: 'Another Spice Route',
          slug: 'spice-route',
        }),
      ).rejects.toThrow(/E11000.*duplicate key/);
    });

    it('allows queries without tenant context since Tenant is unscoped root', async () => {
      await Tenant.create({ name: 'Root Tenant', slug: 'root-tenant' });

      // Query without runWithTenant context
      const tenants = await Tenant.find();
      expect(tenants).toHaveLength(1);
      expect(tenants[0]?.name).toBe('Root Tenant');
    });
  });

  describe('Restaurant Model', () => {
    it('allows one restaurant per tenant and rejects a second restaurant in the same tenant', async () => {
      const tenant = await Tenant.create({
        name: 'Biryani House',
        slug: 'biryani-house',
      });

      await runWithTenant(tenant._id, async () => {
        const r1 = await Restaurant.create({
          name: 'Biryani House HQ',
          phone: '+919876543210',
          email: 'hq@biryanihouse.com',
          address: sampleAddress,
        });
        expect(r1._id).toBeDefined();
        expect(r1.tenantId.toString()).toBe(tenant._id.toString());
      });

      // Attempting a second restaurant for the same tenant must fail with unique index duplicate key error
      await expect(
        runWithTenant(tenant._id, async () => {
          return Restaurant.create({
            name: 'Biryani House Express',
            phone: '+919876543211',
            email: 'express@biryanihouse.com',
            address: sampleAddress,
          });
        }),
      ).rejects.toThrow(/E11000.*duplicate key/);
    });

    it('allows one restaurant per tenant across two different tenants', async () => {
      const tenantA = await Tenant.create({
        name: 'Tenant A',
        slug: 'tenant-a',
      });
      const tenantB = await Tenant.create({
        name: 'Tenant B',
        slug: 'tenant-b',
      });

      const restA = await runWithTenant(tenantA._id, async () => {
        return Restaurant.create({
          name: 'Restaurant A',
          phone: '+919876543210',
          email: 'a@food.com',
          address: sampleAddress,
        });
      });

      const restB = await runWithTenant(tenantB._id, async () => {
        return Restaurant.create({
          name: 'Restaurant B',
          phone: '+919876543211',
          email: 'b@food.com',
          address: sampleAddress,
        });
      });

      expect(restA.tenantId.toString()).toBe(tenantA._id.toString());
      expect(restB.tenantId.toString()).toBe(tenantB._id.toString());
    });

    it('throws TenantScopingError when queried without tenant context', async () => {
      await expect(Restaurant.find()).rejects.toThrow(TenantScopingError);
    });
  });

  describe('Branch Model', () => {
    it('enforces at most one isMain=true branch per tenant and fails on duplicate isMain=true', async () => {
      const tenant = await Tenant.create({
        name: 'Dosa Plaza',
        slug: 'dosa-plaza',
      });
      const restaurant = await runWithTenant(tenant._id, async () => {
        return Restaurant.create({
          name: 'Dosa Plaza Main',
          phone: '+919876543210',
          email: 'dosa@plaza.com',
          address: sampleAddress,
        });
      });

      // First main branch
      await runWithTenant(tenant._id, async () => {
        const b1 = await Branch.create({
          restaurantId: restaurant._id,
          name: 'Indiranagar Flagship',
          code: 'IND01',
          address: sampleAddress,
          isMain: true,
        });
        expect(b1.isMain).toBe(true);
      });

      // Second main branch in same tenant fails on partial unique index
      await expect(
        runWithTenant(tenant._id, async () => {
          return Branch.create({
            restaurantId: restaurant._id,
            name: 'Koramangala Flagship',
            code: 'KOR01',
            address: sampleAddress,
            isMain: true,
          });
        }),
      ).rejects.toThrow(/E11000.*duplicate key/);
    });

    it('allows isMain=true in two different tenants', async () => {
      const tenantA = await Tenant.create({
        name: 'Tenant Alpha',
        slug: 'tenant-alpha',
      });
      const tenantB = await Tenant.create({
        name: 'Tenant Beta',
        slug: 'tenant-beta',
      });

      const restA = await runWithTenant(tenantA._id, async () => {
        return Restaurant.create({
          name: 'Rest Alpha',
          phone: '+919876543210',
          email: 'alpha@food.com',
          address: sampleAddress,
        });
      });

      const restB = await runWithTenant(tenantB._id, async () => {
        return Restaurant.create({
          name: 'Rest Beta',
          phone: '+919876543211',
          email: 'beta@food.com',
          address: sampleAddress,
        });
      });

      const branchA = await runWithTenant(tenantA._id, async () => {
        return Branch.create({
          restaurantId: restA._id,
          name: 'Alpha Main',
          code: 'MAIN',
          address: sampleAddress,
          isMain: true,
        });
      });

      const branchB = await runWithTenant(tenantB._id, async () => {
        return Branch.create({
          restaurantId: restB._id,
          name: 'Beta Main',
          code: 'MAIN',
          address: sampleAddress,
          isMain: true,
        });
      });

      expect(branchA.isMain).toBe(true);
      expect(branchB.isMain).toBe(true);
    });

    it('allows many isMain=false branches in one tenant', async () => {
      const tenant = await Tenant.create({
        name: 'Multi Branch Tenant',
        slug: 'multi-branch',
      });
      const restaurant = await runWithTenant(tenant._id, async () => {
        return Restaurant.create({
          name: 'Multi Rest',
          phone: '+919876543210',
          email: 'multi@food.com',
          address: sampleAddress,
        });
      });

      await runWithTenant(tenant._id, async () => {
        const b1 = await Branch.create({
          restaurantId: restaurant._id,
          name: 'Branch 1',
          code: 'BR01',
          address: sampleAddress,
          isMain: false,
        });
        const b2 = await Branch.create({
          restaurantId: restaurant._id,
          name: 'Branch 2',
          code: 'BR02',
          address: sampleAddress,
          isMain: false,
        });
        const b3 = await Branch.create({
          restaurantId: restaurant._id,
          name: 'Branch 3',
          code: 'BR03',
          address: sampleAddress,
          isMain: false,
        });

        expect(b1._id).toBeDefined();
        expect(b2._id).toBeDefined();
        expect(b3._id).toBeDefined();
      });

      const count = await runWithTenant(tenant._id, async () => {
        return Branch.countDocuments({ isMain: false });
      });
      expect(count).toBe(3);
    });

    it('enforces branch code uniqueness per tenant while allowing same code across tenants', async () => {
      const tenantA = await Tenant.create({
        name: 'Code Tenant A',
        slug: 'code-tenant-a',
      });
      const tenantB = await Tenant.create({
        name: 'Code Tenant B',
        slug: 'code-tenant-b',
      });

      const restA = await runWithTenant(tenantA._id, async () => {
        return Restaurant.create({
          name: 'Rest A',
          phone: '+919876543210',
          email: 'codea@food.com',
          address: sampleAddress,
        });
      });

      const restB = await runWithTenant(tenantB._id, async () => {
        return Restaurant.create({
          name: 'Rest B',
          phone: '+919876543211',
          email: 'codeb@food.com',
          address: sampleAddress,
        });
      });

      // Tenant A creates branch with code 'CENTRAL'
      await runWithTenant(tenantA._id, async () => {
        await Branch.create({
          restaurantId: restA._id,
          name: 'Tenant A Central',
          code: 'CENTRAL',
          address: sampleAddress,
        });
      });

      // Tenant A creating duplicate code 'CENTRAL' fails
      await expect(
        runWithTenant(tenantA._id, async () => {
          return Branch.create({
            restaurantId: restA._id,
            name: 'Tenant A Second Central',
            code: 'CENTRAL',
            address: sampleAddress,
          });
        }),
      ).rejects.toThrow(/E11000.*duplicate key/);

      // Tenant B creating same code 'CENTRAL' succeeds
      const b2 = await runWithTenant(tenantB._id, async () => {
        return Branch.create({
          restaurantId: restB._id,
          name: 'Tenant B Central',
          code: 'CENTRAL',
          address: sampleAddress,
        });
      });
      expect(b2.code).toBe('CENTRAL');
      expect(b2.tenantId.toString()).toBe(tenantB._id.toString());
    });

    it('throws TenantScopingError when Branch is queried without tenant context', async () => {
      await expect(Branch.find()).rejects.toThrow(TenantScopingError);
    });
  });

  describe('GUARD TEST: Tenant-Scoping Plugin Compliance', () => {
    it('verifies that every registered Mongoose model with a tenantId path has tenantScopingPlugin applied', () => {
      const registeredModels = mongoose.modelNames();
      expect(registeredModels.length).toBeGreaterThan(0);

      for (const modelName of registeredModels) {
        const model = mongoose.model(modelName);
        if ('tenantId' in model.schema.paths) {
          const isScoped = (model.schema.options as Record<string, unknown>)[
            'isTenantScoped'
          ];
          expect(
            isScoped,
            `Model "${modelName}" has a tenantId path but tenantScopingPlugin was not applied!`,
          ).toBe(true);
        }
      }
    });
  });
});
