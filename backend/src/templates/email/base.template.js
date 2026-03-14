// ── Base HTML email template ────────────────────────────────────────
// Inline-CSS only, single-column 600px, works across all major email clients.

const PLATFORM_NAME = process.env.PLATFORM_NAME || "Dispatch-365";

/**
 * @param {Object} opts
 * @param {string}  opts.logoUrl       — URL to logo image (agency or platform)
 * @param {string}  opts.brandName     — Displayed when logo is missing
 * @param {string}  opts.primaryColor  — Header bg + CTA button bg
 * @param {string}  opts.secondaryColor— Footer bg
 * @param {string}  opts.headerTitle   — Bold heading inside the header band
 * @param {string}  opts.bodyHtml      — Injected HTML for the email body
 * @param {string}  [opts.footerText]  — Custom footer line (agency slogan etc.)
 * @param {boolean} [opts.showPoweredBy] — Show "Powered by Platform" line
 * @param {string}  [opts.ctaText]     — Call-to-action button label
 * @param {string}  [opts.ctaUrl]      — Call-to-action button URL
 * @returns {string} Complete HTML email string
 */
function buildBaseEmail({
  logoUrl,
  brandName,
  primaryColor = "#1a1a2e",
  secondaryColor = "#16213e",
  headerTitle,
  bodyHtml,
  footerText,
  showPoweredBy = true,
  ctaText,
  ctaUrl,
}) {
  const logoBlock = logoUrl
    ? `<img src="${logoUrl}" alt="${brandName}" style="max-height:50px;max-width:180px;" />`
    : `<span style="font-size:22px;font-weight:bold;color:#ffffff;">${brandName}</span>`;

  const ctaBlock =
    ctaText && ctaUrl
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px auto;">
          <tr>
            <td style="background-color:${primaryColor};border-radius:6px;">
              <a href="${ctaUrl}" target="_blank"
                 style="display:inline-block;padding:12px 28px;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none;font-family:Arial,sans-serif;">
                ${ctaText}
              </a>
            </td>
          </tr>
        </table>`
      : "";

  const footerLines = [];
  if (footerText) footerLines.push(footerText);
  if (showPoweredBy) footerLines.push(`Powered by ${PLATFORM_NAME}`);

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${headerTitle}</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f4f4f4;">
    <tr>
      <td align="center" style="padding:20px 10px;">

        <!-- Container -->
        <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;overflow:hidden;">

          <!-- Header -->
          <tr>
            <td style="background-color:${primaryColor};padding:24px 30px;text-align:center;">
              ${logoBlock}
            </td>
          </tr>

          <!-- Header Title -->
          <tr>
            <td style="background-color:${primaryColor};padding:0 30px 20px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:bold;font-family:Arial,sans-serif;">
                ${headerTitle}
              </h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:30px;font-size:14px;line-height:1.6;color:#333333;font-family:Arial,sans-serif;">
              ${bodyHtml}
              ${ctaBlock}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:${secondaryColor};padding:20px 30px;text-align:center;font-size:12px;color:#cccccc;font-family:Arial,sans-serif;">
              ${footerLines.map((l) => `<p style="margin:4px 0;">${l}</p>`).join("\n              ")}
            </td>
          </tr>

        </table>
        <!-- /Container -->

      </td>
    </tr>
  </table>
</body>
</html>`;
}

module.exports = { buildBaseEmail, PLATFORM_NAME };
