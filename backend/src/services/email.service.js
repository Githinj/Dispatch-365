// ── Email Service ───────────────────────────────────────────────────
// Wraps Resend as the provider. Every public function is fire-and-forget:
// failures are logged, never thrown.

const { Resend } = require("resend");
const { buildAgencyEmail } = require("../templates/email/agency-branded.template");
const { buildPlatformEmail } = require("../templates/email/platform-branded.template");

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

const resend = new Resend(process.env.RESEND_API_KEY || "re_test_placeholder");

// ── Core send ──────────────────────────────────────────────────────

async function sendEmail({ to, subject, html, from, replyTo }) {
  try {
    const payload = {
      from: from || `Dispatch-365 <noreply@${process.env.PLATFORM_DOMAIN || "dispatch365.com"}>`,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
    };
    if (replyTo) payload.reply_to = replyTo;

    const result = await resend.emails.send(payload);
    console.log(`[Email] Sent "${subject}" → ${payload.to.join(", ")}  id=${result?.data?.id || "n/a"}`);
    return result;
  } catch (err) {
    console.error(`[Email] FAILED "${subject}" → ${to}:`, err.message);
    return null;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function fmt(date) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function money(n) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n || 0);
}

function fullName(u) {
  if (!u) return "Unknown";
  return `${u.firstName || ""} ${u.lastName || ""}`.trim() || "Unknown";
}

// ═══════════════════════════════════════════════════════════════════
//  LOAD EMAILS (agency branded)
// ═══════════════════════════════════════════════════════════════════

// 1. Load assigned to fleet
async function loadAssignedToFleet(load, agency, fleet, driver, vehicle) {
  const email = await buildAgencyEmail(agency.id, {
    subject: `New Load Assigned — Load #${load.loadNumber}`,
    headerTitle: "New Load Assigned",
    bodyHtml: `
      <p>A new load has been assigned to your fleet.</p>
      <table role="presentation" cellpadding="6" cellspacing="0" style="width:100%;margin:16px 0;border-collapse:collapse;">
        <tr><td style="color:#888;font-size:12px;">Load</td><td><strong>#${load.loadNumber}</strong></td></tr>
        <tr><td style="color:#888;font-size:12px;">Pickup</td><td>${load.origin}</td></tr>
        <tr><td style="color:#888;font-size:12px;">Drop-off</td><td>${load.destination}</td></tr>
        <tr><td style="color:#888;font-size:12px;">Pickup Date</td><td>${fmt(load.pickupDate)}</td></tr>
        <tr><td style="color:#888;font-size:12px;">Driver</td><td>${fullName(driver)}</td></tr>
        ${vehicle ? `<tr><td style="color:#888;font-size:12px;">Vehicle</td><td>${vehicle.plateNumber || vehicle.licensePlate || "—"}</td></tr>` : ""}
        <tr><td style="color:#888;font-size:12px;">Load Rate</td><td>${money(load.loadRate)}</td></tr>
      </table>`,
    ctaText: "View Load",
    ctaUrl: `${FRONTEND_URL}/loads/${load.id}`,
  });
  return email;
}

// 2. Delivery confirmation required
async function loadDeliveryConfirmationRequired(load, agency, dispatcher) {
  const email = await buildAgencyEmail(agency.id, {
    subject: `Delivery Confirmation Required — Load #${load.loadNumber}`,
    headerTitle: "Delivery Confirmation Required",
    bodyHtml: `
      <p>Hi ${fullName(dispatcher)},</p>
      <p>The driver has marked <strong>Load #${load.loadNumber}</strong> as delivered and uploaded a Proof of Delivery (POD).</p>
      <p>Please review the POD and confirm or reject the delivery.</p>
      <table role="presentation" cellpadding="6" cellspacing="0" style="width:100%;margin:16px 0;border-collapse:collapse;">
        <tr><td style="color:#888;font-size:12px;">Route</td><td>${load.origin} → ${load.destination}</td></tr>
        <tr><td style="color:#888;font-size:12px;">Submitted</td><td>${fmt(load.deliverySubmittedAt)}</td></tr>
      </table>`,
    ctaText: "Review Delivery",
    ctaUrl: `${FRONTEND_URL}/loads/${load.id}/delivery`,
  });
  return email;
}

// 3. Delivery rejected
async function loadDeliveryRejected(load, driver) {
  // Agency-branded since it's about a load within an agency context
  const email = await buildAgencyEmail(load.agencyId, {
    subject: `Delivery Not Confirmed — Load #${load.loadNumber}`,
    headerTitle: "Delivery Not Confirmed",
    bodyHtml: `
      <p>Hi ${fullName(driver)},</p>
      <p>Your delivery for <strong>Load #${load.loadNumber}</strong> was not confirmed by the dispatcher.</p>
      ${load.rejectionReason ? `<p><strong>Reason:</strong> ${load.rejectionReason}</p>` : ""}
      <p>Please re-upload your Proof of Delivery (POD) and try again.</p>`,
    ctaText: "View Load",
    ctaUrl: `${FRONTEND_URL}/loads/${load.id}`,
  });
  return email;
}

