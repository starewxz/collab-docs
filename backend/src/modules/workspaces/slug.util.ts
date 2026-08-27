import { randomBytes } from 'crypto';

export function slugify(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base.length > 0 ? base : 'workspace';
}

export function slugSuffix(): string {
  return randomBytes(3).toString('hex');
}
