// Header keamanan: satu sumber untuk server (laptop + API di Vercel) dan vercel.json (file statis di CDN Vercel).
// Jalankan `node server/headers.js` setelah mengubah daftar ini untuk menyalin ke vercel.json.
const BLOB = "https://*.public.blob.vercel-storage.com";
const CSP = [
  "default-src 'self'",
  "script-src 'self'", // tanpa skrip inline/eval: menutup sebagian besar celah XSS
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  `img-src 'self' data: blob: https://images.unsplash.com ${BLOB}`,
  `media-src 'self' blob: ${BLOB}`,
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const SECURITY_HEADERS = {
  "Content-Security-Policy": CSP,
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "camera=(self), microphone=(), geolocation=(), payment=(), usb=()",
};
// Halaman yang memuat data pribadi atau khusus panitia: jangan masuk mesin pencari
const NOINDEX = ["/admin/(.*)", "/scan/(.*)", "/status.html", "/wallboard.html", "/api/(.*)"];

module.exports = { CSP, SECURITY_HEADERS, NOINDEX };

if (require.main === module) {
  const fs = require("fs"), path = require("path");
  const file = path.join(__dirname, "..", "vercel.json");
  const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
  const isOurs = (h) => h.source === "/(.*)" || (h.headers.length === 1 && h.headers[0].key === "X-Robots-Tag");
  const rest = cfg.headers.filter((h) => !isOurs(h));
  cfg.headers = [
    { source: "/(.*)", headers: Object.entries(SECURITY_HEADERS).map(([key, value]) => ({ key, value })) },
    ...NOINDEX.map((source) => ({ source, headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] })),
    ...rest,
  ];
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
  console.log("vercel.json diperbarui");
}
