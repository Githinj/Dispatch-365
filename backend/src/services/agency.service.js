const { prisma } = require("./prisma.service");
const { invalidateMultipleUsers } = require("./redis.service");

// ── Create agency (SuperAdmin only) ──────────────────────────────────

async function createAgency(data) {
  return prisma.agency.create({ data });
}

// ── Get agency by ID (scoped by isolation) ───────────────────────────

async function getAgencyById(id, isolation = {}) {
  return prisma.agency.findFirst({
    where: { id, ...isolation },
  });
}

// ── List agencies (SuperAdmin sees all, others scoped) ───────────────

async function listAgencies({ page, perPage, skip, isolation = {} }) {
  const where = { ...isolation };

  const [data, total] = await Promise.all([
    prisma.agency.findMany({
      where,
      skip,
      take: perPage,
      orderBy: { createdAt: "desc" },
    }),
    prisma.agency.count({ where }),
  ]);

  return { data, total, page, perPage };
}

// ── Update agency ────────────────────────────────────────────────────

async function updateAgency(id, data, isolation = {}) {
  // Verify the agency exists within the caller's isolation scope
  const agency = await prisma.agency.findFirst({
    where: { id, ...isolation },
  });
  if (!agency) return null;

  return prisma.agency.update({ where: { id }, data });
}

// ── Suspend agency (SuperAdmin only) ─────────────────────────────────
// Suspending deactivates the agency AND invalidates every user's session.

async function suspendAgency(id) {
  const agency = await prisma.agency.findUnique({
    where: { id },
    include: { users: { select: { id: true } } },
  });
  if (!agency) return null;

  // Deactivate agency
  const updated = await prisma.agency.update({
    where: { id },
    data: { isActive: false },
  });

  // Invalidate all sessions for every user in this agency
  await invalidateMultipleUsers(agency.users.map((u) => u.id));

  return updated;
}

// ── Reactivate agency (SuperAdmin only) ──────────────────────────────

async function reactivateAgency(id) {
  const agency = await prisma.agency.findUnique({ where: { id } });
  if (!agency) return null;

  return prisma.agency.update({
    where: { id },
    data: { isActive: true },
  });
}

module.exports = {
  createAgency,
  getAgencyById,
  listAgencies,
  updateAgency,
  suspendAgency,
  reactivateAgency,
};
