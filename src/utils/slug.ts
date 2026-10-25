import crypto from 'node:crypto';

/**
 * Generates a 6-character random lowercase base-36 string.
 */
function randomBase36Suffix(): string {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
  const bytes = crypto.randomBytes(6);
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars[bytes[i]! % chars.length];
  }
  return result;
}

/**
 * Generates a URL-friendly slug from a business name:
 * - Lowercase
 * - Non-alphanumeric characters replaced with '-'
 * - Consecutive '-' collapsed and trimmed
 * - Base slug truncated to at most 40 characters
 * - Fallback to "restaurant" if empty
 * - Appends '-' and 6 random lowercase base36 characters
 */
export function generateTenantSlug(name: string): string {
  let base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (base.length > 40) {
    base = base.substring(0, 40).replace(/-+$/, '');
  }

  if (!base) {
    base = 'restaurant';
  }

  const suffix = randomBase36Suffix();
  return `${base}-${suffix}`;
}
