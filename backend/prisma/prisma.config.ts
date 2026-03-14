import { definePrismaConfig } from '@prisma/internals'

// Prisma v7 configuration with DATABASE_URL support
export default definePrismaConfig({
  seed: './prisma/seed.ts',
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
})
