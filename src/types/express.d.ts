import type { Types } from 'mongoose';
import type { Role } from '../modules/user/index.js';

export interface AuthContext {
  userId: string;
  tenantId: string;
  role: Role;
  branchIds: Types.ObjectId[];
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}
