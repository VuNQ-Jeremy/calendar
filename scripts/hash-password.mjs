#!/usr/bin/env node
/**
 * Generate a PBKDF2-SHA256 password hash for bootstrapping admin accounts.
 *
 * Usage:
 *   node scripts/hash-password.mjs <password>
 *
 * Then insert the admin account:
 *   wrangler d1 execute mochi-class --remote --command \
 *     "INSERT INTO accounts (id, email, password_hash, staff_id, created_at)
 *      VALUES ('acc-admin-0001', 'admin@mochi.edu', '<hash>', 'admin-0000-0000-0000-000000000001', datetime('now'))
 *      ON CONFLICT(email) DO UPDATE SET password_hash=excluded.password_hash;"
 */

import { webcrypto } from 'node:crypto';

const crypto = webcrypto;
// Must match server/services/crypto.ts — Workers caps PBKDF2 at 100,000 iterations.
const ITERATIONS = 100_000;

function b64(buf) {
  return Buffer.from(buf).toString('base64');
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const hash = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS },
      key,
      256,
    ),
  );
  return `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(hash)}`;
}

const password = process.argv[2];
if (!password) {
  console.error('Usage: node scripts/hash-password.mjs <password>');
  process.exit(1);
}

const hash = await hashPassword(password);
console.log(hash);
