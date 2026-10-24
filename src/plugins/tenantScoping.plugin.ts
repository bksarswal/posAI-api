import {
  Schema,
  Types,
  type Query,
  type Aggregate,
  type Document,
} from 'mongoose';
import { getTenantId, isTenantBypassed } from '../utils/tenantContext.js';
import { TenantScopingError } from '../utils/appError.js';

const QUERY_HOOKS = [
  'find',
  'findOne',
  'findOneAndUpdate',
  'findOneAndDelete',
  'findOneAndReplace',
  'updateOne',
  'updateMany',
  'deleteOne',
  'deleteMany',
  'replaceOne',
  'countDocuments',
  'distinct',
] as const;

const FORBIDDEN_AGGREGATE_STAGES = [
  '$lookup',
  '$unionWith',
  '$graphLookup',
  '$merge',
  '$out',
] as const;

/**
 * Recursively inspects query filter to ensure any nested tenantId references
 * strictly match the active tenantId and do not attempt to leak or cross-query.
 */
function validateNestedTenantFilters(
  filter: unknown,
  activeTenantId: Types.ObjectId,
): void {
  if (!filter || typeof filter !== 'object') {
    return;
  }

  if (Array.isArray(filter)) {
    for (const item of filter) {
      validateNestedTenantFilters(item, activeTenantId);
    }
    return;
  }

  for (const [key, value] of Object.entries(filter)) {
    if (key === 'tenantId') {
      if (value instanceof Types.ObjectId || typeof value === 'string') {
        if (value.toString() !== activeTenantId.toString()) {
          throw new TenantScopingError(
            `Cross-tenant query violation: Nested tenantId (${String(value)}) does not match active context (${activeTenantId.toString()})`,
          );
        }
      } else if (value && typeof value === 'object') {
        const valObj = value as Record<string, unknown>;
        const inArray = valObj['$in'];
        if (Array.isArray(inArray)) {
          for (const item of inArray) {
            if (item?.toString() !== activeTenantId.toString()) {
              throw new TenantScopingError(
                `Cross-tenant query violation: $in tenantId contains mismatched tenant (${String(item)})`,
              );
            }
          }
        }
      }
    } else {
      validateNestedTenantFilters(value, activeTenantId);
    }
  }
}

