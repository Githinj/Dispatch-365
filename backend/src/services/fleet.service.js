const crypto = require("crypto");
const { prisma } = require("./prisma.service");
const { invalidateMultipleUsers } = require("./redis.service");

// ── Invite ───────────────────────────────────────────────────────────

/**
 * Agency Admin invites a fleet by email.
 * Creates a Fleet record (INVITED) with a unique invite token and
 * records which agency sent the invite via FleetInvite.
 * If the fleet already exists (same email), just add another FleetInvite.
 */
async function inviteFleet({ fleetName, contactEmail, agencyId }) {
  const inviteToken = crypto.randomBytes(32).toString("hex");

  // Check if a fleet with this email already exists
  let fleet = await prisma.fleet.findFirst({
    where: { contactEmail },
  });

  if (fleet) {
    // Fleet already exists — just record the new agency invite
    await prisma.fleetInvite.upsert({
      where: { fleetId_agencyId: { fleetId: fleet.id, agencyId } },
      create: { fleetId: fleet.id, agencyId },
      update: {},
    });
    return fleet;
  }

  // Create new fleet + invite record in a transaction
  fleet = await prisma.$transaction(async (tx) => {
    const newFleet = await tx.fleet.create({
      data: {
        name: fleetName,
        contactEmail,
        status: "INVITED",
        inviteToken,
        invitedByAgencyId: agencyId,
      },
    });

    await tx.fleetInvite.create({
      data: { fleetId: newFleet.id, agencyId },
    });

    return newFleet;
  });

  return fleet;
}

// ── Register ─────────────────────────────────────────────────────────

/**
 * Fleet Admin registers using the invite token.
 * Validates all three required documents are provided.
 * Moves status from INVITED → PENDING.
 */
async function registerFleet(inviteToken, data) {
  const fleet = await prisma.fleet.findUnique({
    where: { inviteToken },
  });

  if (!fleet) return { error: "Invalid invite token." };
  if (fleet.status !== "INVITED" && fleet.status !== "REJECTED") {
    return { error: "Fleet has already been registered." };
  }

  const updated = await prisma.fleet.update({
    where: { id: fleet.id },
    data: {
      name: data.name || fleet.name,
      contactPhone: data.contactPhone,
      businessRegistrationUrl: data.businessRegistrationUrl,
      operatingLicenseUrl: data.operatingLicenseUrl,
      operatingLicenseExpiry: data.operatingLicenseExpiry,
      insuranceCertificateUrl: data.insuranceCertificateUrl,
      insuranceCertificateExpiry: data.insuranceCertificateExpiry,
      status: "PENDING",
      rejectionReason: null,
      inviteToken: null, // Consume the token
    },
  });

  return { fleet: updated };
}

// ── Pending approvals ────────────────────────────────────────────────

async function listPendingFleets({ page, perPage, skip }) {
  const where = { status: "PENDING" };

  const [data, total] = await Promise.all([
    prisma.fleet.findMany({
      where,
      skip,
      take: perPage,
      orderBy: { updatedAt: "desc" },
      include: {
        fleetInvites: { include: { agency: { select: { id: true, name: true } } } },
      },
    }),
    prisma.fleet.count({ where }),
  ]);

  return { data, total, page, perPage };
}

// ── Approve ──────────────────────────────────────────────────────────

/**
 * SuperAdmin approves a PENDING fleet.
 * Auto-creates AgencyFleet relationships for every agency that invited it,
 * inheriting each agency's default commissionPercent.
 */
async function approveFleet(fleetId) {
  const fleet = await prisma.fleet.findUnique({
    where: { id: fleetId },
    include: {
      fleetInvites: { include: { agency: { select: { id: true, commissionPercent: true } } } },
    },
  });

  if (!fleet) return null;
  if (fleet.status !== "PENDING") return { error: "Fleet is not in PENDING status." };

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.fleet.update({
      where: { id: fleetId },
      data: { status: "ACTIVE", isActive: true },
    });

    // Auto-create AgencyFleet for each inviting agency
    for (const invite of fleet.fleetInvites) {
      await tx.agencyFleet.upsert({
        where: {
          agencyId_fleetId: { agencyId: invite.agencyId, fleetId },
        },
        create: {
          agencyId: invite.agencyId,
          fleetId,
          commissionPercent: invite.agency.commissionPercent,
        },
        update: {},
      });
    }

    return updated;
  });

  return result;
}

// ── Reject ───────────────────────────────────────────────────────────

async function rejectFleet(fleetId, reason) {
  const fleet = await prisma.fleet.findUnique({ where: { id: fleetId } });
  if (!fleet) return null;
  if (fleet.status !== "PENDING") return { error: "Fleet is not in PENDING status." };

  // Generate a new invite token so the fleet admin can resubmit
  const newToken = crypto.randomBytes(32).toString("hex");

  return prisma.fleet.update({
    where: { id: fleetId },
    data: {
      status: "REJECTED",
      rejectionReason: reason,
      inviteToken: newToken,
    },
  });
}

