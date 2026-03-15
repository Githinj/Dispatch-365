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
    findFirst: async () => null,
    create: async (data) => data,
    update: async (data) => data,
    delete: async () => ({ id: "mock" }),
    deleteMany: async () => ({ count: 0 }),
  },
  session: {
    findUnique: async () => null,
    findMany: async () => [],
    create: async (data) => data,
    update: async (data) => data,
    delete: async () => ({ id: "mock" }),
    deleteMany: async () => ({ count: 0 }),
  },
  dispatcherTransferRequest: {
    findUnique: async () => null,
    findMany: async () => [],
    create: async (data) => data,
    update: async (data) => data,
    delete: async () => ({ id: "mock" }),
  },
  driverTransferRequest: {
    findUnique: async () => null,
    findMany: async () => [],
    create: async (data) => data,
    update: async (data) => data,
    delete: async () => ({ id: "mock" }),
  },
  platformSettings: {
    findUnique: async () => null,
    findMany: async () => [],
    findFirst: async () => null,
    create: async (data) => data,
    update: async (data) => data,
    delete: async () => ({ id: "mock" }),
  },
  auditLog: {
    findUnique: async () => null,
    findMany: async () => [],
    create: async (data) => data,
    update: async (data) => data,
    delete: async () => ({ id: "mock" }),
  },
};

// Add count method helper to all models
function createModelMock() {
  return {
    findUnique: async () => null,
    findMany: async () => [],
    findFirst: async () => null,
    create: async (data) => data,
    update: async (data) => data,
    updateMany: async (data) => ({ count: 0 }),
    delete: async () => ({ id: "mock" }),
    deleteMany: async () => ({ count: 0 }),
    count: async () => 0,
  };
}

// Enhance all existing models with count and updateMany methods
Object.keys(prisma).forEach(key => {
  if (key.startsWith("$")) return;
  if (!prisma[key].count) prisma[key].count = async () => 0;
  if (!prisma[key].updateMany) prisma[key].updateMany = async (data) => ({ count: 0 });
});

async function connectDatabase() {
  await prisma.$connect();
}

async function disconnectDatabase() {
  await prisma.$disconnect();
}

module.exports = { prisma, connectDatabase, disconnectDatabase };