// 4. Load completed
async function loadCompleted(load, agency, fleet, driver) {
  const email = await buildAgencyEmail(agency.id, {
    subject: `Load Completed — Load #${load.loadNumber}`,
    headerTitle: "Load Completed",
    bodyHtml: `
      <p>Delivery for <strong>Load #${load.loadNumber}</strong> has been confirmed and the load is now complete.</p>
      <table role="presentation" cellpadding="6" cellspacing="0" style="width:100%;margin:16px 0;border-collapse:collapse;">
        <tr><td style="color:#888;font-size:12px;">Route</td><td>${load.origin} → ${load.destination}</td></tr>
        <tr><td style="color:#888;font-size:12px;">Fleet</td><td>${fleet?.name || "—"}</td></tr>
        <tr><td style="color:#888;font-size:12px;">Driver</td><td>${fullName(driver)}</td></tr>
        <tr><td style="color:#888;font-size:12px;">Completed</td><td>${fmt(load.completedAt)}</td></tr>
      </table>
      <p>An invoice has been automatically generated.</p>`,
  });
  return email;
}

// ═══════════════════════════════════════════════════════════════════
//  INVOICE EMAILS (agency branded)
// ═══════════════════════════════════════════════════════════════════

// 5. Invoice generated
async function invoiceGenerated(invoice, load, agency, fleet) {
  const email = await buildAgencyEmail(agency.id, {
    subject: `Invoice #${invoice.invoiceNumber} — Load #${load.loadNumber}`,
    headerTitle: `Invoice #${invoice.invoiceNumber}`,
    bodyHtml: `
      <p>An invoice has been generated for <strong>Load #${load.loadNumber}</strong>.</p>
      <table role="presentation" cellpadding="6" cellspacing="0" style="width:100%;margin:16px 0;border-collapse:collapse;">
        <tr><td style="color:#888;font-size:12px;">Invoice</td><td><strong>#${invoice.invoiceNumber}</strong></td></tr>
        <tr><td style="color:#888;font-size:12px;">Fleet</td><td>${fleet?.name || "—"}</td></tr>
        <tr><td style="color:#888;font-size:12px;">Load Rate</td><td>${money(invoice.loadRate)}</td></tr>
        <tr><td style="color:#888;font-size:12px;">Fleet Earnings</td><td>${money(invoice.fleetEarnings)}</td></tr>
        <tr><td style="color:#888;font-size:12px;">Due Date</td><td>${fmt(invoice.dueDate)}</td></tr>
      </table>`,
    ctaText: "View Invoice",
    ctaUrl: `${FRONTEND_URL}/invoices/${invoice.id}`,
  });
  return email;
}

// 6. Invoice due reminder (X days)
async function invoiceDueReminder(invoice, agency, fleet, daysUntilDue) {
  const email = await buildAgencyEmail(agency.id, {
    subject: `Invoice #${invoice.invoiceNumber} Due in ${daysUntilDue} Days`,
    headerTitle: "Payment Reminder",
    bodyHtml: `
      <p>This is a reminder that <strong>Invoice #${invoice.invoiceNumber}</strong> is due in <strong>${daysUntilDue} day(s)</strong>.</p>
      <table role="presentation" cellpadding="6" cellspacing="0" style="width:100%;margin:16px 0;border-collapse:collapse;">
        <tr><td style="color:#888;font-size:12px;">Fleet</td><td>${fleet?.name || "—"}</td></tr>
        <tr><td style="color:#888;font-size:12px;">Amount Due</td><td>${money(invoice.fleetEarnings)}</td></tr>
        <tr><td style="color:#888;font-size:12px;">Due Date</td><td>${fmt(invoice.dueDate)}</td></tr>
      </table>`,
    ctaText: "View Invoice",
    ctaUrl: `${FRONTEND_URL}/invoices/${invoice.id}`,
  });
  return email;
}

// 7. Invoice due today
async function invoiceDueToday(invoice, agency, fleet) {
  const email = await buildAgencyEmail(agency.id, {
    subject: `Invoice #${invoice.invoiceNumber} is Due Today`,
    headerTitle: "Invoice Due Today",
    bodyHtml: `
      <p><strong>Invoice #${invoice.invoiceNumber}</strong> is due <strong>today</strong>.</p>
      <table role="presentation" cellpadding="6" cellspacing="0" style="width:100%;margin:16px 0;border-collapse:collapse;">
        <tr><td style="color:#888;font-size:12px;">Fleet</td><td>${fleet?.name || "—"}</td></tr>
        <tr><td style="color:#888;font-size:12px;">Amount Due</td><td>${money(invoice.fleetEarnings)}</td></tr>
      </table>
      <p>Please record payment promptly to avoid overdue status.</p>`,
    ctaText: "Record Payment",
    ctaUrl: `${FRONTEND_URL}/invoices/${invoice.id}`,
  });
  return email;
}

