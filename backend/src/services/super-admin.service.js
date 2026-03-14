// ── Super Admin Service ─────────────────────────────────────────────
// Platform-level governance: dashboards, approvals, moderation, settings.
// Every mutation is audit-logged by the controller/middleware layer.

const jwt = require("jsonwebtoken");
const { prisma } = require("./prisma.service");
const { invalidateMultipleUsers, destroySession } = require("./redis.service");

// ═══════════════════════════════════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════════════════════════════════

async function getDashboard() {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const in30Days = new Date(now.getTime() + 30 * 86400000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);

  const [
    // Agency counts by status
    activeAgencies,
    suspendedAgencies,
    inactiveAgencies,
    // Fleet counts by status
    activeFleets,
    pendingFleets,
    suspendedFleets,
    // Dispatcher counts
    activeDispatchers,
    suspendedDispatchers,
    inactiveDispatchers,
    // Driver counts
    activeDrivers,
    suspendedDrivers,
    inactiveDrivers,
    // Load counts
    loadsByStatus,
    loadsThisMonth,
    // Financial
    financialAggs,
    invoiceAggs,
    // Needs attention
    pendingFleetApprovals,
    flaggedRatings,
    overdueInvoiceCount,
    pendingDispatcherTransfers,
    pendingDriverTransfers,
    expiringDriverDocs,
    expiringVehicleDocs,
    pendingTransfersOver7dDisp,
    pendingTransfersOver7dDriver,
  ] = await Promise.all([
    // Agencies
    prisma.agency.count({ where: { isActive: true, suspendedAt: null } }),
    prisma.agency.count({ where: { suspendedAt: { not: null } } }),
    prisma.agency.count({ where: { isActive: false } }),
    // Fleets
    prisma.fleet.count({ where: { status: "ACTIVE" } }),
    prisma.fleet.count({ where: { status: "PENDING" } }),
    prisma.fleet.count({ where: { status: "SUSPENDED" } }),
    // Dispatchers
    prisma.user.count({ where: { role: "Dispatcher", dispatcherStatus: "ACTIVE" } }),
    prisma.user.count({ where: { role: "Dispatcher", dispatcherStatus: { in: ["SUSPENDED_TRANSFER", "SUSPENDED_RESTORATION"] } } }),
    prisma.user.count({ where: { role: "Dispatcher", dispatcherStatus: "INACTIVE" } }),
    // Drivers
    prisma.user.count({ where: { role: "Driver", driverStatus: "ACTIVE" } }),
    prisma.user.count({ where: { role: "Driver", driverStatus: { in: ["SUSPENDED_TRANSFER", "SUSPENDED_RESTORATION"] } } }),
    prisma.user.count({ where: { role: "Driver", driverStatus: "INACTIVE" } }),
    // Loads grouped by status
    prisma.load.groupBy({ by: ["status"], _count: { id: true } }),
    prisma.load.count({ where: { createdAt: { gte: startOfMonth } } }),
    // Financial — completed loads
    prisma.load.aggregate({ where: { status: "COMPLETED" }, _sum: { commissionAmount: true } }),
    // Invoice aggregates
    prisma.invoice.groupBy({
      by: ["status"],
      _count: { id: true },
      _sum: { loadRate: true, fleetEarnings: true, paidAmount: true },
    }),
    // Needs attention
    prisma.fleet.count({ where: { status: "PENDING" } }),
    prisma.dispatcherRating.count({ where: { isFlagged: true, isRemoved: false } }),
    prisma.invoice.count({ where: { status: "OVERDUE" } }),
    prisma.dispatcherTransferRequest.count({ where: { status: { in: ["PENDING", "PARTIAL"] } } }),
    prisma.driverTransferRequest.count({ where: { status: { in: ["PENDING", "PARTIAL"] } } }),
    prisma.user.count({
      where: {
        role: "Driver",
        driverStatus: { not: "INACTIVE" },
        licenseExpiry: { lte: in30Days, gte: now },
      },
    }),
    prisma.vehicle.count({
      where: {
        isActive: true,
        OR: [
          { insuranceExpiry: { lte: in30Days, gte: now } },
          { inspectionExpiry: { lte: in30Days, gte: now } },
        ],
      },
    }),
    prisma.dispatcherTransferRequest.count({ where: { status: { in: ["PENDING", "PARTIAL"] }, createdAt: { lte: sevenDaysAgo } } }),
    prisma.driverTransferRequest.count({ where: { status: { in: ["PENDING", "PARTIAL"] }, createdAt: { lte: sevenDaysAgo } } }),
  ]);

  // Build loads by status map
  const loadStatusMap = {};
  for (const row of loadsByStatus) {
    loadStatusMap[row.status] = row._count.id;
  }

  // Build invoice summary
  let totalInvoiceValue = 0;
  let totalPaidInvoices = 0;
  let totalUnpaidInvoices = 0;
  let overdueSum = 0;
  const invoicesByStatus = {};
  for (const row of invoiceAggs) {
    invoicesByStatus[row.status] = row._count.id;
    totalInvoiceValue += row._sum.loadRate || 0;
    if (row.status === "PAID") totalPaidInvoices += row._sum.paidAmount || 0;
    if (["UNPAID", "PARTIALLY_PAID"].includes(row.status)) totalUnpaidInvoices += row._sum.fleetEarnings || 0;
    if (row.status === "OVERDUE") overdueSum += row._sum.fleetEarnings || 0;
  }

  return {
    platformMetrics: {
      totalAgencies: { active: activeAgencies, suspended: suspendedAgencies, inactive: inactiveAgencies },
      totalFleets: { active: activeFleets, pending: pendingFleets, suspended: suspendedFleets },
      totalDispatchers: { active: activeDispatchers, suspended: suspendedDispatchers, inactive: inactiveDispatchers },
      totalDrivers: { active: activeDrivers, suspended: suspendedDrivers, inactive: inactiveDrivers },
      totalLoads: loadStatusMap,
      totalLoadsThisMonth: loadsThisMonth,
      platformRevenue: financialAggs._sum.commissionAmount || 0,
      totalInvoiceValue,
      totalPaidInvoices,
      totalUnpaidInvoices,
      totalOverdueInvoices: { count: overdueInvoiceCount, sum: overdueSum },
    },
    needsAttention: {
      pendingFleetApprovals,
      flaggedRatings,
      overdueInvoices: overdueInvoiceCount,
      pendingTransfers: pendingDispatcherTransfers + pendingDriverTransfers,
      suspendedDispatchers,
      expiringDocuments: expiringDriverDocs + expiringVehicleDocs,
      pendingTransfersOver7Days: pendingTransfersOver7dDisp + pendingTransfersOver7dDriver,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
//  AGENCY MANAGEMENT
// ═══════════════════════════════════════════════════════════════════

async function listAgencies({ status, plan, search, page, perPage, skip }) {
  const where = {};
  if (plan) where.subscriptionPlan = plan;
  if (search) where.name = { contains: search, mode: "insensitive" };
  if (status === "ACTIVE") { where.isActive = true; where.suspendedAt = null; }
  else if (status === "SUSPENDED") { where.suspendedAt = { not: null }; }
  else if (status === "INACTIVE") { where.isActive = false; }

  const [data, total] = await Promise.all([
    prisma.agency.findMany({
      where,
      skip,
      take: perPage,
      orderBy: { createdAt: "desc" },
      select: {
        id: true, name: true, subscriptionPlan: true, isActive: true,
        suspendedAt: true, createdAt: true,
        users: { where: { role: "AgencyAdmin" }, select: { firstName: true, lastName: true }, take: 1 },
        _count: { select: { loads: true } },
      },
    }),
    prisma.agency.count({ where }),
  ]);

  const mapped = data.map((a) => ({
    id: a.id,
    name: a.name,
    owner: a.users[0] ? `${a.users[0].firstName} ${a.users[0].lastName}` : "—",
    plan: a.subscriptionPlan,
    totalLoads: a._count.loads,
    status: a.suspendedAt ? "SUSPENDED" : a.isActive ? "ACTIVE" : "INACTIVE",
    createdAt: a.createdAt,
  }));

  return { data: mapped, total, page, perPage };
}

async function getAgencyDetail(agencyId) {
  const agency = await prisma.agency.findUnique({
    where: { id: agencyId },
    include: {
      users: {
        where: { role: { in: ["AgencyAdmin", "Dispatcher"] } },
        select: { id: true, firstName: true, lastName: true, role: true, dispatcherStatus: true, isActive: true },
      },
      agencyFleets: {
        include: { fleet: { select: { id: true, name: true, status: true } } },
      },
    },
  });
  if (!agency) return null;

  const [loadStats, overdueInvoices, totalRevenue] = await Promise.all([
    prisma.load.groupBy({ by: ["status"], where: { agencyId }, _count: { id: true } }),
    prisma.invoice.count({ where: { agencyId, status: "OVERDUE" } }),
    prisma.load.aggregate({ where: { agencyId, status: "COMPLETED" }, _sum: { commissionAmount: true, loadRate: true } }),
  ]);

  const statMap = {};
  for (const s of loadStats) statMap[s.status] = s._count.id;

  return {
    ...agency,
    stats: {
      totalLoads: Object.values(statMap).reduce((a, b) => a + b, 0),
      activeLoads: (statMap.ASSIGNED || 0) + (statMap.IN_TRANSIT || 0) + (statMap.PENDING_DELIVERY_CONFIRMATION || 0),
      completedLoads: statMap.COMPLETED || 0,
      cancelledLoads: statMap.CANCELLED || 0,
      totalRevenue: totalRevenue._sum.loadRate || 0,
      overdueInvoices,
    },
    dispatchers: agency.users.filter((u) => u.role === "Dispatcher"),
    fleetRelationships: agency.agencyFleets.map((af) => ({
      fleetId: af.fleet.id,
      fleetName: af.fleet.name,
      commission: af.commissionPercent,
      status: af.fleet.status,
    })),
  };
}

async function suspendAgency(agencyId, reason) {
  const agency = await prisma.agency.findUnique({ where: { id: agencyId } });
  if (!agency) return null;
  if (agency.suspendedAt) return { error: "Agency is already suspended." };

  await prisma.$transaction(async (tx) => {
    await tx.agency.update({
      where: { id: agencyId },
      data: { suspendedAt: new Date(), suspendedReason: reason, isActive: false },
    });

    // Freeze DRAFT and ASSIGNED loads
    await tx.load.updateMany({
      where: { agencyId, status: { in: ["DRAFT", "ASSIGNED"] } },
      data: { status: "CANCELLED", cancellationReason: `Agency suspended: ${reason}`, cancelledAt: new Date() },
    });
  });

  // Invalidate all sessions under this agency
  const agencyUsers = await prisma.user.findMany({
    where: { agencyId },
    select: { id: true },
  });
  if (agencyUsers.length) {
    await invalidateMultipleUsers(agencyUsers.map((u) => u.id));
  }

  return { success: true };
}

async function reactivateAgency(agencyId) {
  const agency = await prisma.agency.findUnique({ where: { id: agencyId } });
  if (!agency) return null;
  if (!agency.suspendedAt) return { error: "Agency is not suspended." };

  await prisma.agency.update({
    where: { id: agencyId },
    data: { suspendedAt: null, suspendedReason: null, isActive: true },
  });

  return { success: true };
}

async function updateAgencySubscription(agencyId, plan) {
  const agency = await prisma.agency.findUnique({ where: { id: agencyId } });
  if (!agency) return null;

  const updated = await prisma.agency.update({
    where: { id: agencyId },
    data: { subscriptionPlan: plan },
  });

  return { agency: updated };
}

// ═══════════════════════════════════════════════════════════════════
//  FLEET MANAGEMENT
// ═══════════════════════════════════════════════════════════════════

async function listFleets({ status, search, page, perPage, skip }) {
  const where = {};
  if (status) where.status = status;
  if (search) where.name = { contains: search, mode: "insensitive" };

  const [data, total] = await Promise.all([
    prisma.fleet.findMany({
      where,
      skip,
      take: perPage,
      orderBy: { createdAt: "desc" },
      select: {
        id: true, name: true, status: true, invitedByAgencyId: true, createdAt: true,
        users: { where: { role: "FleetAdmin" }, select: { firstName: true, lastName: true }, take: 1 },
        _count: { select: { users: { where: { role: "Driver" } }, vehicles: true } },
        fleetInvites: { select: { agency: { select: { name: true } } }, take: 1 },
      },
    }),
    prisma.fleet.count({ where }),
  ]);

  const mapped = data.map((f) => ({
    id: f.id,
    name: f.name,
    admin: f.users[0] ? `${f.users[0].firstName} ${f.users[0].lastName}` : "—",
    totalDrivers: f._count.users,
    totalVehicles: f._count.vehicles,
    status: f.status,
    invitedBy: f.fleetInvites[0]?.agency?.name || "—",
    createdAt: f.createdAt,
  }));

  return { data: mapped, total, page, perPage };
}

async function getFleetDetail(fleetId) {
  const fleet = await prisma.fleet.findUnique({
    where: { id: fleetId },
    include: {
      users: { select: { id: true, firstName: true, lastName: true, role: true, driverStatus: true } },
      vehicles: { select: { id: true, plateNumber: true, make: true, model: true, status: true } },
      agencyFleets: { include: { agency: { select: { id: true, name: true } } } },
      fleetInvites: { include: { agency: { select: { id: true, name: true } } } },
    },
  });
  if (!fleet) return null;

  const [loadStats, totalRevenue] = await Promise.all([
    prisma.load.groupBy({ by: ["status"], where: { fleetId }, _count: { id: true } }),
    prisma.load.aggregate({ where: { fleetId, status: "COMPLETED" }, _sum: { fleetEarnings: true } }),
  ]);

  const statMap = {};
  for (const s of loadStats) statMap[s.status] = s._count.id;

  return {
    ...fleet,
    stats: {
      totalLoadsCompleted: statMap.COMPLETED || 0,
      activeLoads: (statMap.ASSIGNED || 0) + (statMap.IN_TRANSIT || 0) + (statMap.PENDING_DELIVERY_CONFIRMATION || 0),
      totalDrivers: fleet.users.filter((u) => u.role === "Driver").length,
      totalVehicles: fleet.vehicles.length,
      totalRevenue: totalRevenue._sum.fleetEarnings || 0,
    },
    agencyRelationships: fleet.agencyFleets.map((af) => ({
      agencyId: af.agency.id,
      agencyName: af.agency.name,
      commission: af.commissionPercent,
    })),
  };
}

async function getPendingFleets() {
  const fleets = await prisma.fleet.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    include: {
      users: { where: { role: "FleetAdmin" }, select: { firstName: true, lastName: true, email: true }, take: 1 },
      fleetInvites: { include: { agency: { select: { name: true } } } },
    },
  });

  return fleets.map((f) => {
    const docs = [
      { type: "Business Registration", present: !!f.businessRegistrationUrl },
      { type: "Operating License", present: !!f.operatingLicenseUrl },
      { type: "Insurance Certificate", present: !!f.insuranceCertificateUrl },
    ];
    return {
      id: f.id,
      fleetName: f.name,
      admin: f.users[0] ? `${f.users[0].firstName} ${f.users[0].lastName}` : "—",
      invitedBy: f.fleetInvites.map((fi) => fi.agency.name),
      submittedAt: f.createdAt,
      documents: docs,
      hasMissingDocs: docs.some((d) => !d.present),
    };
  });
}

async function approveFleet(fleetId) {
  const fleet = await prisma.fleet.findUnique({
    where: { id: fleetId },
    include: { fleetInvites: true },
  });
  if (!fleet) return null;
  if (fleet.status !== "PENDING") return { error: `Fleet status is ${fleet.status}, not PENDING.` };

  await prisma.$transaction(async (tx) => {
    await tx.fleet.update({
      where: { id: fleetId },
      data: { status: "ACTIVE", approvedAt: new Date() },
    });

    // Auto-create AgencyFleet for each inviting agency
    for (const invite of fleet.fleetInvites) {
      await tx.agencyFleet.upsert({
        where: { agencyId_fleetId: { agencyId: invite.agencyId, fleetId } },
        create: { agencyId: invite.agencyId, fleetId },
        update: {},
      });
    }
  });

  return { success: true, invitingAgencyIds: fleet.fleetInvites.map((fi) => fi.agencyId) };
}

async function rejectFleet(fleetId, reason) {
  const fleet = await prisma.fleet.findUnique({ where: { id: fleetId } });
  if (!fleet) return null;
  if (fleet.status !== "PENDING") return { error: `Fleet status is ${fleet.status}, not PENDING.` };

  await prisma.fleet.update({
    where: { id: fleetId },
    data: { status: "REJECTED", rejectionReason: reason },
  });

  return { success: true };
}

async function suspendFleet(fleetId, reason) {
  const fleet = await prisma.fleet.findUnique({ where: { id: fleetId } });
  if (!fleet) return null;
  if (fleet.status === "SUSPENDED") return { error: "Fleet is already suspended." };

  await prisma.fleet.update({
    where: { id: fleetId },
    data: { status: "SUSPENDED" },
  });

  // Invalidate sessions for FleetAdmin + Drivers
  const fleetUsers = await prisma.user.findMany({
    where: { fleetId },
    select: { id: true },
  });
  if (fleetUsers.length) {
    await invalidateMultipleUsers(fleetUsers.map((u) => u.id));
  }

  return { success: true };
}

async function reactivateFleet(fleetId) {
  const fleet = await prisma.fleet.findUnique({ where: { id: fleetId } });
  if (!fleet) return null;
  if (fleet.status !== "SUSPENDED") return { error: "Fleet is not suspended." };

  await prisma.fleet.update({
    where: { id: fleetId },
    data: { status: "ACTIVE" },
  });

  return { success: true };
}

// ═══════════════════════════════════════════════════════════════════
//  DISPATCHER MANAGEMENT
// ═══════════════════════════════════════════════════════════════════

async function listDispatchers({ status, agencyId, search, page, perPage, skip }) {
  const where = { role: "Dispatcher" };
  if (status) where.dispatcherStatus = status;
  if (agencyId) where.agencyId = agencyId;
  if (search) {
    where.OR = [
      { firstName: { contains: search, mode: "insensitive" } },
      { lastName: { contains: search, mode: "insensitive" } },
    ];
  }

  const [data, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip,
      take: perPage,
      orderBy: { createdAt: "desc" },
      select: {
        id: true, firstName: true, lastName: true, dispatcherStatus: true, createdAt: true,
        agency: { select: { id: true, name: true } },
        dispatcherStats: { select: { overallRating: true } },
        _count: { select: { createdLoads: true } },
      },
    }),
    prisma.user.count({ where }),
  ]);

  const mapped = data.map((d) => ({
    id: d.id,
    name: `${d.firstName} ${d.lastName}`,
    agency: d.agency?.name || "—",
    status: d.dispatcherStatus,
    totalLoads: d._count.createdLoads,
    overallRating: d.dispatcherStats?.overallRating || 0,
  }));

  return { data: mapped, total, page, perPage };
}

