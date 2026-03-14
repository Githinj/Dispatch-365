#!/usr/bin/env node

/**
 * Generate Prisma Client
 * This script runs `prisma generate` to create the Prisma client
 * from the schema.prisma file
 */

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

// Find the project root by looking for backend/prisma/schema.prisma
let projectRoot = process.cwd();
const scriptDir = __dirname;

console.log('[v0] Script directory:', scriptDir);
console.log('[v0] Current working directory:', process.cwd());

// Try different possible locations for the project root
const possibleRoots = [
  process.cwd(),
  scriptDir + '/..',
  '/vercel/share/v0-project',
  path.dirname(scriptDir),
];

console.log('[v0] Possible roots to check:', possibleRoots);

for (const root of possibleRoots) {
  const testSchema = path.join(root, 'backend', 'prisma', 'schema.prisma');
  console.log('[v0] Checking:', testSchema, 'exists:', fs.existsSync(testSchema));
  if (fs.existsSync(testSchema)) {
    projectRoot = root;
    console.log('[v0] Found project root at:', projectRoot);
    break;
  }
}

const backendDir = path.join(projectRoot, 'backend');
const schemaPath = path.join(backendDir, 'prisma', 'schema.prisma');

console.log('[Prisma] Generating Prisma client from:', schemaPath);

// Check if schema exists
if (!fs.existsSync(schemaPath)) {
  console.error('[Prisma] Schema file not found at:', schemaPath);
  console.error('[Prisma] Current working directory:', process.cwd());
  process.exit(1);
}

// Find prisma executable
const prismaExe = path.join(backendDir, 'node_modules', 'prisma', 'build', 'index.js');
const prismaBin = path.join(backendDir, 'node_modules', '.bin', 'prisma');

let prismaPath = null;
if (fs.existsSync(prismaBin)) {
  prismaPath = prismaBin;
} else if (fs.existsSync(prismaExe)) {
  prismaPath = prismaExe;
} else {
  console.error('[Prisma] Prisma CLI not found');
  console.error('[Prisma] Checked paths:');
  console.error('[Prisma]   -', prismaBin);
  console.error('[Prisma]   -', prismaExe);
  process.exit(1);
}

console.log('[Prisma] Using prisma executable at:', prismaPath);

try {
  // Change to backend directory and run prisma generate
  process.chdir(backendDir);
  console.log('[Prisma] Working directory:', process.cwd());
  
  execFileSync(prismaPath, ['generate'], {
    stdio: 'inherit',
    shell: false,
  });
  
  console.log('[Prisma] ✓ Client generated successfully!');
  process.exit(0);
} catch (error) {
  console.error('[Prisma] ✗ Failed to generate client:', error.message);
  process.exit(1);
}