// 8. Invoice overdue
async function invoiceOverdue(invoice, agency, fleet) {
  const email = await buildAgencyEmail(agency.id, {
    subject: `Invoice #${invoice.invoiceNumber} is Overdue`,
    headerTitle: "Invoice Overdue",
    bodyHtml: `
      <p style="color:#dc3545;font-weight:bold;">Invoice #${invoice.invoiceNumber} is now overdue.</p>
      <table role="presentation" cellpadding="6" cellspacing="0" style="width:100%;margin:16px 0;border-collapse:collapse;">
        <tr><td style="color:#888;font-size:12px;">Fleet</td><td>${fleet?.name || "—"}</td></tr>
        <tr><td style="color:#888;font-size:12px;">Original Due Date</td><td>${fmt(invoice.dueDate)}</td></tr>
        <tr><td style="color:#888;font-size:12px;">Amount Outstanding</td><td>${money(invoice.fleetEarnings - (invoice.paidAmount || 0))}</td></tr>
      </table>
      <p>Please arrange payment as soon as possible.</p>`,
    ctaText: "Record Payment",
    ctaUrl: `${FRONTEND_URL}/invoices/${invoice.id}`,
  });
  return email;
}

// 9. Payment recorded
async function paymentRecorded(invoice, receipt, agency, fleet) {
  const email = await buildAgencyEmail(agency.id, {
    subject: `Payment Received — Invoice #${invoice.invoiceNumber}`,
    headerTitle: "Payment Received",
    bodyHtml: `
      <p>Payment has been recorded for <strong>Invoice #${invoice.invoiceNumber}</strong>.</p>
      <table role="presentation" cellpadding="6" cellspacing="0" style="width:100%;margin:16px 0;border-collapse:collapse;">
        <tr><td style="color:#888;font-size:12px;">Amount Paid</td><td>${money(invoice.paidAmount)}</td></tr>
        <tr><td style="color:#888;font-size:12px;">Method</td><td>${(invoice.paymentMethod || "").replace("_", " ")}</td></tr>
        ${invoice.paymentReference ? `<tr><td style="color:#888;font-size:12px;">Reference</td><td>${invoice.paymentReference}</td></tr>` : ""}
        <tr><td style="color:#888;font-size:12px;">Payment Date</td><td>${fmt(invoice.paymentDate)}</td></tr>
      </table>
      ${receipt ? "<p>A receipt has been generated and is available for download.</p>" : ""}`,
    ctaText: receipt ? "Download Receipt" : "View Invoice",
    ctaUrl: receipt ? `${FRONTEND_URL}/receipts/${receipt.id}` : `${FRONTEND_URL}/invoices/${invoice.id}`,
  });
  return email;
}

// 10. Dispute raised
async function disputeRaised(invoice, agency, fleet, raisedBy) {
  const email = await buildAgencyEmail(agency.id, {
    subject: `Invoice Dispute Raised — #${invoice.invoiceNumber}`,
    headerTitle: "Invoice Dispute",
    bodyHtml: `
      <p>A dispute has been raised on <strong>Invoice #${invoice.invoiceNumber}</strong> by <strong>${fullName(raisedBy)}</strong>.</p>
      <p><strong>Reason:</strong> ${invoice.disputeReason || "No reason provided"}</p>
      <p>Please review and resolve this dispute outside the platform, then update the invoice status accordingly.</p>`,
    ctaText: "View Invoice",
    ctaUrl: `${FRONTEND_URL}/invoices/${invoice.id}`,
  });
  return email;
}

// 11. Dispute resolved
async function disputeResolved(invoice, agency, fleet) {
  const resolution = invoice.status === "PAID" ? "marked as paid" : "cancelled";
  const email = await buildAgencyEmail(agency.id, {
    subject: `Invoice Dispute Resolved — #${invoice.invoiceNumber}`,
    headerTitle: "Dispute Resolved",
    bodyHtml: `
      <p>The dispute on <strong>Invoice #${invoice.invoiceNumber}</strong> has been resolved.</p>
      <p>The invoice has been <strong>${resolution}</strong>.</p>`,
    ctaText: "View Invoice",
    ctaUrl: `${FRONTEND_URL}/invoices/${invoice.id}`,
  });
  return email;
}