async function getDispatcherDetail(dispatcherId) {
  const dispatcher = await prisma.user.findUnique({
    where: { id: dispatcherId },
    include: {
      agency: { select: { id: true, name: true } },
      dispatcherStats: true,
      dispatcherAgencyHistory: {
        orderBy: { startDate: "desc" },
        include: { agency: { select: { name: true } } },
      },
      ratingsReceived: {
        where: { isRemoved: false },
        orderBy: { createdAt: "desc" },
        take: 10,
        include: { author: { select: { firstName: true, lastName: true } } },
      },
      transferRequestsFrom: {
        where: { status: { in: ["PENDING", "PARTIAL"] } },
        include: {
          fromAgency: { select: { name: true } },
          toAgency: { select: { name: true } },
        },
      },
    },
  });
  if (!dispatcher || dispatcher.role !== "Dispatcher") return null;
  return dispatcher;
}

async function forceRestoreDispatcher(dispatcherId, reason) {
  const dispatcher = await prisma.user.findUnique({ where: { id: dispatcherId } });
  if (!dispatcher || dispatcher.role !== "Dispatcher") return null;
  if (dispatcher.dispatcherStatus === "ACTIVE") return { error: "Dispatcher is already active." };

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: dispatcherId },
      data: { dispatcherStatus: "ACTIVE" },
    });

    // Cancel pending transfer/restoration requests
    await tx.dispatcherTransferRequest.updateMany({
      where: { dispatcherId, status: { in: ["PENDING", "PARTIAL"] } },
      data: { status: "CANCELLED" },
    });
  });

  return { success: true };
}

