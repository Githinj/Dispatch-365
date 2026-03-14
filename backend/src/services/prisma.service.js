const { PrismaClient } = require("@prisma/client");

// Prisma v7 requires datasourceUrl to be passed to constructor
const prisma = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL,
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