// ═══════════════════════════════════════════════════════════════════
//  DISPATCHER TRANSFER EMAILS (platform branded)
// ═══════════════════════════════════════════════════════════════════

// 12. Dispatcher transfer requested → two emails
function dispatcherTransferRequested(dispatcher, fromAgency, toAgency) {
  const fromEmail = buildPlatformEmail({
    subject: `Dispatcher Transfer Request — ${fullName(dispatcher)}`,
    headerTitle: "Transfer Request",
    bodyHtml: `
      <p><strong>${fullName(dispatcher)}</strong> has requested a transfer out of <strong>${fromAgency.name}</strong>.</p>
      <p>They are requesting to join <strong>${toAgency.name}</strong>.</p>
      <p>The dispatcher has been <strong>suspended</strong> until both agencies approve or decline.</p>`,
    ctaText: "Review Request",
    ctaUrl: `${FRONTEND_URL}/dispatchers/transfers`,
  });

  const toEmail = buildPlatformEmail({
    subject: `Dispatcher Transfer Request — ${fullName(dispatcher)}`,
    headerTitle: "Incoming Transfer Request",
    bodyHtml: `
      <p><strong>${fullName(dispatcher)}</strong> has requested to join <strong>${toAgency.name}</strong>.</p>
      <p>They are currently with <strong>${fromAgency.name}</strong>.</p>
      <p>Please review and approve or decline this request.</p>`,
    ctaText: "Review Request",
    ctaUrl: `${FRONTEND_URL}/dispatchers/transfers`,
  });

  return { fromEmail, toEmail };
}

// 13. Dispatcher transfer approved
function dispatcherTransferApproved(dispatcher, newAgency) {
  return buildPlatformEmail({
    subject: `Transfer Approved — Welcome to ${newAgency.name}`,
    headerTitle: "Transfer Approved",
    bodyHtml: `
      <p>Hi ${fullName(dispatcher)},</p>
      <p>Your transfer to <strong>${newAgency.name}</strong> has been approved by both agencies.</p>
      <p>You are now an active dispatcher at ${newAgency.name} and can begin creating loads.</p>`,
    ctaText: "Go to Dashboard",
    ctaUrl: `${FRONTEND_URL}/dashboard`,
  });
}

// 14. Dispatcher transfer declined
function dispatcherTransferDeclined(dispatcher, declinedBy, reason) {
  return buildPlatformEmail({
    subject: "Transfer Request Declined",
    headerTitle: "Transfer Declined",
    bodyHtml: `
      <p>Hi ${fullName(dispatcher)},</p>
      <p>Your transfer request was declined by <strong>${declinedBy}</strong>.</p>
      ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ""}
      <p>Your account remains suspended. You may cancel the transfer to request account restoration.</p>`,
  });
}

// 15. Dispatcher transfer cancelled → two emails
function dispatcherTransferCancelled(dispatcher, fromAgency, toAgency) {
  const fromEmail = buildPlatformEmail({
    subject: `Dispatcher Transfer Cancelled — ${fullName(dispatcher)}`,
    headerTitle: "Transfer Cancelled — Restoration Pending",
    bodyHtml: `
      <p><strong>${fullName(dispatcher)}</strong> has cancelled their transfer request.</p>
      <p>Their account is now in <strong>Suspended (Restoration Pending)</strong> status.</p>
      <p>Please approve or decline their restoration.</p>`,
    ctaText: "Review Restoration Request",
    ctaUrl: `${FRONTEND_URL}/dispatchers/transfers`,
  });

  const toEmail = buildPlatformEmail({
    subject: `Transfer Request Cancelled — ${fullName(dispatcher)}`,
    headerTitle: "Transfer Cancelled",
    bodyHtml: `
      <p><strong>${fullName(dispatcher)}</strong> has cancelled their transfer request to your agency.</p>
      <p>No further action is required.</p>`,
  });

  return { fromEmail, toEmail };
}

// 16. Dispatcher restoration approved
function dispatcherRestorationApproved(dispatcher, agency) {
  return buildPlatformEmail({
    subject: `Account Restored — ${agency.name}`,
    headerTitle: "Account Restored",
    bodyHtml: `
      <p>Hi ${fullName(dispatcher)},</p>
      <p>Your account at <strong>${agency.name}</strong> has been restored. You are now active and can create loads again.</p>`,
    ctaText: "Go to Dashboard",
    ctaUrl: `${FRONTEND_URL}/dashboard`,
  });
}

// 17. Dispatcher restoration declined
function dispatcherRestorationDeclined(dispatcher, agency, reason) {
  return buildPlatformEmail({
    subject: "Restoration Declined",
    headerTitle: "Restoration Declined",
    bodyHtml: `
      <p>Hi ${fullName(dispatcher)},</p>
      <p>Your restoration request at <strong>${agency.name}</strong> was declined.</p>
      ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ""}
      <p>Your account is now <strong>Inactive</strong>. You may request to join another agency.</p>`,
    ctaText: "Find an Agency",
    ctaUrl: `${FRONTEND_URL}/agencies/browse`,
  });
}

