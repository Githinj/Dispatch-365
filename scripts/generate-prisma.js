#!/usr/bin/env node

/**
 * Generate Prisma Client
 * This script runs `prisma generate` to create the Prisma client
 * from the schema.prisma file
 */

const { execSync } = require('child_process');
const path = require('path');

const backendDir = path.join(__dirname, '../backend');

console.log('[Prisma] Generating Prisma client...');

try {
  execSync('npx prisma generate', {
    cwd: backendDir,
    stdio: 'inherit',
  });
  console.log('[Prisma] Client generated successfully!');
  process.exit(0);
} catch (error) {
  console.error('[Prisma] Failed to generate client:', error.message);
  process.exit(1);
}
