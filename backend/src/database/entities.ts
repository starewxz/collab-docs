import { join } from 'path';

/**
 * Glob discovery so every module can colocate `*.entity.ts` files without
 * this list needing to be updated per domain module.
 */
export const ENTITIES = [join(__dirname, '..', '**', '*.entity.{ts,js}')];