// 18. Dispatcher join request received
function dispatcherJoinRequestReceived(dispatcher, agency) {
  return buildPlatformEmail({
    subject: `Join Request — ${fullName(dispatcher)}`,
    headerTitle: "New Join Request",
    bodyHtml: `
      <p><strong>${fullName(dispatcher)}</strong> has requested to join <strong>${agency.name}</strong>.</p>
      <p><strong>Email:</strong> ${dispatcher.email}</p>
      <p>Please review their profile and approve or decline.</p>`,
    ctaText: "Review Request",
    ctaUrl: `${FRONTEND_URL}/dispatchers/join-requests`,
  });
}

// 19. Dispatcher join approved
function dispatcherJoinApproved(dispatcher, agency) {
  return buildPlatformEmail({
    subject: `Welcome to ${agency.name}`,
    headerTitle: `Welcome to ${agency.name}`,
    bodyHtml: `
      <p>Hi ${fullName(dispatcher)},</p>
      <p>Your request to join <strong>${agency.name}</strong> has been approved!</p>
      <p>You are now an active dispatcher and can start creating loads.</p>`,
    ctaText: "Go to Dashboard",
    ctaUrl: `${FRONTEND_URL}/dashboard`,
  });
}

// 20. Dispatcher join declined
function dispatcherJoinDeclined(dispatcher, agency, reason) {
  return buildPlatformEmail({
    subject: "Join Request Declined",
    headerTitle: "Join Request Declined",
    bodyHtml: `
      <p>Hi ${fullName(dispatcher)},</p>
      <p>Your request to join <strong>${agency.name}</strong> was declined.</p>
      ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ""}
      <p>You may request to join this agency again after the 30-day cooldown period, or try another agency.</p>`,
  });
}

// 21. Dispatcher suspension reminder
function dispatcherSuspensionReminder(dispatcher, reason, daysRemaining) {
  return buildPlatformEmail({
    subject: "Your Account is Still Suspended",
    headerTitle: "Account Suspended",
    bodyHtml: `
      <p>Hi ${fullName(dispatcher)},</p>
      <p>Your account has been suspended for <strong>${reason}</strong>.</p>
      ${daysRemaining ? `<p>Estimated time remaining: <strong>${daysRemaining} day(s)</strong>.</p>` : ""}
      <p>If you initiated a transfer, you may cancel it to request account restoration.</p>`,
  });
}

// 22. Transfer pending admin reminder
function transferPendingAdminReminder(transferRequest, adminEmail, adminName, daysPending) {
  return buildPlatformEmail({
    subject: `Transfer Request Awaiting Approval — ${daysPending} Days Pending`,
    headerTitle: "Pending Transfer Request",
    bodyHtml: `
      <p>Hi ${adminName},</p>
      <p>A transfer request has been awaiting your approval for <strong>${daysPending} day(s)</strong>.</p>
      <p>Please review and take action to avoid keeping the dispatcher suspended indefinitely.</p>`,
    ctaText: "Review Now",
    ctaUrl: `${FRONTEND_URL}/dispatchers/transfers`,
  });
}

// ═══════════════════════════════════════════════════════════════════
//  DRIVER TRANSFER EMAILS (platform branded) — same pattern as dispatcher
// ═══════════════════════════════════════════════════════════════════

// 23. Driver transfer requested → two emails
function driverTransferRequested(driver, fromFleet, toFleet) {
  const fromEmail = buildPlatformEmail({
    subject: `Driver Transfer Request — ${fullName(driver)}`,
    headerTitle: "Driver Transfer Request",
    bodyHtml: `
      <p><strong>${fullName(driver)}</strong> has requested a transfer out of <strong>${fromFleet.name}</strong> to <strong>${toFleet.name}</strong>.</p>
      <p>The driver has been <strong>suspended</strong> until both fleets approve or decline.</p>`,
    ctaText: "Review Request",
    ctaUrl: `${FRONTEND_URL}/drivers/transfers`,
  });

  const toEmail = buildPlatformEmail({
    subject: `Driver Transfer Request — ${fullName(driver)}`,
    headerTitle: "Incoming Driver Transfer",
    bodyHtml: `
      <p><strong>${fullName(driver)}</strong> has requested to join <strong>${toFleet.name}</strong> from <strong>${fromFleet.name}</strong>.</p>
      <p>Please review and approve or decline.</p>`,
    ctaText: "Review Request",
    ctaUrl: `${FRONTEND_URL}/drivers/transfers`,
  });

  return { fromEmail, toEmail };
}

