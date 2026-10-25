import type { Types } from 'mongoose';
import type { UserRole } from '../modules/user/user.interface.js';

export interface AuthContext {
  userId: string;
  tenantId: string;
  role: UserRole;
  branchIds: Types.ObjectId[];
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}
