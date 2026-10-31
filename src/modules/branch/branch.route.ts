import { Router } from 'express';
import * as BranchController from './branch.controller.js';
import {
  createBranchSchema,
  updateBranchSchema,
  branchResponseSchema,
} from './branch.validation.js';
import { validateBody } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import {
  openApiRegistry,
  SuccessResponseSchema,
  ErrorResponseSchema,
} from '../../config/openapi.js';
import { z } from 'zod';

const branchEnvelopeSchema = SuccessResponseSchema.extend({
  data: z.object({
    branch: branchResponseSchema,
  }),
});

const branchListEnvelopeSchema = SuccessResponseSchema.extend({
  data: z.object({
    branches: z.array(branchResponseSchema),
  }),
});

// Register OpenAPI path for POST /api/v1/branches
openApiRegistry.registerPath({
  method: 'post',
  path: '/api/v1/branches',
  summary: 'Create a new branch',
  description:
    'Creates a new branch for the tenant. OWNER and ADMIN only. Requires an existing restaurant. First branch is automatically assigned isMain=true.',
  tags: ['Branches'],
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      description: 'Branch creation payload',
      content: {
        'application/json': {
          schema: createBranchSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Branch created successfully',
      content: {
        'application/json': {
          schema: branchEnvelopeSchema,
        },
      },
    },
    400: {
      description: 'Validation failed or forbidden fields (isMain, etc.)',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    401: {
      description: 'Unauthorized',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    403: {
      description: 'Forbidden - OWNER or ADMIN role required',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    409: {
      description: 'Restaurant required or duplicate branch code',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// Register OpenAPI path for GET /api/v1/branches
openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/branches',
  summary: 'List accessible branches',
  description:
    'Retrieves branches for the active tenant. OWNER and ADMIN see all branches; other roles see only assigned branches.',
  tags: ['Branches'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Branches retrieved successfully',
      content: {
        'application/json': {
          schema: branchListEnvelopeSchema,
        },
      },
    },
    401: {
      description: 'Unauthorized',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// Register OpenAPI path for GET /api/v1/branches/{id}
openApiRegistry.registerPath({
  method: 'get',
  path: '/api/v1/branches/{id}',
  summary: 'Get branch by ID',
  description:
    'Retrieves a branch by ID. Returns 404 if the branch does not exist, belongs to another tenant, or the user lacks access.',
  tags: ['Branches'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      id: z.string().describe('Branch MongoDB ObjectId'),
    }),
  },
  responses: {
    200: {
      description: 'Branch retrieved successfully',
      content: {
        'application/json': {
          schema: branchEnvelopeSchema,
        },
      },
    },
    400: {
      description: 'Invalid ObjectId parameter (INVALID_ID)',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    401: {
      description: 'Unauthorized',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    404: {
      description: 'Branch not found (BRANCH_NOT_FOUND)',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// Register OpenAPI path for PATCH /api/v1/branches/{id}
openApiRegistry.registerPath({
  method: 'patch',
  path: '/api/v1/branches/{id}',
  summary: 'Update branch by ID',
  description:
    'Updates editable branch fields. OWNER and ADMIN only. Cannot deactivate main branch (409 CANNOT_DEACTIVATE_MAIN_BRANCH).',
  tags: ['Branches'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      id: z.string().describe('Branch MongoDB ObjectId'),
    }),
    body: {
      description: 'Branch update payload (strict partial, non-empty)',
      content: {
        'application/json': {
          schema: updateBranchSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Branch updated successfully',
      content: {
        'application/json': {
          schema: branchEnvelopeSchema,
        },
      },
    },
    400: {
      description: 'Validation failed, invalid ID, or unmodifiable fields',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    401: {
      description: 'Unauthorized',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    403: {
      description: 'Forbidden - OWNER or ADMIN role required',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    404: {
      description: 'Branch not found (BRANCH_NOT_FOUND)',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    409: {
      description:
        'Cannot deactivate main branch (CANNOT_DEACTIVATE_MAIN_BRANCH)',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

export const branchRouter = Router();

branchRouter.post(
  '/',
  authenticate,
  authorize('OWNER', 'ADMIN'),
  validateBody(createBranchSchema),
  BranchController.createBranch,
);

branchRouter.get('/', authenticate, BranchController.getBranches);

branchRouter.get('/:id', authenticate, BranchController.getBranchById);

branchRouter.patch(
  '/:id',
  authenticate,
  authorize('OWNER', 'ADMIN'),
  validateBody(updateBranchSchema),
  BranchController.updateBranch,
);
