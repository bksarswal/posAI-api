import type { Request, Response } from 'express';
import * as BranchService from './branch.service.js';
import { formatBranch } from './branch.service.js';
import {
  canUserAccessBranch,
  filterAccessibleBranches,
} from './branch.access.js';
import { sendSuccess } from '../../utils/response.js';
import { AppError } from '../../utils/appError.js';
import { objectIdParam } from '../../utils/validators.js';

export { formatBranch };

export async function createBranch(
  req: Request,
  res: Response,
): Promise<Response> {
  const branch = await BranchService.createBranch(req.body);
  return sendSuccess(res, {
    statusCode: 201,
    message: 'Branch created successfully',
    data: { branch: formatBranch(branch) },
  });
}

export async function getBranches(
  req: Request,
  res: Response,
): Promise<Response> {
  const allBranches = await BranchService.getBranches();
  const accessible = filterAccessibleBranches(req.auth!, allBranches);

  return sendSuccess(res, {
    statusCode: 200,
    message: 'Branches retrieved successfully',
    data: { branches: accessible.map(formatBranch) },
  });
}

export async function getBranchById(
  req: Request,
  res: Response,
): Promise<Response> {
  const branchId = objectIdParam(req.params['id'] as string);
  const branch = await BranchService.getBranchById(branchId);

  // If branch belongs to another tenant or does not exist -> 404
  if (!branch) {
    throw new AppError('Branch not found', 404, 'BRANCH_NOT_FOUND');
  }

  // Branch access check: if user cannot access branch -> 404 (never 403)
  if (!canUserAccessBranch(req.auth!, branch._id)) {
    throw new AppError('Branch not found', 404, 'BRANCH_NOT_FOUND');
  }

  return sendSuccess(res, {
    statusCode: 200,
    message: 'Branch retrieved successfully',
    data: { branch: formatBranch(branch) },
  });
}

export async function updateBranch(
  req: Request,
  res: Response,
): Promise<Response> {
  const branchId = objectIdParam(req.params['id'] as string);
  const branch = await BranchService.updateBranch(branchId, req.body);

  return sendSuccess(res, {
    statusCode: 200,
    message: 'Branch updated successfully',
    data: { branch: formatBranch(branch) },
  });
}