async function manuallyAssignDispatcher(dispatcherId, agencyId) {
  const [dispatcher, agency] = await Promise.all([
    prisma.user.findUnique({ where: { id: dispatcherId } }),
    prisma.agency.findUnique({ where: { id: agencyId } }),
  ]);
  if (!dispatcher || dispatcher.role !== "Dispatcher") return null;
  if (!agency) return { error: "Agency not found." };
  if (dispatcher.dispatcherStatus === "ACTIVE") return { error: "Dispatcher is already active." };

  await prisma.$transaction(async (tx) => {
    // Close previous agency history
    if (dispatcher.agencyId) {
      await tx.dispatcherAgencyHistory.updateMany({
        where: { dispatcherId, agencyId: dispatcher.agencyId, endDate: null },
        data: { endDate: new Date() },
      });
    }

    await tx.user.update({
      where: { id: dispatcherId },
      data: { agencyId, dispatcherStatus: "ACTIVE" },
    });

    await tx.dispatcherAgencyHistory.create({
      data: { dispatcherId, agencyId },
    });
  });

  return { success: true };
}

// ═══════════════════════════════════════════════════════════════════
//  DRIVER MANAGEMENT
// ═══════════════════════════════════════════════════════════════════

async function listDrivers({ status, fleetId, search, page, perPage, skip }) {
  const where = { role: "Driver" };
  if (status) where.driverStatus = status;
  if (fleetId) where.fleetId = fleetId;
  if (search) {
    where.OR = [
      { firstName: { contains: search, mode: "insensitive" } },
      { lastName: { contains: search, mode: "insensitive" } },
    ];
  }

  const [data, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip,
      take: perPage,
      orderBy: { createdAt: "desc" },
      select: {
        id: true, firstName: true, lastName: true, driverStatus: true, createdAt: true,
        fleet: { select: { id: true, name: true } },
        driverStats: { select: { totalLoadsCompleted: true, onTimeDeliveryRate: true } },
      },
    }),
    prisma.user.count({ where }),
  ]);

  const mapped = data.map((d) => ({
    id: d.id,
    name: `${d.firstName} ${d.lastName}`,
    fleet: d.fleet?.name || "—",
    status: d.driverStatus,
    totalLoads: d.driverStats?.totalLoadsCompleted || 0,
    onTimeRate: d.driverStats?.onTimeDeliveryRate || 0,
  }));

  return { data: mapped, total, page, perPage };
}

