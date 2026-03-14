// ── JOB 2: Document Expiry Check ────────────────────────────────────
// Runs daily. Checks driver licenses + vehicle insurance/inspection expiry.

const { prisma } = require("../services/prisma.service");
const notificationService = require("../services/notification.service");

function daysUntil(date) {
  return Math.ceil((new Date(date) - new Date()) / 86400000);
}

async function run() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const in7Days = new Date(today.getTime() + 7 * 86400000);
  const in30Days = new Date(today.getTime() + 30 * 86400000);
  const sevenDaysAgo = new Date(today.getTime() - 7 * 86400000);

  let notifyCount = 0;

  // ── Step 1: Driver license expiry ─────────────────────────────────

  // Expiring within 30 days
  const expiringDrivers = await prisma.user.findMany({
    where: {
      role: "Driver",
      driverStatus: { in: ["ACTIVE", "ON_LOAD"] },
      licenseExpiry: { gte: today, lte: in30Days },
    },
    select: {
      id: true, firstName: true, lastName: true, email: true, licenseExpiry: true,
      fleetId: true,
      fleet: { select: { users: { where: { role: "FleetAdmin" }, select: { id: true, email: true }, take: 1 } } },
    },
  });

  for (const driver of expiringDrivers) {
    const days = daysUntil(driver.licenseExpiry);
    const urgent = driver.licenseExpiry <= in7Days;
    const prefix = urgent ? "URGENT: " : "";
    const fleetAdmin = driver.fleet?.users?.[0];

    if (fleetAdmin) {
      await notificationService.notify({
        userId: fleetAdmin.id,
        email: fleetAdmin.email,
        type: "DOCUMENT_EXPIRY_WARNING",
        title: `${prefix}Driver License Expiring`,
        message: `${prefix}Driver ${driver.firstName} ${driver.lastName} license expires in ${days} day(s).`,
        data: { driverId: driver.id, documentType: "license", daysUntilExpiry: days },
      });
    }

    await notificationService.createNotification({
      userId: driver.id,
      type: "DOCUMENT_EXPIRY_WARNING",
      title: `${prefix}License Expiring`,
      message: `${prefix}Your license expires in ${days} day(s). Please renew promptly.`,
      data: JSON.stringify({ documentType: "license", daysUntilExpiry: days }),
    });

    notifyCount++;
  }

  // Expired licenses
  const expiredDrivers = await prisma.user.findMany({
    where: {
      role: "Driver",
      driverStatus: { in: ["ACTIVE", "ON_LOAD"] },
      licenseExpiry: { lt: today },
      licenseIsExpired: false,
    },
    select: {
      id: true, firstName: true, lastName: true, email: true, licenseExpiry: true,
      fleetId: true,
      fleet: { select: { id: true, name: true, users: { where: { role: "FleetAdmin" }, select: { id: true, email: true }, take: 1 } } },
    },
  });

  if (expiredDrivers.length) {
    // Mark as expired in database
    await prisma.user.updateMany({
      where: { id: { in: expiredDrivers.map((d) => d.id) } },
      data: { licenseIsExpired: true },
    });

    // Notify Super Admin with summary
    const superAdmins = await prisma.user.findMany({
      where: { role: "SuperAdmin" },
      select: { id: true },
    });
    if (superAdmins.length) {
      const summary = expiredDrivers.map((d) => `${d.firstName} ${d.lastName} (${d.fleet?.name || "no fleet"})`).join(", ");
      await notificationService.createNotificationsForMultiple(
        superAdmins.map((sa) => sa.id),
        "DOCUMENT_EXPIRED",
        "Driver Licenses Expired",
        `${expiredDrivers.length} driver license(s) have expired: ${summary}`,
      );
    }

    for (const driver of expiredDrivers) {
      const fleetAdmin = driver.fleet?.users?.[0];
      if (fleetAdmin) {
        await notificationService.notify({
          userId: fleetAdmin.id,
          email: fleetAdmin.email,
          type: "DOCUMENT_EXPIRED",
          title: "Driver License Expired",
          message: `Driver ${driver.firstName} ${driver.lastName} license has expired.`,
          data: { driverId: driver.id, documentType: "license" },
        });
      }
      await notificationService.createNotification({
        userId: driver.id,
        type: "DOCUMENT_EXPIRED",
        title: "License Expired",
        message: "Your license has expired. Contact your fleet admin.",
      });
    }
    notifyCount += expiredDrivers.length;
  }

  // ── Step 2: Vehicle document expiry (insurance + inspection) ──────

  const expiringVehicles = await prisma.vehicle.findMany({
    where: {
      status: { not: "INACTIVE" },
      OR: [
        { insuranceExpiry: { gte: today, lte: in30Days } },
        { inspectionExpiry: { gte: today, lte: in30Days } },
      ],
    },
    select: {
      id: true, plateNumber: true, make: true, model: true,
      insuranceExpiry: true, inspectionExpiry: true,
      fleetId: true,
      fleet: { select: { name: true, users: { where: { role: "FleetAdmin" }, select: { id: true, email: true }, take: 1 } } },
    },
  });

  for (const v of expiringVehicles) {
    const fleetAdmin = v.fleet?.users?.[0];
    if (!fleetAdmin) continue;

    const docs = [];
    if (v.insuranceExpiry && v.insuranceExpiry >= today && v.insuranceExpiry <= in30Days) {
      docs.push({ type: "Insurance", expiry: v.insuranceExpiry });
    }
    if (v.inspectionExpiry && v.inspectionExpiry >= today && v.inspectionExpiry <= in30Days) {
      docs.push({ type: "Inspection", expiry: v.inspectionExpiry });
    }

    for (const doc of docs) {
      const days = daysUntil(doc.expiry);
      const urgent = doc.expiry <= in7Days;
      const prefix = urgent ? "URGENT: " : "";

      await notificationService.notify({
        userId: fleetAdmin.id,
        email: fleetAdmin.email,
        type: "DOCUMENT_EXPIRY_WARNING",
        title: `${prefix}Vehicle ${doc.type} Expiring`,
        message: `${prefix}${v.plateNumber} ${doc.type.toLowerCase()} expires in ${days} day(s).`,
        data: { vehicleId: v.id, documentType: doc.type, daysUntilExpiry: days },
      });
      notifyCount++;
    }
  }

  // Expired vehicle documents
  const expiredVehicles = await prisma.vehicle.findMany({
    where: {
      status: { not: "INACTIVE" },
      OR: [
        { insuranceExpiry: { lt: today }, insuranceIsExpired: false },
        { inspectionExpiry: { lt: today }, inspectionIsExpired: false },
      ],
    },
    select: {
      id: true, plateNumber: true,
      insuranceExpiry: true, insuranceIsExpired: true,
      inspectionExpiry: true, inspectionIsExpired: true,
      fleetId: true,
      fleet: { select: { name: true, users: { where: { role: "FleetAdmin" }, select: { id: true, email: true }, take: 1 } } },
    },
  });

  for (const v of expiredVehicles) {
    const updates = {};
    const expiredDocs = [];
    if (v.insuranceExpiry && v.insuranceExpiry < today && !v.insuranceIsExpired) {
      updates.insuranceIsExpired = true;
      expiredDocs.push("Insurance");
    }
    if (v.inspectionExpiry && v.inspectionExpiry < today && !v.inspectionIsExpired) {
      updates.inspectionIsExpired = true;
      expiredDocs.push("Inspection");
    }

    if (Object.keys(updates).length) {
      await prisma.vehicle.update({ where: { id: v.id }, data: updates });
    }

    const fleetAdmin = v.fleet?.users?.[0];
    if (fleetAdmin && expiredDocs.length) {
      await notificationService.notify({
        userId: fleetAdmin.id,
        email: fleetAdmin.email,
        type: "DOCUMENT_EXPIRED",
        title: "Vehicle Document Expired",
        message: `${v.plateNumber}: ${expiredDocs.join(", ")} has expired.`,
        data: { vehicleId: v.id },
      });
    }
  }

  // ── Step 3: Maintenance stale check ───────────────────────────────

  const staleVehicles = await prisma.vehicle.findMany({
    where: {
      status: "UNDER_MAINTENANCE",
      updatedAt: { lt: sevenDaysAgo },
    },
    select: {
      id: true, plateNumber: true, updatedAt: true,
      fleet: { select: { users: { where: { role: "FleetAdmin" }, select: { id: true, email: true }, take: 1 } } },
      maintenanceRecords: {
        where: { status: "COMPLETED", completedAt: { gte: sevenDaysAgo } },
        select: { id: true },
        take: 1,
      },
    },
  });

  for (const v of staleVehicles) {
    if (v.maintenanceRecords.length > 0) continue; // has recent completed maintenance
    const fleetAdmin = v.fleet?.users?.[0];
    if (!fleetAdmin) continue;

    const daysSince = Math.ceil((now - new Date(v.updatedAt)) / 86400000);
    await notificationService.notify({
      userId: fleetAdmin.id,
      email: fleetAdmin.email,
      type: "MAINTENANCE_STALE",
      title: "Stale Maintenance",
      message: `Vehicle ${v.plateNumber} has been under maintenance for ${daysSince} days. Please update the status.`,
      data: { vehicleId: v.id },
    });
    notifyCount++;
  }

  return { notifyCount, expiredDrivers: expiredDrivers.length, staleVehicles: staleVehicles.length };
}

module.exports = { run };
