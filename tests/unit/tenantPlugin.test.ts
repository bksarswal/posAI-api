import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose, { Schema, model, Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { tenantScopingPlugin } from '../../src/plugins/tenantScoping.plugin.js';
import { runWithTenant } from '../../src/utils/tenantContext.js';
import { withGlobalScope } from '../../src/utils/tenantBypass.js';
import { TenantScopingError } from '../../src/utils/appError.js';

interface ITestItem {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  name: string;
  category: string;
}

const testItemSchema = new Schema<ITestItem>({
  name: { type: String, required: true },
  category: { type: String, default: 'general' },
});

testItemSchema.plugin(tenantScopingPlugin);

const TestItem = model<ITestItem>('TestItem', testItemSchema);

describe('Tenant Scoping Mongoose Plugin', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    const uri = replSet.getUri();
    await mongoose.connect(uri);
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  beforeEach(async () => {
    await withGlobalScope(async () => {
      await TestItem.deleteMany({});
    });
  });

  describe('Auto-injection of tenantId', () => {
    it('automatically sets tenantId on document save when context is active', async () => {
      const tenantA = new Types.ObjectId();

      const doc = await runWithTenant(tenantA, async () => {
        const item = new TestItem({ name: 'Biryani' });
        return item.save();
      });

      expect(doc.tenantId).toBeDefined();
      expect(doc.tenantId.toString()).toBe(tenantA.toString());
    });

    it('automatically injects tenantId on find and returns only tenant-owned documents', async () => {
      const tenantA = new Types.ObjectId();
      const tenantB = new Types.ObjectId();

      await runWithTenant(tenantA, async () => {
        await new TestItem({ name: 'Tenant A Item' }).save();
      });

      await runWithTenant(tenantB, async () => {
        await new TestItem({ name: 'Tenant B Item' }).save();
      });

      const itemsA = await runWithTenant(tenantA, async () => {
        return TestItem.find();
      });

      expect(itemsA).toHaveLength(1);
      expect(itemsA[0]?.name).toBe('Tenant A Item');

      const itemsB = await runWithTenant(tenantB, async () => {
        return TestItem.find();
      });

      expect(itemsB).toHaveLength(1);
      expect(itemsB[0]?.name).toBe('Tenant B Item');
    });

    it('automatically injects tenantId on findOne, updateOne, and deleteOne', async () => {
      const tenantA = new Types.ObjectId();
      const tenantB = new Types.ObjectId();

      const docA = await runWithTenant(tenantA, async () => {
        return new TestItem({ name: 'Original Name' }).save();
      });

      // Tenant B tries to findOne Tenant A's document
      const notFoundByB = await runWithTenant(tenantB, async () => {
        return TestItem.findOne({ _id: docA._id });
      });
      expect(notFoundByB).toBeNull();

      // Tenant B tries to update Tenant A's document
      await runWithTenant(tenantB, async () => {
        await TestItem.updateOne({ _id: docA._id }, { name: 'Hacked by B' });
      });

      // Verify document was untouched
      const itemAfterB = await runWithTenant(tenantA, async () => {
        return TestItem.findById(docA._id);
      });
      expect(itemAfterB?.name).toBe('Original Name');

      // Tenant A updates successfully
      await runWithTenant(tenantA, async () => {
        await TestItem.updateOne({ _id: docA._id }, { name: 'Updated by A' });
      });

      const updatedItem = await runWithTenant(tenantA, async () => {
        return TestItem.findById(docA._id);
      });
      expect(updatedItem?.name).toBe('Updated by A');

      // Tenant B tries to delete Tenant A's document
      const deleteResultB = await runWithTenant(tenantB, async () => {
        return TestItem.deleteOne({ _id: docA._id });
      });
      expect(deleteResultB.deletedCount).toBe(0);

      // Tenant A deletes successfully
      const deleteResultA = await runWithTenant(tenantA, async () => {
        return TestItem.deleteOne({ _id: docA._id });
      });
      expect(deleteResultA.deletedCount).toBe(1);
    });

    it('automatically scopes countDocuments and distinct queries', async () => {
      const tenantA = new Types.ObjectId();
      const tenantB = new Types.ObjectId();

      await runWithTenant(tenantA, async () => {
        await TestItem.create({ name: 'Item 1', category: 'starter' });
        await TestItem.create({ name: 'Item 2', category: 'dessert' });
      });

      await runWithTenant(tenantB, async () => {
        await TestItem.create({ name: 'Item 3', category: 'beverage' });
      });

      const countA = await runWithTenant(tenantA, async () => {
        return TestItem.countDocuments();
      });
      expect(countA).toBe(2);

      const distinctA = await runWithTenant(tenantA, async () => {
        return TestItem.distinct('category');
      });
      expect(distinctA).toEqual(expect.arrayContaining(['starter', 'dessert']));
      expect(distinctA).not.toContain('beverage');
    });

    it('automatically populates tenantId in insertMany batches', async () => {
      const tenantA = new Types.ObjectId();

      await runWithTenant(tenantA, async () => {
        await TestItem.insertMany([{ name: 'Batch 1' }, { name: 'Batch 2' }]);
      });

      const items = await runWithTenant(tenantA, async () => {
        return TestItem.find();
      });

      expect(items).toHaveLength(2);
      expect(items[0]?.tenantId.toString()).toBe(tenantA.toString());
      expect(items[1]?.tenantId.toString()).toBe(tenantA.toString());
    });

    it('automatically prepends $match tenantId stage in aggregate pipeline', async () => {
      const tenantA = new Types.ObjectId();
      const tenantB = new Types.ObjectId();

      await runWithTenant(tenantA, async () => {
        await TestItem.create({ name: 'Paneer Tikka', category: 'starters' });
        await TestItem.create({ name: 'Chicken Tikka', category: 'starters' });
      });

      await runWithTenant(tenantB, async () => {
        await TestItem.create({ name: 'Spring Roll', category: 'starters' });
      });

      const resultsA = await runWithTenant(tenantA, async () => {
        return TestItem.aggregate<{ _id: string; total: number }>([
          { $group: { _id: '$category', total: { $sum: 1 } } },
        ]);
      });

      expect(resultsA).toHaveLength(1);
      expect(resultsA[0]?.total).toBe(2);
    });
  });

  describe('Unscoped Query & Mutation Rejection', () => {
    it('throws TenantScopingError when find is invoked without context or filter', async () => {
      await expect(TestItem.find().exec()).rejects.toThrow(TenantScopingError);
    });

    it('throws TenantScopingError when findOne is invoked without context or filter', async () => {
      await expect(TestItem.findOne().exec()).rejects.toThrow(
        TenantScopingError,
      );
    });

    it('throws TenantScopingError when new document is saved without tenantId or context', async () => {
      const item = new TestItem({ name: 'Orphan Document' });
      await expect(item.save()).rejects.toThrow(TenantScopingError);
    });

    it('throws TenantScopingError when insertMany is invoked without context', async () => {
      await expect(
        TestItem.insertMany([{ name: 'No Context Item' }]),
      ).rejects.toThrow(TenantScopingError);
    });

    it('throws TenantScopingError when aggregate is invoked without context or match stage', async () => {
      await expect(
        TestItem.aggregate([{ $group: { _id: null, total: { $sum: 1 } } }]),
      ).rejects.toThrow(TenantScopingError);
    });

    it('throws TenantScopingError when query filter specifies mismatched tenantId vs active context', async () => {
      const tenantA = new Types.ObjectId();
      const tenantB = new Types.ObjectId();

      await expect(
        runWithTenant(tenantA, async () => {
          return TestItem.find({ tenantId: tenantB });
        }),
      ).rejects.toThrow(TenantScopingError);
    });

    it('strictly forbids raw bulkWrite on tenant-scoped models', () => {
      expect(() => TestItem.bulkWrite([])).toThrow(TenantScopingError);
      expect(() => TestItem.bulkWrite([])).toThrow(/bulkWrite is forbidden/);
    });
  });

  describe('Nested Operators & Filter Security', () => {
    it('does not leak across tenants when filter contains $or with matching names', async () => {
      const tenantA = new Types.ObjectId();
      const tenantB = new Types.ObjectId();

      await runWithTenant(tenantA, async () => {
        await TestItem.create({ name: 'Biryani' });
      });

      await runWithTenant(tenantB, async () => {
        await TestItem.create({ name: 'Pizza' });
      });

      // Tenant A queries with $or for both items
      const items = await runWithTenant(tenantA, async () => {
        return TestItem.find({
          $or: [{ name: 'Biryani' }, { name: 'Pizza' }],
        });
      });

      // Must strictly return only Biryani (Tenant A's item)
      expect(items).toHaveLength(1);
      expect(items[0]?.name).toBe('Biryani');
      expect(items[0]?.tenantId.toString()).toBe(tenantA.toString());
    });

    it('rejects query if nested $or contains a conflicting tenantId', async () => {
      const tenantA = new Types.ObjectId();
      const tenantB = new Types.ObjectId();

      await expect(
        runWithTenant(tenantA, async () => {
          return TestItem.find({
            $or: [{ tenantId: tenantB, name: 'Biryani' }, { name: 'Curry' }],
          });
        }),
      ).rejects.toThrow(TenantScopingError);
    });
  });

  describe('Update & Mutation Security', () => {
    it('rejects $set of tenantId on an update', async () => {
      const tenantA = new Types.ObjectId();
      const tenantB = new Types.ObjectId();

      const doc = await runWithTenant(tenantA, async () => {
        return TestItem.create({ name: 'Initial Item' });
      });

      await expect(
        runWithTenant(tenantA, async () => {
          return TestItem.updateOne(
            { _id: doc._id },
            { $set: { tenantId: tenantB } },
          );
        }),
      ).rejects.toThrow(TenantScopingError);

      await expect(
        runWithTenant(tenantA, async () => {
          return TestItem.findOneAndUpdate(
            { _id: doc._id },
            { tenantId: tenantB },
          );
        }),
      ).rejects.toThrow(TenantScopingError);
    });

    it('sets context tenantId on upsert operations', async () => {
      const tenantA = new Types.ObjectId();

      await runWithTenant(tenantA, async () => {
        await TestItem.updateOne(
          { name: 'Upserted Item' },
          { $set: { category: 'beverages' } },
          { upsert: true },
        );
      });

      const upserted = await runWithTenant(tenantA, async () => {
        return TestItem.findOne({ name: 'Upserted Item' });
      });

      expect(upserted).not.toBeNull();
      expect(upserted?.tenantId.toString()).toBe(tenantA.toString());
      expect(upserted?.category).toBe('beverages');
    });
  });

  describe('Forbidden Operations on Tenant-Scoped Models', () => {
    it('strictly forbids estimatedDocumentCount', () => {
      expect(() => TestItem.estimatedDocumentCount()).toThrow(
        TenantScopingError,
      );
      expect(() => TestItem.estimatedDocumentCount()).toThrow(
        /estimatedDocumentCount is forbidden/,
      );
    });

    it('strictly forbids aggregate pipelines containing $lookup, $unionWith, $graphLookup, $merge, or $out', async () => {
      const tenantA = new Types.ObjectId();

      await expect(
        runWithTenant(tenantA, async () => {
          return TestItem.aggregate([
            {
              $lookup: {
                from: 'users',
                localField: '_id',
                foreignField: '_id',
                as: 'users',
              },
            },
          ]);
        }),
      ).rejects.toThrow(TenantScopingError);

      await expect(
        runWithTenant(tenantA, async () => {
          return TestItem.aggregate([{ $unionWith: { coll: 'other' } }]);
        }),
      ).rejects.toThrow(TenantScopingError);

      await expect(
        runWithTenant(tenantA, async () => {
          return TestItem.aggregate([{ $merge: { into: 'other' } }]);
        }),
      ).rejects.toThrow(TenantScopingError);

      await expect(
        runWithTenant(tenantA, async () => {
          return TestItem.aggregate([{ $out: 'other' }]);
        }),
      ).rejects.toThrow(TenantScopingError);
    });
  });

  describe('Transaction Session Compatibility', () => {
    it('works seamlessly inside a replica set transaction session', async () => {
      const tenantA = new Types.ObjectId();
      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        await runWithTenant(tenantA, async () => {
          const item = new TestItem({ name: 'Transactional Item' });
          await item.save({ session });

          const foundInTx = await TestItem.findOne({ _id: item._id }).session(
            session,
          );
          expect(foundInTx).not.toBeNull();
          expect(foundInTx?.tenantId.toString()).toBe(tenantA.toString());
          expect(foundInTx?.name).toBe('Transactional Item');
        });

        await session.commitTransaction();
      } finally {
        await session.endSession();
      }

      // Verify item committed and visible in normal queries
      const committedItem = await runWithTenant(tenantA, async () => {
        return TestItem.findOne({ name: 'Transactional Item' });
      });
      expect(committedItem).not.toBeNull();
      expect(committedItem?.tenantId.toString()).toBe(tenantA.toString());
    });
  });

  describe('Legitimate Bypass Mechanism', () => {
    it('allows global queries across all tenants using withGlobalScope', async () => {
      const tenantA = new Types.ObjectId();
      const tenantB = new Types.ObjectId();

      await runWithTenant(tenantA, async () => {
        await TestItem.create({ name: 'Tenant A Item' });
      });

      await runWithTenant(tenantB, async () => {
        await TestItem.create({ name: 'Tenant B Item' });
      });

      const allItems = await withGlobalScope(async () => {
        return TestItem.find();
      });

      expect(allItems).toHaveLength(2);
    });

    it('allows explicit bypass via query option bypassTenantScope', async () => {
      const tenantA = new Types.ObjectId();
      await runWithTenant(tenantA, async () => {
        await TestItem.create({ name: 'Single Item' });
      });

      const items = await TestItem.find().setOptions({
        bypassTenantScope: true,
      });
      expect(items).toHaveLength(1);
    });
  });
});