async function getDriverDetail(driverId) {
  const driver = await prisma.user.findUnique({
    where: { id: driverId },
    include: {
      fleet: { select: { id: true, name: true } },
      driverStats: true,
      driverFleetHistory: {
        orderBy: { startDate: "desc" },
        include: { fleet: { select: { name: true } } },
      },
    },
  });
  if (!driver || driver.role !== "Driver") return null;

  return {
    ...driver,
    password: undefined,
    documentExpiry: {
      licenseExpiry: driver.licenseExpiry,
      licenseIsExpired: driver.licenseIsExpired,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
//  DOCUMENT EXPIRY MONITORING
// ═══════════════════════════════════════════════════════════════════

async function getExpiringDocuments() {
  const now = new Date();
  const in30Days = new Date(now.getTime() + 30 * 86400000);
  const in7Days = new Date(now.getTime() + 7 * 86400000);

  const [drivers, vehicles] = await Promise.all([
    prisma.user.findMany({
      where: {
        role: "Driver",
        driverStatus: { not: "INACTIVE" },
        licenseExpiry: { lte: in30Days, gte: now },
      },
      select: {
        firstName: true, lastName: true, licenseExpiry: true,
        fleet: { select: { name: true } },
      },
      orderBy: { licenseExpiry: "asc" },
    }),
    prisma.vehicle.findMany({
      where: {
        isActive: true,
        OR: [
          { insuranceExpiry: { lte: in30Days, gte: now } },
          { inspectionExpiry: { lte: in30Days, gte: now } },
        ],
      },
      select: {
        plateNumber: true, make: true, model: true,
        insuranceExpiry: true, inspectionExpiry: true,
        fleet: { select: { name: true } },
      },
      orderBy: { insuranceExpiry: "asc" },
    }),
  ]);

  const daysUntil = (d) => Math.ceil((new Date(d) - now) / 86400000);

  const driverDocs = drivers.map((d) => ({
    driverName: `${d.firstName} ${d.lastName}`,
    fleetName: d.fleet?.name || "—",
    documentType: "License",
    expiryDate: d.licenseExpiry,
    daysUntilExpiry: daysUntil(d.licenseExpiry),
    urgent: d.licenseExpiry <= in7Days,
  }));

  const vehicleDocs = [];
  for (const v of vehicles) {
    if (v.insuranceExpiry && v.insuranceExpiry <= in30Days && v.insuranceExpiry >= now) {
      vehicleDocs.push({
        vehiclePlate: v.plateNumber,
        vehicleMake: `${v.make} ${v.model}`,
        fleetName: v.fleet?.name || "—",
        documentType: "Insurance",
        expiryDate: v.insuranceExpiry,
        daysUntilExpiry: daysUntil(v.insuranceExpiry),
        urgent: v.insuranceExpiry <= in7Days,
      });
    }
    if (v.inspectionExpiry && v.inspectionExpiry <= in30Days && v.inspectionExpiry >= now) {
      vehicleDocs.push({
        vehiclePlate: v.plateNumber,
        vehicleMake: `${v.make} ${v.model}`,
        fleetName: v.fleet?.name || "—",
        documentType: "Inspection",
        expiryDate: v.inspectionExpiry,
        daysUntilExpiry: daysUntil(v.inspectionExpiry),
        urgent: v.inspectionExpiry <= in7Days,
      });
    }
  }

  // Sort combined by daysUntilExpiry ascending
  const combined = [...driverDocs, ...vehicleDocs].sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);

  return { drivers: driverDocs, vehicles: vehicleDocs, all: combined };
}

// ═══════════════════════════════════════════════════════════════════
//  LOAD VISIBILITY (no isolation)
// ═══════════════════════════════════════════════════════════════════

async function listLoads({ status, agencyId, fleetId, dispatcherId, driverId, dateFrom, dateTo, page, perPage, skip }) {
  const where = {};
  if (status) where.status = status;
  if (agencyId) where.agencyId = agencyId;
  if (fleetId) where.fleetId = fleetId;
  if (dispatcherId) where.dispatcherId = dispatcherId;
  if (driverId) where.driverId = driverId;
  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) where.createdAt.gte = new Date(dateFrom);
    if (dateTo) where.createdAt.lte = new Date(dateTo);
  }

  const [data, total] = await Promise.all([
    prisma.load.findMany({
      where,
      skip,
      take: perPage,
      orderBy: { createdAt: "desc" },
      include: {
        agency: { select: { id: true, name: true } },
        fleet: { select: { id: true, name: true } },
        dispatcher: { select: { id: true, firstName: true, lastName: true } },
        driver: { select: { id: true, firstName: true, lastName: true } },
      },
    }),
    prisma.load.count({ where }),
  ]);

  return { data, total, page, perPage };
}

