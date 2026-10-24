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

interface ITestChild {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  title: string;
  parentId: Types.ObjectId;
}

const testChildSchema = new Schema<ITestChild>({
  title: { type: String, required: true },
  parentId: { type: Schema.Types.ObjectId, ref: 'TestItem', required: true },
});

testChildSchema.plugin(tenantScopingPlugin);

const TestChild = model<ITestChild>('TestChild', testChildSchema);

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
      await TestChild.deleteMany({});
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

  describe('Replacement Operations (findOneAndReplace & replaceOne)', () => {
    it('findOneAndReplace successfully replaces document when replacement matches tenant context', async () => {
      const tenantA = new Types.ObjectId();
      const item = await runWithTenant(tenantA, async () => {
        return TestItem.create({ name: 'Old Item', category: 'old' });
      });

      const replaced = await runWithTenant(tenantA, async () => {
        return TestItem.findOneAndReplace(
          { _id: item._id },
          { name: 'New Item', category: 'new' },
          { returnDocument: 'after' },
        );
      });

      expect(replaced).not.toBeNull();
      expect(replaced?.name).toBe('New Item');
      expect(replaced?.tenantId.toString()).toBe(tenantA.toString());
    });

    it('findOneAndReplace throws TenantScopingError when replacement specifies a different tenantId', async () => {
      const tenantA = new Types.ObjectId();
      const tenantB = new Types.ObjectId();
      const item = await runWithTenant(tenantA, async () => {
        return TestItem.create({ name: 'Old Item' });
      });

      await expect(
        runWithTenant(tenantA, async () => {
          return TestItem.findOneAndReplace(
            { _id: item._id },
            { name: 'Hijacked Item', tenantId: tenantB },
          );
        }),
      ).rejects.toThrow(TenantScopingError);
    });

    it('replaceOne auto-sets tenantId when replacement document has missing tenantId', async () => {
      const tenantA = new Types.ObjectId();
      const item = await runWithTenant(tenantA, async () => {
        return TestItem.create({ name: 'Before Replace' });
      });

      await runWithTenant(tenantA, async () => {
        await TestItem.replaceOne(
          { _id: item._id },
          { name: 'After Replace', category: 'replaced' },
        );
      });

      const found = await runWithTenant(tenantA, async () => {
        return TestItem.findById(item._id);
      });
      expect(found).not.toBeNull();
      expect(found?.name).toBe('After Replace');
      expect(found?.tenantId.toString()).toBe(tenantA.toString());
    });

    it('replaceOne rejects replacement document when replacement has a different tenantId', async () => {
      const tenantA = new Types.ObjectId();
      const tenantB = new Types.ObjectId();
      const item = await runWithTenant(tenantA, async () => {
        return TestItem.create({ name: 'Before Replace' });
      });

      await expect(
        runWithTenant(tenantA, async () => {
          return TestItem.replaceOne(
            { _id: item._id },
            { name: 'Cross Tenant Replace', tenantId: tenantB },
          );
        }),
      ).rejects.toThrow(TenantScopingError);
    });

    it('throws TenantScopingError when findOneAndReplace is executed without tenant context', async () => {
      await expect(
        TestItem.findOneAndReplace(
          { name: 'Unscoped Target' },
          { name: 'Unscoped Replacement' },
        ),
      ).rejects.toThrow(TenantScopingError);
    });
  });

  describe('Aggregation Pipeline Updates Rejection', () => {
    it('forbids array-form pipeline update on updateOne', async () => {
      const tenantA = new Types.ObjectId();
      const item = await runWithTenant(tenantA, async () => {
        return TestItem.create({ name: 'Original Name' });
      });

      await expect(
        runWithTenant(tenantA, async () => {
          return TestItem.updateOne(
            { _id: item._id },
            [{ $set: { name: 'Pipeline Updated Name' } }],
            { updatePipeline: true },
          );
        }),
      ).rejects.toThrow(TenantScopingError);
    });

    it('forbids array-form pipeline update on updateMany', async () => {
      const tenantA = new Types.ObjectId();

      await expect(
        runWithTenant(tenantA, async () => {
          return TestItem.updateMany(
            { category: 'general' },
            [{ $set: { category: 'new-pipeline' } }],
            { updatePipeline: true },
          );
        }),
      ).rejects.toThrow(TenantScopingError);
    });

    it('forbids array-form pipeline update on findOneAndUpdate', async () => {
      const tenantA = new Types.ObjectId();

      await expect(
        runWithTenant(tenantA, async () => {
          return TestItem.findOneAndUpdate(
            { name: 'Test' },
            [{ $set: { name: 'Pipelined' } }],
            { updatePipeline: true },
          );
        }),
      ).rejects.toThrow(TenantScopingError);
    });
  });

  describe('Cursor Queries Scoping', () => {
    it('cursor() on a find remains scoped to active tenant', async () => {
      const tenantA = new Types.ObjectId();
      const tenantB = new Types.ObjectId();

      await runWithTenant(tenantA, async () => {
        await TestItem.create({ name: 'Tenant A Item 1' });
        await TestItem.create({ name: 'Tenant A Item 2' });
      });

      await runWithTenant(tenantB, async () => {
        await TestItem.create({ name: 'Tenant B Item 1' });
      });

      const cursorResults = await runWithTenant(tenantA, async () => {
        const cursor = TestItem.find().cursor();
        const items: string[] = [];
        for await (const doc of cursor) {
          items.push(doc.name);
        }
        return items;
      });

      expect(cursorResults).toHaveLength(2);
      expect(cursorResults).toEqual(
        expect.arrayContaining(['Tenant A Item 1', 'Tenant A Item 2']),
      );
    });

    it('cursor() without tenant context throws TenantScopingError on execution', async () => {
      const cursor = TestItem.find().cursor();
      await expect(async () => {
        for await (const _doc of cursor) {
          // should throw on cursor iteration
        }
      }).rejects.toThrow(TenantScopingError);
    });
  });

  describe('Populate Between Scoped Models', () => {
    it('populates reference correctly when parent belongs to same tenant', async () => {
      const tenantA = new Types.ObjectId();

      const { childId } = await runWithTenant(tenantA, async () => {
        const parent = await TestItem.create({ name: 'Parent A' });
        const child = await TestChild.create({
          title: 'Child A',
          parentId: parent._id,
        });
        return { childId: child._id, parentId: parent._id };
      });

      const populatedChild = await runWithTenant(tenantA, async () => {
        return TestChild.findById(childId).populate<{ parentId: ITestItem }>(
          'parentId',
        );
      });

      expect(populatedChild).not.toBeNull();
      expect(populatedChild?.parentId).not.toBeNull();
      expect(populatedChild?.parentId.name).toBe('Parent A');
      expect(populatedChild?.parentId.tenantId.toString()).toBe(
        tenantA.toString(),
      );
    });

    it('resolves populated reference to null when parent belongs to a different tenant', async () => {
      const tenantA = new Types.ObjectId();
      const tenantB = new Types.ObjectId();

      // Tenant B creates parent
      const parentB = await runWithTenant(tenantB, async () => {
        return TestItem.create({ name: 'Secret Parent B' });
      });

      // Tenant A creates child pointing to Tenant B's parent ID
      const childA = await runWithTenant(tenantA, async () => {
        return TestChild.create({
          title: 'Child A pointing to B',
          parentId: parentB._id,
        });
      });

      // Tenant A populates child
      const populatedChild = await runWithTenant(tenantA, async () => {
        return TestChild.findById(childA._id).populate<{
          parentId: ITestItem | null;
        }>('parentId');
      });

      expect(populatedChild).not.toBeNull();
      // Because parent is tenant-scoped, Tenant B's parent cannot be returned to Tenant A
      expect(populatedChild?.parentId).toBeNull();
    });

    it('populate without tenant context throws TenantScopingError', async () => {
      const dummyId = new Types.ObjectId();
      await expect(
        TestChild.findById(dummyId).populate('parentId').exec(),
      ).rejects.toThrow(TenantScopingError);
    });
  });
});
