// ── Agency-branded email builder ────────────────────────────────────
// Fetches agency branding from the database and renders using the base template.

const { prisma } = require("../../services/prisma.service");
const { buildBaseEmail, PLATFORM_NAME } = require("./base.template");

const PLATFORM_DOMAIN = process.env.PLATFORM_DOMAIN || "dispatch365.com";

// Defaults when an agency field is missing
const DEFAULTS = {
  primaryColor: "#1a1a2e",
  secondaryColor: "#16213e",
  footerText: "",
};

/**
 * Build a complete agency-branded email.
 *
 * @param {string} agencyId
 * @param {Object} opts
 * @param {string} opts.subject
 * @param {string} opts.headerTitle
 * @param {string} opts.bodyHtml     — inner HTML for the body section
 * @param {string} [opts.ctaText]
 * @param {string} [opts.ctaUrl]
 * @returns {Promise<{subject:string, html:string, from:string, replyTo:string|undefined}>}
 */
async function buildAgencyEmail(agencyId, { subject, headerTitle, bodyHtml, ctaText, ctaUrl }) {
  const agency = await prisma.agency.findUnique({
    where: { id: agencyId },
    select: {
      name: true,
      logoUrl: true,
      primaryColor: true,
      secondaryColor: true,
      footerText: true,
      contactEmail: true,
    },
  });

  const name = agency?.name || PLATFORM_NAME;
  const primaryColor = agency?.primaryColor || DEFAULTS.primaryColor;
  const secondaryColor = agency?.secondaryColor || DEFAULTS.secondaryColor;
  const footerText = agency?.footerText || DEFAULTS.footerText;

  const html = buildBaseEmail({
    logoUrl: agency?.logoUrl || null,
    brandName: name,
    primaryColor,
    secondaryColor,
    headerTitle,
    bodyHtml,
    footerText,
    showPoweredBy: true,
    ctaText,
    ctaUrl,
  });

  return {
    subject,
    html,
    from: `${name} Dispatch <notifications@${PLATFORM_DOMAIN}>`,
    replyTo: agency?.contactEmail || undefined,
  };
}

module.exports = { buildAgencyEmail };