async function getLoadDetail(loadId) {
  return prisma.load.findUnique({
    where: { id: loadId },
    include: {
      agency: true,
      fleet: true,
      dispatcher: { select: { id: true, firstName: true, lastName: true, email: true } },
      driver: { select: { id: true, firstName: true, lastName: true, email: true } },
      vehicle: true,
      invoice: { include: { receipt: true } },
      statusHistory: { orderBy: { createdAt: "desc" } },
    },
  });
}

// ═══════════════════════════════════════════════════════════════════
//  FINANCIAL OVERVIEW
// ═══════════════════════════════════════════════════════════════════

async function getFinancials() {
  const now = new Date();

  const [
    platformRevenueAgg,
    invoiceAggs,
    revenueByMonth,
    topAgencies,
    topFleets,
    activePlanCounts,
    planConfigs,
  ] = await Promise.all([
    prisma.load.aggregate({ where: { status: "COMPLETED" }, _sum: { commissionAmount: true } }),
    prisma.invoice.groupBy({
      by: ["status"],
      _count: { id: true },
      _sum: { loadRate: true, fleetEarnings: true, paidAmount: true },
    }),
    // Revenue last 12 months — use raw for date grouping
    prisma.$queryRaw`
      SELECT
        TO_CHAR(DATE_TRUNC('month', "completedAt"), 'YYYY-MM') AS month,
        COALESCE(SUM("commissionAmount"), 0) AS revenue,
        COUNT(*)::int AS loads
      FROM "Load"
      WHERE status = 'COMPLETED'
        AND "completedAt" >= ${new Date(now.getFullYear() - 1, now.getMonth(), 1)}
      GROUP BY DATE_TRUNC('month', "completedAt")
      ORDER BY month ASC
    `,
    prisma.load.groupBy({
      by: ["agencyId"],
      where: { status: "COMPLETED" },
      _sum: { loadRate: true },
      _count: { id: true },
      orderBy: { _sum: { loadRate: "desc" } },
      take: 5,
    }),
    prisma.load.groupBy({
      by: ["fleetId"],
      where: { status: "COMPLETED", fleetId: { not: null } },
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: 5,
    }),
    prisma.agency.groupBy({ by: ["subscriptionPlan"], where: { isActive: true }, _count: { id: true } }),
    prisma.subscriptionPlanConfig.findMany(),
  ]);

  // Invoice summary
  let totalInvoiceValue = 0, paidInvoiceValue = 0, unpaidInvoiceValue = 0, overdueInvoiceValue = 0;
  const invoicesByStatus = {};
  for (const row of invoiceAggs) {
    invoicesByStatus[row.status] = row._count.id;
    totalInvoiceValue += row._sum.loadRate || 0;
    if (row.status === "PAID") paidInvoiceValue += row._sum.paidAmount || 0;
    if (["UNPAID", "PARTIALLY_PAID"].includes(row.status)) unpaidInvoiceValue += row._sum.fleetEarnings || 0;
    if (row.status === "OVERDUE") overdueInvoiceValue += row._sum.fleetEarnings || 0;
  }

  // Subscription revenue estimate
  const planPriceMap = {};
  for (const pc of planConfigs) planPriceMap[pc.plan] = pc.priceMonthly;
  let subscriptionRevenue = 0;
  for (const pc of activePlanCounts) {
    subscriptionRevenue += (planPriceMap[pc.subscriptionPlan] || 0) * pc._count.id;
  }

  // Resolve agency/fleet names for top lists
  const topAgencyIds = topAgencies.map((a) => a.agencyId);
  const topFleetIds = topFleets.map((f) => f.fleetId).filter(Boolean);
  const [agencyNames, fleetNames] = await Promise.all([
    prisma.agency.findMany({ where: { id: { in: topAgencyIds } }, select: { id: true, name: true } }),
    prisma.fleet.findMany({ where: { id: { in: topFleetIds } }, select: { id: true, name: true } }),
  ]);
  const agencyMap = Object.fromEntries(agencyNames.map((a) => [a.id, a.name]));
  const fleetMap = Object.fromEntries(fleetNames.map((f) => [f.id, f.name]));

  return {
    platformRevenue: platformRevenueAgg._sum.commissionAmount || 0,
    subscriptionRevenue,
    totalInvoiceValue,
    paidInvoiceValue,
    unpaidInvoiceValue,
    overdueInvoiceValue,
    invoicesByStatus,
    revenueByMonth: revenueByMonth.map((r) => ({ month: r.month, revenue: Number(r.revenue), loads: r.loads })),
    topAgenciesByRevenue: topAgencies.map((a) => ({
      agencyId: a.agencyId,
      agencyName: agencyMap[a.agencyId] || "—",
      revenue: a._sum.loadRate || 0,
      loads: a._count.id,
    })),
    topFleetsByLoads: topFleets.map((f) => ({
      fleetId: f.fleetId,
      fleetName: fleetMap[f.fleetId] || "—",
      loads: f._count.id,
    })),
  };
}