// 24. Driver transfer approved
function driverTransferApproved(driver, newFleet) {
  return buildPlatformEmail({
    subject: `Transfer Approved — Welcome to ${newFleet.name}`,
    headerTitle: "Transfer Approved",
    bodyHtml: `
      <p>Hi ${fullName(driver)},</p>
      <p>Your transfer to <strong>${newFleet.name}</strong> has been approved by both fleets. You can now receive load assignments.</p>`,
    ctaText: "Go to Dashboard",
    ctaUrl: `${FRONTEND_URL}/dashboard`,
  });
}

// 25. Driver transfer declined
function driverTransferDeclined(driver, declinedBy, reason) {
  return buildPlatformEmail({
    subject: "Driver Transfer Declined",
    headerTitle: "Transfer Declined",
    bodyHtml: `
      <p>Hi ${fullName(driver)},</p>
      <p>Your transfer request was declined by <strong>${declinedBy}</strong>.</p>
      ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ""}
      <p>Your account remains suspended. You may cancel the transfer to request restoration.</p>`,
  });
}

// 26. Driver transfer cancelled → two emails
function driverTransferCancelled(driver, fromFleet, toFleet) {
  const fromEmail = buildPlatformEmail({
    subject: `Driver Transfer Cancelled — ${fullName(driver)}`,
    headerTitle: "Transfer Cancelled — Restoration Pending",
    bodyHtml: `
      <p><strong>${fullName(driver)}</strong> has cancelled their transfer request.</p>
      <p>Their account is now <strong>Suspended (Restoration Pending)</strong>.</p>
      <p>Please approve or decline their restoration.</p>`,
    ctaText: "Review Restoration Request",
    ctaUrl: `${FRONTEND_URL}/drivers/transfers`,
  });

  const toEmail = buildPlatformEmail({
    subject: `Driver Transfer Cancelled — ${fullName(driver)}`,
    headerTitle: "Transfer Cancelled",
    bodyHtml: `
      <p><strong>${fullName(driver)}</strong> has cancelled their transfer request to your fleet. No action needed.</p>`,
  });

  return { fromEmail, toEmail };
}

// 27. Driver restoration approved
function driverRestorationApproved(driver, fleet) {
  return buildPlatformEmail({
    subject: `Account Restored — ${fleet.name}`,
    headerTitle: "Account Restored",
    bodyHtml: `
      <p>Hi ${fullName(driver)},</p>
      <p>Your account at <strong>${fleet.name}</strong> has been restored. You can now receive load assignments.</p>`,
    ctaText: "Go to Dashboard",
    ctaUrl: `${FRONTEND_URL}/dashboard`,
  });
}

// 28. Driver restoration declined
function driverRestorationDeclined(driver, fleet, reason) {
  return buildPlatformEmail({
    subject: "Driver Restoration Declined",
    headerTitle: "Restoration Declined",
    bodyHtml: `
      <p>Hi ${fullName(driver)},</p>
      <p>Your restoration at <strong>${fleet.name}</strong> was declined.</p>
      ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ""}
      <p>Your account is now <strong>Inactive</strong>. You may request to join another fleet.</p>`,
    ctaText: "Find a Fleet",
    ctaUrl: `${FRONTEND_URL}/fleets/browse`,
  });
}

// 29. Driver join request received
function driverJoinRequestReceived(driver, fleet) {
  return buildPlatformEmail({
    subject: `Driver Join Request — ${fullName(driver)}`,
    headerTitle: "New Driver Join Request",
    bodyHtml: `
      <p><strong>${fullName(driver)}</strong> has requested to join <strong>${fleet.name}</strong>.</p>
      <p><strong>Email:</strong> ${driver.email}</p>
      <p>Please review their profile and approve or decline.</p>`,
    ctaText: "Review Request",
    ctaUrl: `${FRONTEND_URL}/drivers/join-requests`,
  });
}

// 30. Driver join approved
function driverJoinApproved(driver, fleet) {
  return buildPlatformEmail({
    subject: `Welcome to ${fleet.name}`,
    headerTitle: `Welcome to ${fleet.name}`,
    bodyHtml: `
      <p>Hi ${fullName(driver)},</p>
      <p>Your request to join <strong>${fleet.name}</strong> has been approved! You can now receive load assignments.</p>`,
    ctaText: "Go to Dashboard",
    ctaUrl: `${FRONTEND_URL}/dashboard`,
  });
}

// 31. Driver join declined
function driverJoinDeclined(driver, fleet, reason) {
  return buildPlatformEmail({
    subject: "Driver Join Request Declined",
    headerTitle: "Join Request Declined",
    bodyHtml: `
      <p>Hi ${fullName(driver)},</p>
      <p>Your request to join <strong>${fleet.name}</strong> was declined.</p>
      ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ""}
      <p>You may request to join this fleet again after the 30-day cooldown period.</p>`,
  });
}

