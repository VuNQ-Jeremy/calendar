#!/usr/bin/env node
/**
 * Reset the password for an existing account (e.g. dev@mochi.edu).
 *
 * Generates a PBKDF2-SHA256 hash in the exact format the Worker verifies
 * (see server/services/crypto.ts) and prints the wrangler command to apply it.
 *
 * Usage:
 *   node scripts/reset-password.mjs <email> <new-password> [--local|--remote]
 *
 * With --local (default) or --remote, the matching `wrangler d1 execute`
 * command is printed so you can review it before running. Pipe to a shell to
 * apply directly, e.g.:
 *   node scripts/reset-password.mjs dev@mochi.edu 'NewPass123!' --local | sh
 */

import { webcrypto as crypto } from 'node:crypto';

// Must match server/services/crypto.ts — workerd caps PBKDF2 at 100,000 iterations.
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

const [email, password] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const target = process.argv.includes('--remote') ? '--remote' : '--local';

if (!email || !password) {
  console.error('Usage: node scripts/reset-password.mjs <email> <new-password> [--local|--remote]');
  process.exit(1);
}

const hash = await hashPassword(password);

// Single-quote-safe SQL string literals.
const sqlEmail = email.replace(/'/g, "''");
const sqlHash = hash.replace(/'/g, "''");

const sql = `UPDATE accounts SET password_hash='${sqlHash}' WHERE email='${sqlEmail}';`;

console.error(`# hash: ${hash}`);
console.error(`# Run this to apply the reset (${target}):`);
console.log(`wrangler d1 execute mochi-class ${target} --command "${sql}"`);