async function listInvoices({ status, agencyId, fleetId, dateFrom, dateTo, page, perPage, skip }) {
  const where = {};
  if (status) where.status = status.toUpperCase();
  if (agencyId) where.agencyId = agencyId;
  if (fleetId) where.fleetId = fleetId;
  if (dateFrom || dateTo) {
    where.generatedAt = {};
    if (dateFrom) where.generatedAt.gte = new Date(dateFrom);
    if (dateTo) where.generatedAt.lte = new Date(dateTo);
  }

  const [data, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      skip,
      take: perPage,
      orderBy: { generatedAt: "desc" },
      include: {
        agency: { select: { id: true, name: true } },
        fleet: { select: { id: true, name: true } },
        load: { select: { loadNumber: true } },
      },
    }),
    prisma.invoice.count({ where }),
  ]);

  return { data, total, page, perPage };
}

// ═══════════════════════════════════════════════════════════════════
//  RATING MANAGEMENT
// ═══════════════════════════════════════════════════════════════════

async function getFlaggedRatings() {
  return prisma.dispatcherRating.findMany({
    where: { isFlagged: true, isRemoved: false },
    orderBy: { createdAt: "desc" },
    include: {
      dispatcher: {
        select: { firstName: true, lastName: true, agency: { select: { name: true } } },
      },
      author: { select: { firstName: true, lastName: true } },
    },
  });
}

