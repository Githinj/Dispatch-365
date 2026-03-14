const { PrismaClient } = require("@prisma/client");

// Prisma v7 configuration
// Connection URL will be read from DATABASE_URL environment variable via prisma.config.ts
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["query", "warn", "error"] : ["error"],
});

async function connectDatabase() {
  try {
    await prisma.$connect();
    console.log("[Prisma] Connected to database");
  } catch (error) {
    console.error("[Prisma] Connection failed:", error.message);
    process.exit(1);
  }
}

async function disconnectDatabase() {
  await prisma.$disconnect();
  console.log("[Prisma] Disconnected from database");
}

module.exports = { prisma, connectDatabase, disconnectDatabase };
