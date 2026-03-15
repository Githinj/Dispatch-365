// Mock Prisma client for development mode
// In production with DATABASE_URL set, Prisma would connect to a real database
const prisma = {
  $connect: async () => {
    console.log("[Prisma] Mock connection established");
  },
  $disconnect: async () => {
    console.log("[Prisma] Mock disconnection");
  },
  // Mock database methods
  user: {
    findUnique: async () => null,
    findMany: async () => [],
    create: async (data) => data,
    update: async (data) => data,
    delete: async () => ({ id: "mock" }),
  },
  agency: {
    findUnique: async () => null,
    findMany: async () => [],
    create: async (data) => data,
    update: async (data) => data,
    delete: async () => ({ id: "mock" }),
  },
  driver: {
    findUnique: async () => null,
    findMany: async () => [],
    create: async (data) => data,
    update: async (data) => data,
    delete: async () => ({ id: "mock" }),
  },
  vehicle: {
    findUnique: async () => null,
    findMany: async () => [],
    create: async (data) => data,
    update: async (data) => data,
    delete: async () => ({ id: "mock" }),
  },
  load: {
    findUnique: async () => null,
    findMany: async () => [],
    create: async (data) => data,
    update: async (data) => data,
    delete: async () => ({ id: "mock" }),
  },
  invoice: {
    findUnique: async () => null,
    findMany: async () => [],
    findFirst: async () => null,
    create: async (data) => data,
    update: async (data) => data,
    delete: async () => ({ id: "mock" }),
  },
  notification: {
    findUnique: async () => null,
    findMany: async () => [],
    create: async (data) => data,
    update: async (data) => data,
    delete: async () => ({ id: "mock" }),
  },
  session: {
    findUnique: async () => null,
    findMany: async () => [],
    create: async (data) => data,
    update: async (data) => data,
    delete: async () => ({ id: "mock" }),
    deleteMany: async () => ({ count: 0 }),
  },
};

async function connectDatabase() {
  await prisma.$connect();
}

async function disconnectDatabase() {
  await prisma.$disconnect();
}

module.exports = { prisma, connectDatabase, disconnectDatabase };

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
