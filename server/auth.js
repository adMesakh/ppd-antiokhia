// Login admin & scanner. Password di-hash dengan scrypt (bawaan Node, tanpa library tambahan).
const crypto = require("crypto");
const { db } = require("./db");

const COOKIE = "rpk_session";
const ADMIN_DAYS = 14;   // sesi admin desktop
const SCANNER_DAYS = 45; // sesi scanner dibuat panjang supaya tidak kedaluwarsa saat offline di lokasi

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

function verifyPassword(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored).split("$");
  if (alg !== "scrypt" || !saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(pw, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(hashHex, "hex");
  return expected.length === hash.length && crypto.timingSafeEqual(expected, hash);
}

function createToken(user, label) {
  const token = crypto.randomBytes(32).toString("base64url");
  const days = user.role === "scanner" ? SCANNER_DAYS : ADMIN_DAYS;
  const expires = new Date(Date.now() + days * 864e5).toISOString();
  db.prepare("INSERT INTO auth_tokens (token, user_id, expires_at, label) VALUES (?, ?, ?, ?)").run(token, user.id, expires, label || "");
  return { token, expires };
}

function readCookie(req, name) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function userFromRequest(req) {
  const h = req.headers.authorization || "";
  const bearer = h.startsWith("Bearer ") ? h.slice(7).trim() : null;
  const token = bearer || readCookie(req, COOKIE);
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.id, u.username, u.name, u.role, u.active, t.expires_at
    FROM auth_tokens t JOIN users u ON u.id = t.user_id
    WHERE t.token = ?`).get(token);
  if (!row || !row.active || row.expires_at < new Date().toISOString()) return null;
  return { id: row.id, username: row.username, name: row.name, role: row.role, token, viaCookie: !bearer };
}

// role: "admin" = hanya admin; "scanner" = admin atau scanner
function requireRole(role) {
  return (req, res, next) => {
    const user = userFromRequest(req);
    if (!user) return res.status(401).json({ error: "Sesi berakhir. Silakan login lagi." });
    if (role === "admin" && user.role !== "admin") return res.status(403).json({ error: "Hanya admin yang boleh melakukan ini." });
    // Proteksi CSRF sederhana untuk sesi berbasis cookie: request yang mengubah data wajib membawa header khusus.
    if (user.viaCookie && req.method !== "GET" && req.get("X-RPK") !== "1") {
      return res.status(403).json({ error: "Permintaan ditolak." });
    }
    req.user = user;
    next();
  };
}

function ensureInitialAdmin() {
  const count = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n;
  if (count > 0) return;
  const username = process.env.ADMIN_USERNAME || "admin";
  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    password = crypto.randomBytes(6).toString("base64url");
    console.log(`\n[!] Admin pertama dibuat. Username: ${username}  Password: ${password}\n    Segera ganti password ini dari menu Akun.\n`);
  }
  db.prepare("INSERT INTO users (username, name, role, pass_hash) VALUES (?, ?, 'admin', ?)").run(username, "Admin utama", hashPassword(password));
}

module.exports = { COOKIE, ADMIN_DAYS, hashPassword, verifyPassword, createToken, userFromRequest, requireRole, ensureInitialAdmin };