// ── List all fleets (SuperAdmin) ─────────────────────────────────────

async function listAllFleets({ page, perPage, skip, status }) {
  const where = {};
  if (status) where.status = status;

  const [data, total] = await Promise.all([
    prisma.fleet.findMany({
      where,
      skip,
      take: perPage,
      orderBy: { createdAt: "desc" },
    }),
    prisma.fleet.count({ where }),
  ]);

  return { data, total, page, perPage };
}

// ── My fleets (Agency Admin) ─────────────────────────────────────────

async function listAgencyFleets({ agencyId, page, perPage, skip }) {
  const where = { agencyId };

  const [data, total] = await Promise.all([
    prisma.agencyFleet.findMany({
      where,
      skip,
      take: perPage,
      orderBy: { createdAt: "desc" },
      include: {
        fleet: {
          select: {
            id: true,
            name: true,
            status: true,
            contactEmail: true,
            contactPhone: true,
          },
        },
      },
    }),
    prisma.agencyFleet.count({ where }),
  ]);

  return { data, total, page, perPage };
}

// ── Get fleet by ID ──────────────────────────────────────────────────

async function getFleetById(id) {
  return prisma.fleet.findUnique({
    where: { id },
    include: {
      agencyFleets: {
        include: { agency: { select: { id: true, name: true } } },
      },
    },
  });
}

// ── Update fleet profile (Fleet Admin) ───────────────────────────────

async function updateFleet(id, data) {
  const fleet = await prisma.fleet.findUnique({ where: { id } });
  if (!fleet) return null;

  return prisma.fleet.update({ where: { id }, data });
}

// ── Suspend fleet ────────────────────────────────────────────────────

/**
 * SuperAdmin suspends a fleet.
 * Invalidates all sessions for Fleet Admin + every Driver under this fleet.
 */
async function suspendFleet(fleetId) {
  const fleet = await prisma.fleet.findUnique({
    where: { id: fleetId },
    include: { users: { select: { id: true } } },
  });

  if (!fleet) return null;
  if (fleet.status === "SUSPENDED") return { error: "Fleet is already suspended." };

  const updated = await prisma.fleet.update({
    where: { id: fleetId },
    data: { status: "SUSPENDED", isActive: false },
  });

  // Invalidate all sessions for Fleet Admin + Drivers
  await invalidateMultipleUsers(fleet.users.map((u) => u.id));

  return updated;
}

// ── Reactivate fleet ─────────────────────────────────────────────────

async function reactivateFleet(fleetId) {
  const fleet = await prisma.fleet.findUnique({ where: { id: fleetId } });
  if (!fleet) return null;
  if (fleet.status !== "SUSPENDED") return { error: "Fleet is not suspended." };

  return prisma.fleet.update({
    where: { id: fleetId },
    data: { status: "ACTIVE", isActive: true },
  });
}

// ── Expiring documents ───────────────────────────────────────────────

/**
 * Returns fleets whose Operating License or Insurance Certificate
 * expires within the given number of days (default 30).
 */
async function getExpiringDocuments(withinDays = 30) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + withinDays);

  const fleets = await prisma.fleet.findMany({
    where: {
      status: "ACTIVE",
      OR: [
        { operatingLicenseExpiry: { lte: cutoff } },
        { insuranceCertificateExpiry: { lte: cutoff } },
      ],
    },
    select: {
      id: true,
      name: true,
      operatingLicenseExpiry: true,
      insuranceCertificateExpiry: true,
    },
  });

  const now = new Date();
  const results = [];

  for (const fleet of fleets) {
    if (fleet.operatingLicenseExpiry && fleet.operatingLicenseExpiry <= cutoff) {
      const daysUntilExpiry = Math.ceil(
        (fleet.operatingLicenseExpiry - now) / (1000 * 60 * 60 * 24)
      );
      results.push({
        fleetId: fleet.id,
        fleetName: fleet.name,
        documentType: "Operating License",
        expiryDate: fleet.operatingLicenseExpiry,
        daysUntilExpiry,
      });
    }
    if (fleet.insuranceCertificateExpiry && fleet.insuranceCertificateExpiry <= cutoff) {
      const daysUntilExpiry = Math.ceil(
        (fleet.insuranceCertificateExpiry - now) / (1000 * 60 * 60 * 24)
      );
      results.push({
        fleetId: fleet.id,
        fleetName: fleet.name,
        documentType: "Insurance Certificate",
        expiryDate: fleet.insuranceCertificateExpiry,
        daysUntilExpiry,
      });
    }
  }

  // Sort by most urgent first
  results.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);

  return results;
}

module.exports = {
  inviteFleet,
  registerFleet,
  listPendingFleets,
  approveFleet,
  rejectFleet,
  listAllFleets,
  listAgencyFleets,
  getFleetById,
  updateFleet,
  suspendFleet,
  reactivateFleet,
  getExpiringDocuments,
};
