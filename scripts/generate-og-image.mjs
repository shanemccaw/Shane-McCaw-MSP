import { execSync } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "../artifacts/shane-mccaw-consulting/public/og-image.png");
const TMP_SVG = resolve(__dirname, "../.tmp-og.svg");

const W = 1200;
const H = 630;

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0A2540"/>
      <stop offset="100%" stop-color="#0D2F4F"/>
    </linearGradient>
    <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#0078D4"/>
      <stop offset="100%" stop-color="#00B4D8"/>
    </linearGradient>
    <linearGradient id="logo-grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0078D4"/>
      <stop offset="100%" stop-color="#00B4D8"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="${W}" height="${H}" fill="url(#bg)"/>

  <!-- Subtle grid pattern overlay -->
  <g opacity="0.04" stroke="#FFFFFF" stroke-width="1" fill="none">
    <line x1="0" y1="105" x2="${W}" y2="105"/>
    <line x1="0" y1="210" x2="${W}" y2="210"/>
    <line x1="0" y1="315" x2="${W}" y2="315"/>
    <line x1="0" y1="420" x2="${W}" y2="420"/>
    <line x1="0" y1="525" x2="${W}" y2="525"/>
    <line x1="200" y1="0" x2="200" y2="${H}"/>
    <line x1="400" y1="0" x2="400" y2="${H}"/>
    <line x1="600" y1="0" x2="600" y2="${H}"/>
    <line x1="800" y1="0" x2="800" y2="${H}"/>
    <line x1="1000" y1="0" x2="1000" y2="${H}"/>
  </g>

  <!-- Large decorative circle (bottom right) -->
  <circle cx="1050" cy="550" r="280" fill="none" stroke="#0078D4" stroke-width="1" opacity="0.12"/>
  <circle cx="1050" cy="550" r="200" fill="none" stroke="#00B4D8" stroke-width="1" opacity="0.08"/>

  <!-- Top accent bar -->
  <rect x="0" y="0" width="${W}" height="5" fill="url(#accent)"/>

  <!-- Logo mark — rounded square with "SM" initials -->
  <rect x="72" y="72" width="80" height="80" rx="16" fill="url(#logo-grad)"/>
  <text x="112" y="128" font-family="Arial Black, Arial, sans-serif" font-size="38" font-weight="900" fill="#FFFFFF" text-anchor="middle" dominant-baseline="auto">SM</text>

  <!-- Main heading -->
  <text x="72" y="248" font-family="Arial, sans-serif" font-size="68" font-weight="700" fill="#FFFFFF" letter-spacing="-1">Shane McCaw</text>

  <!-- Blue accent underline -->
  <rect x="72" y="262" width="460" height="4" rx="2" fill="url(#accent)"/>

  <!-- Subtitle / role -->
  <text x="72" y="320" font-family="Arial, sans-serif" font-size="28" font-weight="400" fill="#00B4D8" letter-spacing="0.5">Lead Microsoft 365 Architect · NASA</text>

  <!-- Tagline -->
  <text x="72" y="375" font-family="Arial, sans-serif" font-size="22" font-weight="300" fill="#C8D8E8" letter-spacing="0.3">30 years in the Microsoft ecosystem. Trusted by federal agencies.</text>

  <!-- Divider -->
  <rect x="72" y="418" width="700" height="1" fill="#1E4070" opacity="0.8"/>

  <!-- Service tags -->
  <g font-family="Arial, sans-serif" font-size="16" font-weight="600" fill="#FFFFFF">
    <!-- Tag 1 -->
    <rect x="72" y="440" width="170" height="36" rx="18" fill="#0078D4" opacity="0.9"/>
    <text x="157" y="464" text-anchor="middle" dominant-baseline="auto">Microsoft 365</text>

    <!-- Tag 2 -->
    <rect x="254" y="440" width="150" height="36" rx="18" fill="#0078D4" opacity="0.9"/>
    <text x="329" y="464" text-anchor="middle" dominant-baseline="auto">Copilot AI</text>

    <!-- Tag 3 -->
    <rect x="416" y="440" width="140" height="36" rx="18" fill="#0078D4" opacity="0.9"/>
    <text x="486" y="464" text-anchor="middle" dominant-baseline="auto">SharePoint</text>

    <!-- Tag 4 -->
    <rect x="568" y="440" width="180" height="36" rx="18" fill="#0078D4" opacity="0.9"/>
    <text x="658" y="464" text-anchor="middle" dominant-baseline="auto">Power Platform</text>
  </g>

  <!-- Website URL bottom -->
  <text x="72" y="570" font-family="Arial, sans-serif" font-size="20" font-weight="400" fill="#5B8DB8" letter-spacing="1">shanemccaw.com</text>

  <!-- Bottom accent bar -->
  <rect x="0" y="${H - 4}" width="${W}" height="4" fill="url(#accent)"/>
</svg>`;

writeFileSync(TMP_SVG, svg, "utf8");
console.log("SVG written to", TMP_SVG);

try {
  execSync(
    `magick -background none "${TMP_SVG}" -resize ${W}x${H}! "${OUT}"`,
    { stdio: "inherit" }
  );
  console.log("OG image written to", OUT);
} finally {
  unlinkSync(TMP_SVG);
}