async function removeRating(ratingId, adminId, removalReason) {
  const rating = await prisma.dispatcherRating.findUnique({ where: { id: ratingId } });
  if (!rating) return null;
  if (rating.isRemoved) return { error: "Rating is already removed." };

  await prisma.dispatcherRating.update({
    where: { id: ratingId },
    data: {
      isRemoved: true,
      removedAt: new Date(),
      removedByAdminId: adminId,
      removalReason,
    },
  });

  // Check pattern of unfair ratings from same author
  const removedBySameAuthor = await prisma.dispatcherRating.count({
    where: { authorId: rating.authorId, isRemoved: true },
  });

  return { success: true, unfairPattern: removedBySameAuthor > 2, authorId: rating.authorId, dispatcherId: rating.dispatcherId };
}

async function keepRating(ratingId) {
  const rating = await prisma.dispatcherRating.findUnique({ where: { id: ratingId } });
  if (!rating) return null;

  await prisma.dispatcherRating.update({
    where: { id: ratingId },
    data: { isFlagged: false },
  });

  return { success: true, dispatcherId: rating.dispatcherId };
}

// ═══════════════════════════════════════════════════════════════════
//  IMPERSONATION
// ═══════════════════════════════════════════════════════════════════

async function startImpersonation(superAdminId, targetUserId) {
  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, role: true, agencyId: true, fleetId: true, isActive: true },
  });
  if (!target) return null;
  if (target.role === "SuperAdmin") return { error: "Cannot impersonate another Super Admin." };

  const token = jwt.sign(
    {
      userId: target.id,
      role: target.role,
      ...(target.agencyId && { agencyId: target.agencyId }),
      ...(target.fleetId && { fleetId: target.fleetId }),
      impersonating: true,
      realSuperAdminId: superAdminId,
    },
    process.env.JWT_SECRET,
    { expiresIn: "15m" }
  );

  return { impersonationToken: token, targetUser: target };
}

// ═══════════════════════════════════════════════════════════════════
//  PLATFORM SETTINGS
// ═══════════════════════════════════════════════════════════════════

async function getSettings() {
  let settings = await prisma.platformSettings.findFirst();
  if (!settings) {
    // Seed defaults
    settings = await prisma.platformSettings.create({ data: {} });
  }
  return settings;
}

const SETTINGS_WRITABLE = [
  "platformName", "platformLogoUrl", "primaryColor", "secondaryColor",
  "supportEmail", "supportPhone", "platformWatermarkEnabled",
  "watermarkText", "poweredByText", "invoiceDueReminderDays",
  "transferReminderDays", "documentExpiryWarningDays",
  "maintenanceReminderDays", "fleetReRequestCooldown",
  "agencyReRequestCooldown", "dispatcherJoinCooldown",
  "trialPeriodDays", "gracePeriodDays", "autoSuspendOnExpiry",
  "webSessionTimeoutMinutes", "mobileSessionTimeoutMinutes",
  "maxFailedLoginAttempts", "loginLockoutMinutes",
];

async function updateSettings(updates) {
  const settings = await getSettings();

  // Only allow writable fields
  const data = {};
  for (const key of SETTINGS_WRITABLE) {
    if (updates[key] !== undefined) data[key] = updates[key];
  }

  if (!Object.keys(data).length) return { error: "No valid fields provided." };

  const updated = await prisma.platformSettings.update({
    where: { id: settings.id },
    data,
  });

  return { settings: updated };
}

// ═══════════════════════════════════════════════════════════════════
//  SUBSCRIPTION PLAN CONFIG
// ═══════════════════════════════════════════════════════════════════

async function listPlans() {
  return prisma.subscriptionPlanConfig.findMany({ orderBy: { priceMonthly: "asc" } });
}

async function createPlan({ plan, priceMonthly, maxDispatchers, maxLoadsPerMonth, features }) {
  return prisma.subscriptionPlanConfig.create({
    data: {
      plan,
      priceMonthly,
      maxDispatchers,
      maxLoadsPerMonth,
      features: features ? JSON.stringify(features) : null,
    },
  });
}

async function updatePlan(id, updates) {
  const plan = await prisma.subscriptionPlanConfig.findUnique({ where: { id } });
  if (!plan) return null;

  const data = {};
  if (updates.priceMonthly !== undefined) data.priceMonthly = updates.priceMonthly;
  if (updates.maxDispatchers !== undefined) data.maxDispatchers = updates.maxDispatchers;
  if (updates.maxLoadsPerMonth !== undefined) data.maxLoadsPerMonth = updates.maxLoadsPerMonth;
  if (updates.features !== undefined) data.features = JSON.stringify(updates.features);

  return prisma.subscriptionPlanConfig.update({ where: { id }, data });
}

// ═══════════════════════════════════════════════════════════════════
//  AUDIT LOGS
// ═══════════════════════════════════════════════════════════════════

async function listAuditLogs({ actorId, actionType, entityType, entityId, agencyId, dateFrom, dateTo, page, perPage, skip }) {
  const where = {};
  if (actorId) where.userId = actorId;
  if (actionType) where.action = { contains: actionType, mode: "insensitive" };
  if (entityType) where.entityType = entityType;
  if (entityId) where.entityId = entityId;
  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) where.createdAt.gte = new Date(dateFrom);
    if (dateTo) where.createdAt.lte = new Date(dateTo);
  }

  // Filter by agencyId via user relation if provided
  if (agencyId) {
    where.user = { agencyId };
  }

  const [data, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      skip,
      take: perPage || 50,
      orderBy: { createdAt: "desc" },
      include: { user: { select: { firstName: true, lastName: true, role: true } } },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return { data, total, page: page || 1, perPage: perPage || 50 };
}

