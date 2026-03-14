// ── Platform-branded email builder ──────────────────────────────────
// Uses platform-level branding for transfer, security, and fleet emails.

const { buildBaseEmail, PLATFORM_NAME } = require("./base.template");

const PLATFORM_DOMAIN = process.env.PLATFORM_DOMAIN || "dispatch365.com";
const PLATFORM_LOGO = process.env.PLATFORM_LOGO_URL || null;
const PLATFORM_PRIMARY = process.env.PLATFORM_PRIMARY_COLOR || "#0f3460";
const PLATFORM_SECONDARY = process.env.PLATFORM_SECONDARY_COLOR || "#16213e";
const PLATFORM_FOOTER = process.env.PLATFORM_FOOTER_TEXT || `© ${new Date().getFullYear()} ${PLATFORM_NAME}. All rights reserved.`;

/**
 * Build a complete platform-branded email.
 *
 * @param {Object} opts
 * @param {string} opts.subject
 * @param {string} opts.headerTitle
 * @param {string} opts.bodyHtml
 * @param {string} [opts.ctaText]
 * @param {string} [opts.ctaUrl]
 * @returns {{subject:string, html:string, from:string}}
 */
function buildPlatformEmail({ subject, headerTitle, bodyHtml, ctaText, ctaUrl }) {
  const html = buildBaseEmail({
    logoUrl: PLATFORM_LOGO,
    brandName: PLATFORM_NAME,
    primaryColor: PLATFORM_PRIMARY,
    secondaryColor: PLATFORM_SECONDARY,
    headerTitle,
    bodyHtml,
    footerText: PLATFORM_FOOTER,
    showPoweredBy: false, // platform IS the brand — no extra "Powered by" line
    ctaText,
    ctaUrl,
  });

  return {
    subject,
    html,
    from: `${PLATFORM_NAME} <noreply@${PLATFORM_DOMAIN}>`,
  };
}

module.exports = { buildPlatformEmail };
