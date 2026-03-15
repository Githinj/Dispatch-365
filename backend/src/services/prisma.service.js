const { PrismaClient } = require("@prisma/client");

// Prisma v5 client initialization
let prisma;

try {
  prisma = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "warn", "error"] : ["error"],
  });
} catch (error) {
  // Fallback: create a mock prisma client for development
  console.warn("[Prisma] Failed to initialize client:", error.message);
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
