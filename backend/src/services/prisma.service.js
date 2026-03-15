const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");

// Prisma v7 requires an adapter. Use the native pg adapter for PostgreSQL.
let prisma;

try {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const adapter = new PrismaPg(pool);

  prisma = new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["query", "warn", "error"] : ["error"],
  });
} catch (error) {
  // Fallback: create a mock prisma client for development without DATABASE_URL
  console.warn("[Prisma] Failed to initialize with adapter:", error.message);
  prisma = {
    $connect: async () => console.log("[Prisma] Mock connection"),
    $disconnect: async () => console.log("[Prisma] Mock disconnection"),
  };
}

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