// 32. Driver suspension reminder
function driverSuspensionReminder(driver, reason, daysRemaining) {
  return buildPlatformEmail({
    subject: "Your Driver Account is Still Suspended",
    headerTitle: "Account Suspended",
    bodyHtml: `
      <p>Hi ${fullName(driver)},</p>
      <p>Your driver account is suspended: <strong>${reason}</strong>.</p>
      ${daysRemaining ? `<p>Estimated remaining: <strong>${daysRemaining} day(s)</strong>.</p>` : ""}
      <p>If you initiated a transfer, you may cancel it to request account restoration.</p>`,
  });
}

// ═══════════════════════════════════════════════════════════════════
//  FLEET EMAILS (platform branded)
// ═══════════════════════════════════════════════════════════════════

// 33. Fleet invited
function fleetInvited(fleet, agency, inviteToken) {
  return buildPlatformEmail({
    subject: `You've Been Invited to Join ${agency.name}`,
    headerTitle: "Fleet Invitation",
    bodyHtml: `
      <p>Hi,</p>
      <p><strong>${agency.name}</strong> has invited your fleet to join their dispatch network.</p>
      <p>Click below to register your fleet and start receiving load assignments.</p>`,
    ctaText: "Accept Invitation",
    ctaUrl: `${FRONTEND_URL}/fleet/register?token=${inviteToken}`,
  });
}

// 34. Fleet approved
function fleetApproved(fleet, agencies) {
  const agencyList = (agencies || []).map((a) => a.name).join(", ") || "your inviting agencies";
  return buildPlatformEmail({
    subject: "Your Fleet Has Been Approved",
    headerTitle: "Fleet Approved",
    bodyHtml: `
      <p>Hi ${fleet.adminName || fleet.name},</p>
      <p>Your fleet <strong>${fleet.name}</strong> has been approved by the platform.</p>
      <p>You can now receive loads from: <strong>${agencyList}</strong>.</p>`,
    ctaText: "Go to Dashboard",
    ctaUrl: `${FRONTEND_URL}/dashboard`,
  });
}

// 35. Fleet rejected
function fleetRejected(fleet, reason) {
  return buildPlatformEmail({
    subject: "Fleet Registration Not Approved",
    headerTitle: "Registration Not Approved",
    bodyHtml: `
      <p>Hi ${fleet.adminName || fleet.name},</p>
      <p>We were unable to approve your fleet <strong>${fleet.name}</strong> at this time.</p>
      ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ""}
      <p>Please review the feedback and resubmit your registration.</p>`,
  });
}

// ═══════════════════════════════════════════════════════════════════
//  SECURITY EMAILS (platform branded)
// ═══════════════════════════════════════════════════════════════════

// 36. Login detected on new device
function loginDetected(user, ipAddress, deviceInfo, timestamp) {
  return buildPlatformEmail({
    subject: "New Login Detected on Your Account",
    headerTitle: "New Login Detected",
    bodyHtml: `
      <p>Hi ${fullName(user)},</p>
      <p>A new login was detected on your account.</p>
      <table role="presentation" cellpadding="6" cellspacing="0" style="width:100%;margin:16px 0;border-collapse:collapse;">
        <tr><td style="color:#888;font-size:12px;">IP Address</td><td>${ipAddress || "Unknown"}</td></tr>
        <tr><td style="color:#888;font-size:12px;">Device</td><td>${deviceInfo || "Unknown"}</td></tr>
        <tr><td style="color:#888;font-size:12px;">Time</td><td>${fmt(timestamp)}</td></tr>
      </table>
      <p style="color:#dc3545;font-weight:bold;">If this was not you, contact support immediately.</p>`,
  });
}

// 37. Account locked
function accountLocked(email, minutesLocked) {
  return buildPlatformEmail({
    subject: "Your Account Has Been Temporarily Locked",
    headerTitle: "Account Locked",
    bodyHtml: `
      <p>Your account associated with <strong>${email}</strong> has been temporarily locked due to too many failed login attempts.</p>
      <p>Please try again in <strong>${minutesLocked} minutes</strong>.</p>
      <p>If you did not attempt to log in, please contact support.</p>`,
  });
}

// ═══════════════════════════════════════════════════════════════════
//  MONTHLY PERFORMANCE EMAILS (platform branded)
// ═══════════════════════════════════════════════════════════════════