export function tenantScopingPlugin(schema: Schema): void {
  // Mark schema as tenant-scoped so guard tests can verify compliance
  (schema.options as Record<string, unknown>)['isTenantScoped'] = true;

  // 1. Ensure tenantId path exists in schema
  if (!schema.path('tenantId')) {
    schema.add({
      tenantId: {
        type: Schema.Types.ObjectId,
        ref: 'Tenant',
        required: true,
      },
    });
  }

  // 2. Query Hooks: Enforce tenantId in query filters & validate updates/upserts
  for (const hook of QUERY_HOOKS) {
    schema.pre(hook, function (this: Query<unknown, unknown>) {
      const options = this.getOptions() as Record<string, unknown>;
      if (options['bypassTenantScope'] === true || isTenantBypassed()) {
        return;
      }

      const activeTenantId = getTenantId();

      // Validate mutations: Prevent mutating tenantId on existing documents & handle replacements
      if (
        hook === 'updateOne' ||
        hook === 'updateMany' ||
        hook === 'findOneAndUpdate' ||
        hook === 'replaceOne' ||
        hook === 'findOneAndReplace'
      ) {
        const update = this.getUpdate();

        // Forbid pipeline-style updates (array form) on tenant-scoped models
        if (Array.isArray(update)) {
          throw new TenantScopingError(
            'Pipeline-style updates are forbidden on tenant-scoped models to prevent unscoped mutations.',
          );
        }

        if (update && typeof update === 'object') {
          const updateObj = update as Record<string, unknown>;

          if (hook === 'replaceOne' || hook === 'findOneAndReplace') {
            // Replacement documents: validate tenantId or auto-set to activeTenantId
            if (
              updateObj['tenantId'] !== undefined &&
              updateObj['tenantId'] !== null
            ) {
              if (
                activeTenantId &&
                updateObj['tenantId'].toString() !== activeTenantId.toString()
              ) {
                throw new TenantScopingError(
                  `Cross-tenant replacement rejected: Replacement document tenantId (${String(
                    updateObj['tenantId'],
                  )}) does not match active context (${activeTenantId.toString()})`,
                );
              }
            } else if (activeTenantId) {
              updateObj['tenantId'] = activeTenantId;
              this.setUpdate(updateObj);
            }
          } else {
            // Standard updates: strictly forbid modifying tenantId
            if ('tenantId' in updateObj) {
              throw new TenantScopingError(
                'Mutating tenantId on an existing document is strictly forbidden.',
              );
            }
            for (const op of ['$set', '$unset', '$rename', '$inc']) {
              const opObj = updateObj[op] as
                Record<string, unknown> | undefined;
              if (opObj && 'tenantId' in opObj) {
                throw new TenantScopingError(
                  'Mutating tenantId on an existing document is strictly forbidden.',
                );
              }
            }

            // Handle upsert: Ensure context tenantId is set on newly created document
            if (options['upsert'] && activeTenantId) {
              const setOnInsert =
                (updateObj['$setOnInsert'] as Record<string, unknown>) || {};
              if (!setOnInsert['tenantId'] && !updateObj['tenantId']) {
                setOnInsert['tenantId'] = activeTenantId;
                updateObj['$setOnInsert'] = setOnInsert;
                this.setUpdate(updateObj);
              }
            }
          }
        }
      }

      const query = this.getQuery() as Record<string, unknown>;

      if (query['tenantId'] !== undefined) {
        if (
          activeTenantId &&
          query['tenantId']?.toString() !== activeTenantId.toString()
        ) {
          throw new TenantScopingError(
            `Cross-tenant query violation: Filter tenantId (${String(query['tenantId'])}) does not match active context (${activeTenantId.toString()})`,
          );
        }
        return;
      }

      if (activeTenantId) {
        // Validate any nested $or / $and / $nor filters
        validateNestedTenantFilters(query, activeTenantId);
        this.where({ tenantId: activeTenantId });
        return;
      }

      throw new TenantScopingError(
        `Unscoped query rejected: Query '${hook}' on tenant-scoped model missing tenantId filter and execution context.`,
      );
    });
  }

  // Helper for document lifecycle
  function autoSetTenantIdOnDocument(doc: Document & { tenantId?: unknown }) {
    if (isTenantBypassed()) {
      return;
    }

    if (doc.isNew && !doc.tenantId) {
      const activeTenantId = getTenantId();
      if (activeTenantId) {
        doc.tenantId = activeTenantId;
      } else {
        throw new TenantScopingError(
          'Unscoped document save rejected: New document on tenant-scoped model missing tenantId and execution context.',
        );
      }
    }
  }

  // 3. Document Hooks: Validate & Save
  schema.pre('validate', function (this: Document & { tenantId?: unknown }) {
    autoSetTenantIdOnDocument(this);
  });

  schema.pre('save', function (this: Document & { tenantId?: unknown }) {
    autoSetTenantIdOnDocument(this);
  });

  // 4. insertMany Hook: Enforce tenantId across all batch items
  schema.pre('insertMany', function (docs: unknown) {
    if (isTenantBypassed()) {
      return;
    }

    const activeTenantId = getTenantId();
    if (Array.isArray(docs)) {
      for (const item of docs) {
        const doc = item as Record<string, unknown>;
        if (!doc['tenantId']) {
          if (activeTenantId) {
            doc['tenantId'] = activeTenantId;
          } else {
            throw new TenantScopingError(
              'Unscoped insertMany rejected: Document in batch missing tenantId and execution context.',
            );
          }
        }
      }
    }
  });

  // 5. Forbid raw bulkWrite on tenant-scoped models
  schema.static('bulkWrite', function () {
    throw new TenantScopingError(
      'bulkWrite is forbidden on tenant-scoped models to prevent unscoped mutations. Use transactions or standard atomic operations instead.',
    );
  });

  // 6. Forbid estimatedDocumentCount on tenant-scoped models
  schema.static('estimatedDocumentCount', function () {
    throw new TenantScopingError(
      'estimatedDocumentCount is forbidden on tenant-scoped models as it cannot be scoped to a tenant. Use countDocuments instead.',
    );
  });

  // 7. Aggregation Pipeline Hook: Check forbidden stages & prepend $match { tenantId } at stage 0
  schema.pre('aggregate', function (this: Aggregate<unknown>) {
    const options = (this.options || {}) as Record<string, unknown>;
    if (options['bypassTenantScope'] === true || isTenantBypassed()) {
      return;
    }

    const activeTenantId = getTenantId();
    const pipeline = this.pipeline();

    // Forbid cross-collection & export stages
    for (const stage of pipeline) {
      for (const forbidden of FORBIDDEN_AGGREGATE_STAGES) {
        if (forbidden in stage) {
          throw new TenantScopingError(
            `Stage '${forbidden}' is forbidden on tenant-scoped models to prevent cross-tenant data leaks.`,
          );
        }
      }
    }

    const firstStage = pipeline[0] as
      { $match?: Record<string, unknown> } | undefined;

    const firstStageMatchTenant = firstStage?.$match?.['tenantId'];
    if (firstStageMatchTenant !== undefined && firstStageMatchTenant !== null) {
      if (
        activeTenantId &&
        firstStageMatchTenant.toString() !== activeTenantId.toString()
      ) {
        throw new TenantScopingError(
          `Cross-tenant aggregate violation: Pipeline stage 0 tenantId (${String(firstStageMatchTenant)}) does not match active context (${activeTenantId.toString()})`,
        );
      }
      return;
    }

    if (activeTenantId) {
      pipeline.unshift({ $match: { tenantId: activeTenantId } });
      return;
    }

    throw new TenantScopingError(
      'Unscoped aggregate rejected: Pipeline on tenant-scoped model missing $match tenantId stage and execution context.',
    );
  });
}
