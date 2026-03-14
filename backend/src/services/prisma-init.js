/**
 * Prisma Client Initialization
 * Ensures Prisma client is generated before attempting to use it
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const prismaClientPath = path.join(__dirname, '../../node_modules/.prisma/client');

function ensurePrismaClientGenerated() {
  if (fs.existsSync(prismaClientPath)) {
    console.log('[Prisma] Client already generated');
    return true;
  }

  console.log('[Prisma] Client not found, generating...');
  
  try {
    const prismaExe = path.join(__dirname, '../../node_modules/.bin/prisma');
    
    if (!fs.existsSync(prismaExe)) {
      console.error('[Prisma] Prisma CLI not found at:', prismaExe);
      return false;
    }

    console.log('[Prisma] Running: prisma generate');
    execSync(`"${prismaExe}" generate`, {
      cwd: path.join(__dirname, '../..'),
      stdio: 'inherit',
      shell: true,
    });

    console.log('[Prisma] Client generated successfully');
    return true;
  } catch (error) {
    console.error('[Prisma] Failed to generate client:', error.message);
    return false;
  }
}

module.exports = { ensurePrismaClientGenerated };