function improvementTip(stats) {
  const metrics = [
    { key: "onTimeDeliveryRate", label: "on-time delivery rate", tip: "Try to communicate proactively with drivers about pickup schedules." },
    { key: "podAcceptanceRate", label: "POD acceptance rate", tip: "Ensure drivers upload clear, complete POD photos before marking delivered." },
    { key: "completionRate", label: "completion rate", tip: "Avoid cancelling loads after assignment — plan routes more carefully." },
    { key: "disputeRate", label: "dispute rate", tip: "Double-check load details and financials before completing loads.", inverted: true },
  ];
  let worst = null;
  for (const m of metrics) {
    const val = stats[m.key];
    if (val == null) continue;
    const score = m.inverted ? val : 1 - val;
    if (!worst || score > worst.score) worst = { ...m, score };
  }
  return worst ? `<p style="background:#fff3cd;padding:12px;border-radius:6px;"><strong>Tip:</strong> Your ${worst.label} could improve. ${worst.tip}</p>` : "";
}

// 38. Dispatcher monthly performance
function dispatcherMonthlyPerformance(dispatcher, stats, month) {
  const pct = (v) => `${((v || 0) * 100).toFixed(1)}%`;
  return buildPlatformEmail({
    subject: `Your Performance Summary for ${month}`,
    headerTitle: `Performance — ${month}`,
    bodyHtml: `
      <p>Hi ${fullName(dispatcher)},</p>
      <p>Here is your monthly performance summary.</p>
      <table role="presentation" cellpadding="6" cellspacing="0" style="width:100%;margin:16px 0;border-collapse:collapse;">
        <tr><td style="color:#888;font-size:12px;">Loads Created</td><td>${stats.totalLoadsCreated ?? 0}</td></tr>
        <tr><td style="color:#888;font-size:12px;">Loads Completed</td><td>${stats.totalLoadsCompleted ?? 0}</td></tr>
        <tr><td style="color:#888;font-size:12px;">On-Time Rate</td><td>${pct(stats.onTimeDeliveryRate)}</td></tr>
        <tr><td style="color:#888;font-size:12px;">POD Acceptance</td><td>${pct(stats.podAcceptanceRate)}</td></tr>
        <tr><td style="color:#888;font-size:12px;">Dispute Rate</td><td>${pct(stats.disputeRate)}</td></tr>
      </table>
      ${improvementTip(stats)}`,
  });
}

// 39. Driver monthly performance
function driverMonthlyPerformance(driver, stats, month) {
  const pct = (v) => `${((v || 0) * 100).toFixed(1)}%`;
  return buildPlatformEmail({
    subject: `Your Performance Summary for ${month}`,
    headerTitle: `Performance — ${month}`,
    bodyHtml: `
      <p>Hi ${fullName(driver)},</p>
      <p>Here is your monthly performance summary.</p>
      <table role="presentation" cellpadding="6" cellspacing="0" style="width:100%;margin:16px 0;border-collapse:collapse;">
        <tr><td style="color:#888;font-size:12px;">Loads Completed</td><td>${stats.totalLoadsCompleted ?? 0}</td></tr>
        <tr><td style="color:#888;font-size:12px;">On-Time Rate</td><td>${pct(stats.onTimeDeliveryRate)}</td></tr>
        <tr><td style="color:#888;font-size:12px;">POD Acceptance</td><td>${pct(stats.podAcceptanceRate)}</td></tr>
      </table>`,
  });
}

module.exports = {
  // Core
  sendEmail,
  // Load emails (agency branded)
  loadAssignedToFleet,
  loadDeliveryConfirmationRequired,
  loadDeliveryRejected,
  loadCompleted,
  // Invoice emails (agency branded)
  invoiceGenerated,
  invoiceDueReminder,
  invoiceDueToday,
  invoiceOverdue,
  paymentRecorded,
  disputeRaised,
  disputeResolved,
  // Dispatcher transfer emails (platform branded)
  dispatcherTransferRequested,
  dispatcherTransferApproved,
  dispatcherTransferDeclined,
  dispatcherTransferCancelled,
  dispatcherRestorationApproved,
  dispatcherRestorationDeclined,
  dispatcherJoinRequestReceived,
  dispatcherJoinApproved,
  dispatcherJoinDeclined,
  dispatcherSuspensionReminder,
  transferPendingAdminReminder,
  // Driver transfer emails (platform branded)
  driverTransferRequested,
  driverTransferApproved,
  driverTransferDeclined,
  driverTransferCancelled,
  driverRestorationApproved,
  driverRestorationDeclined,
  driverJoinRequestReceived,
  driverJoinApproved,
  driverJoinDeclined,
  driverSuspensionReminder,
  // Fleet emails (platform branded)
  fleetInvited,
  fleetApproved,
  fleetRejected,
  // Security emails (platform branded)
  loginDetected,
  accountLocked,
  // Performance emails (platform branded)
  dispatcherMonthlyPerformance,
  driverMonthlyPerformance,
};
