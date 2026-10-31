import { logger } from './logger.js';
import type { Types } from 'mongoose';

export interface AuditLogOptions {
  action: string;
  actorId: string | Types.ObjectId;
  tenantId: string | Types.ObjectId;
  targetId?: string | Types.ObjectId;
  details?: Record<string, unknown>;
}

/**
 * Structured audit logging helper.
 * Emits an info-level log with audit: true for security and compliance tracking.
 * Security notice: Passwords, tokens, or sensitive credentials MUST NEVER be passed in details.
 */
export function auditLog({
  action,
  actorId,
  tenantId,
  targetId,
  details,
}: AuditLogOptions): void {
  logger.info(
    {
      audit: true,
      action,
      actorId: actorId.toString(),
      tenantId: tenantId.toString(),
      ...(targetId ? { targetId: targetId.toString() } : {}),
      ...(details ? { details } : {}),
    },
    `[AUDIT] ${action}`,
  );
}
