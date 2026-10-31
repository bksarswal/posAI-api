import { Branch } from './branch.model.js';
import type { BranchDocument } from './branch.interface.js';
import type { BranchResponseDto } from './branch.types.js';
import type {
  CreateBranchInput,
  UpdateBranchInput,
} from './branch.validation.js';
import { RestaurantService } from '../restaurant/index.js';
import { AppError } from '../../utils/appError.js';

export function formatBranch(doc: BranchDocument): BranchResponseDto {
  return {
    id: doc._id.toString(),
    tenantId: doc.tenantId.toString(),
    restaurantId: doc.restaurantId.toString(),
    name: doc.name,
    code: doc.code,
    address: doc.address,
    phone: doc.phone,
    timezone: doc.timezone,
    currency: doc.currency,
    isMain: doc.isMain,
    status: doc.status,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

/**
 * Creates a branch for the active tenant:
 * 1. Verifies that a restaurant exists for the tenant (409 RESTAURANT_REQUIRED).
 * 2. Pre-checks branch code uniqueness within tenant (409 BRANCH_CODE_EXISTS).
 * 3. Automatically assigns isMain=true to the first branch, isMain=false to subsequent branches.
 * 4. Gracefully catches concurrent duplicate key collisions (code 11000) mapping to clean 409 errors.
 */
export async function createBranch(
  input: CreateBranchInput,
): Promise<BranchDocument> {
  const restaurant = await RestaurantService.getRestaurant();
  if (!restaurant) {
    throw new AppError(
      'Restaurant profile must be created before adding branches',
      409,
      'RESTAURANT_REQUIRED',
    );
  }

  const normalizedCode = input.code.toUpperCase();

  const existingWithCode = await Branch.findOne({ code: normalizedCode });
  if (existingWithCode) {
    throw new AppError(
      'A branch with this code already exists for this tenant',
      409,
      'BRANCH_CODE_EXISTS',
    );
  }

  const branchCount = await Branch.countDocuments();
  const isMain = branchCount === 0;

  try {
    const [branch] = await Branch.create([
      {
        ...input,
        code: normalizedCode,
        restaurantId: restaurant._id,
        isMain,
      },
    ]);

    if (!branch) {
      throw new Error('Failed to create branch');
    }

    return branch;
  } catch (err) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as Record<string, unknown>)['code'] === 11000
    ) {
      const errMessage = err instanceof Error ? err.message : String(err);
      if (errMessage.includes('code_1')) {
        throw new AppError(
          'A branch with this code already exists for this tenant',
          409,
          'BRANCH_CODE_EXISTS',
        );
      }

      // Race condition where two first branches attempt to register isMain=true
      throw new AppError(
        'Concurrent branch creation conflict; please retry',
        409,
        'BRANCH_CREATION_CONFLICT',
      );
    }
    throw err;
  }
}

/**
 * Retrieves all branches for the active tenant context.
 */
export async function getBranches(): Promise<BranchDocument[]> {
  return Branch.find().sort({ isMain: -1, createdAt: 1 });
}

/**
 * Retrieves a single branch by its ID for the active tenant context.
 */
export async function getBranchById(
  id: string,
): Promise<BranchDocument | null> {
  return Branch.findById(id);
}

/**
 * Updates a branch for the active tenant:
 * - Setting the main branch to INACTIVE is forbidden (409 CANNOT_DEACTIVATE_MAIN_BRANCH).
 * - Returns 404 RESTAURANT_NOT_FOUND if branch is not found in active tenant.
 */
export async function updateBranch(
  id: string,
  input: UpdateBranchInput,
): Promise<BranchDocument> {
  const branch = await Branch.findById(id);
  if (!branch) {
    throw new AppError('Branch not found', 404, 'BRANCH_NOT_FOUND');
  }

  if (input.status === 'INACTIVE' && branch.isMain) {
    throw new AppError(
      'Cannot deactivate the main branch',
      409,
      'CANNOT_DEACTIVATE_MAIN_BRANCH',
    );
  }

  const updated = await Branch.findByIdAndUpdate(
    id,
    { $set: input },
    { returnDocument: 'after', runValidators: true },
  );

  if (!updated) {
    throw new AppError('Branch not found', 404, 'BRANCH_NOT_FOUND');
  }

  return updated;
}