// ═══════════════════════════════════════════════════════════════════
//  PENDING TRANSFERS MONITOR
// ═══════════════════════════════════════════════════════════════════

async function getPendingTransfers() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);

  const [dispatcherTransfers, driverTransfers] = await Promise.all([
    prisma.dispatcherTransferRequest.findMany({
      where: { status: { in: ["PENDING", "PARTIAL"] } },
      orderBy: { createdAt: "asc" },
      include: {
        dispatcher: { select: { firstName: true, lastName: true } },
        fromAgency: { select: { name: true } },
        toAgency: { select: { name: true } },
      },
    }),
    prisma.driverTransferRequest.findMany({
      where: { status: { in: ["PENDING", "PARTIAL"] } },
      orderBy: { createdAt: "asc" },
      include: {
        driver: { select: { firstName: true, lastName: true } },
        fromFleet: { select: { name: true } },
        toFleet: { select: { name: true } },
      },
    }),
  ]);

  const daysPending = (date) => Math.ceil((Date.now() - new Date(date).getTime()) / 86400000);

  return {
    dispatcher: dispatcherTransfers.map((t) => ({
      id: t.id,
      name: `${t.dispatcher.firstName} ${t.dispatcher.lastName}`,
      fromAgency: t.fromAgency.name,
      toAgency: t.toAgency.name,
      requestedAt: t.createdAt,
      daysPending: daysPending(t.createdAt),
      fromAgencyApproved: t.fromAgencyApproved,
      toAgencyApproved: t.toAgencyApproved,
      overdue: t.createdAt <= sevenDaysAgo,
    })),
    driver: driverTransfers.map((t) => ({
      id: t.id,
      name: `${t.driver.firstName} ${t.driver.lastName}`,
      fromFleet: t.fromFleet.name,
      toFleet: t.toFleet.name,
      requestedAt: t.createdAt,
      daysPending: daysPending(t.createdAt),
      fromFleetApproved: t.fromFleetApproved,
      toFleetApproved: t.toFleetApproved,
      overdue: t.createdAt <= sevenDaysAgo,
    })),
  };
}

// ═══════════════════════════════════════════════════════════════════
//  SUBSCRIPTION EXPIRY CHECK (daily cron)
// ═══════════════════════════════════════════════════════════════════

async function checkSubscriptionExpiry() {
  const now = new Date();
  const in7Days = new Date(now.getTime() + 7 * 86400000);

  // Get platform settings for grace period + auto-suspend
  const settings = await prisma.platformSettings.findFirst();
  const graceDays = settings?.gracePeriodDays ?? 7;
  const autoSuspend = settings?.autoSuspendOnExpiry ?? true;

  // Agencies expiring within 7 days (not yet suspended)
  const expiringSoon = await prisma.agency.findMany({
    where: {
      isActive: true,
      suspendedAt: null,
      subscriptionEndDate: { lte: in7Days, gte: now },
    },
    select: { id: true, name: true, subscriptionEndDate: true },
  });

  for (const a of expiringSoon) {
    console.log(`[Cron] Agency "${a.name}" subscription expiring on ${a.subscriptionEndDate.toISOString().split("T")[0]}`);
    // TODO: notify agency admin + super admin
  }

  // Agencies past expiry + grace period
  if (autoSuspend) {
    const graceExpired = new Date(now.getTime() - graceDays * 86400000);
    const toSuspend = await prisma.agency.findMany({
      where: {
        isActive: true,
        suspendedAt: null,
        subscriptionEndDate: { lt: graceExpired },
      },
      select: { id: true, name: true },
    });

    for (const a of toSuspend) {
      console.log(`[Cron] Auto-suspending agency "${a.name}" — subscription expired + grace period passed.`);
      await suspendAgency(a.id, "Subscription expired");
      // TODO: notify agency admin
    }
  }
}

function startSubscriptionCron() {
  checkSubscriptionExpiry().catch((err) =>
    console.error("[Cron] Subscription expiry check failed:", err.message)
  );
  setInterval(() => {
    checkSubscriptionExpiry().catch((err) =>
      console.error("[Cron] Subscription expiry check failed:", err.message)
    );
  }, 24 * 60 * 60 * 1000);
  console.log("[Cron] Subscription expiry scheduler started (runs every 24 h).");
}

module.exports = {
  // Dashboard
  getDashboard,
  // Agency
  listAgencies, getAgencyDetail, suspendAgency, reactivateAgency, updateAgencySubscription,
  // Fleet
  listFleets, getFleetDetail, getPendingFleets, approveFleet, rejectFleet, suspendFleet, reactivateFleet,
  // Dispatcher
  listDispatchers, getDispatcherDetail, forceRestoreDispatcher, manuallyAssignDispatcher,
  // Driver
  listDrivers, getDriverDetail,
  // Documents
  getExpiringDocuments,
  // Loads
  listLoads, getLoadDetail,
  // Financial
  getFinancials, listInvoices,
  // Ratings
  getFlaggedRatings, removeRating, keepRating,
  // Impersonation
  startImpersonation,
  // Settings
  getSettings, updateSettings,
  // Plans
  listPlans, createPlan, updatePlan,
  // Audit
  listAuditLogs,
  // Transfers
  getPendingTransfers,
  // Cron
  startSubscriptionCron,
};
