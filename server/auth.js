// Login admin & scanner. Password di-hash dengan scrypt (bawaan Node, tanpa library tambahan).
const crypto = require("crypto");
const { one, query } = require("./db");

const COOKIE = "rpk_session";
const ADMIN_DAYS = 14;   // sesi admin desktop
const SCANNER_DAYS = 14; // cukup untuk login H-7 lalu offline selama acara; data peserta di HP tidak tersimpan terlalu lama

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

// Token sesi hanya disimpan sebagai hash SHA-256: bila isi database bocor, token tidak bisa dipakai untuk login.
const hashToken = (t) => "h:" + crypto.createHash("sha256").update(String(t)).digest("base64url");

async function createToken(user, label) {
  const token = crypto.randomBytes(32).toString("base64url");
  const days = user.role === "scanner" ? SCANNER_DAYS : ADMIN_DAYS;
  const expires = new Date(Date.now() + days * 864e5).toISOString();
  await query("DELETE FROM auth_tokens WHERE expires_at < $1", [new Date().toISOString()]); // bersihkan sesi kedaluwarsa
  await query("INSERT INTO auth_tokens (token, user_id, expires_at, label) VALUES ($1, $2, $3, $4)", [hashToken(token), user.id, expires, cleanLabel(label)]);
  return { token, expires };
}
const cleanLabel = (s) => String(s || "").replace(/[\u0000-\u001f]/g, " ").slice(0, 60);
async function revokeToken(token) {
  await query("DELETE FROM auth_tokens WHERE token = $1 OR token = $2", [hashToken(token), token]);
}

// Bandingkan dengan hash palsu bila username tidak ada, supaya waktu respons tidak membocorkan username yang terdaftar
const DUMMY_HASH = hashPassword(crypto.randomBytes(12).toString("hex"));
function checkLogin(user, password) {
  const ok = verifyPassword(password, user ? user.pass_hash : DUMMY_HASH);
  return !!(user && user.active && ok);
}

function readCookie(req, name) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

async function userFromRequest(req) {
  const h = req.headers.authorization || "";
  const bearer = h.startsWith("Bearer ") ? h.slice(7).trim() : null;
  const token = bearer || readCookie(req, COOKIE);
  // Token asli tidak pernah mengandung ":"; menolak nilai berbentuk hash supaya isi database yang bocor tidak bisa dipakai login
  if (!token || token.length > 200 || token.includes(":")) return null;
  const hashed = hashToken(token);
  let row = await one(`
    SELECT u.id, u.username, u.name, u.role, u.active, t.expires_at, t.token AS stored
    FROM auth_tokens t JOIN users u ON u.id = t.user_id
    WHERE t.token = $1 OR (t.token = $2 AND t.token NOT LIKE 'h:%')`, [hashed, token]);
  if (!row || !row.active || row.expires_at < new Date().toISOString()) return null;
  // Sesi lama (sebelum token di-hash) diubah ke bentuk hash tanpa perlu login ulang
  if (row.stored !== hashed) await query("UPDATE auth_tokens SET token = $1 WHERE token = $2", [hashed, token]);
  return { id: row.id, username: row.username, name: row.name, role: row.role, token, viaCookie: !bearer };
}

// role: "admin" = hanya admin; "scanner" = admin atau scanner
function requireRole(role) {
  return async (req, res, next) => {
    try {
      const user = await userFromRequest(req);
      if (!user) return res.status(401).json({ error: "Sesi berakhir. Silakan login lagi." });
      if (role === "admin" && user.role !== "admin") return res.status(403).json({ error: "Hanya admin yang boleh melakukan ini." });
      // Proteksi CSRF sederhana untuk sesi berbasis cookie: request yang mengubah data wajib membawa header khusus.
      if (user.viaCookie && req.method !== "GET" && req.get("X-RPK") !== "1") {
        return res.status(403).json({ error: "Permintaan ditolak." });
      }
      req.user = user;
      next();
    } catch (e) { next(e); }
  };
}

let adminChecked = false;
const state = { needsAdminPassword: false };
async function ensureInitialAdmin() {
  if (adminChecked) return;
  const n = (await one("SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin'")).n;
  if (n === 0) {
    const username = process.env.ADMIN_USERNAME || "admin";
    let password = process.env.ADMIN_PASSWORD;
    if (!password) {
      // Di Vercel banyak salinan fungsi bisa menyala bersamaan, jadi password acak tidak bisa diandalkan.
      if (process.env.VERCEL) { state.needsAdminPassword = true; return; }
      password = crypto.randomBytes(6).toString("base64url");
    }
    const r = await query("INSERT INTO users (username, name, role, pass_hash) VALUES ($1, $2, 'admin', $3) ON CONFLICT DO NOTHING RETURNING id", [username, "Admin utama", hashPassword(password)]);
    if (r.rowCount && !process.env.ADMIN_PASSWORD) console.log(`\n[!] Admin pertama dibuat. Username: ${username}  Password: ${password}\n    Segera ganti password ini dari menu Akun.\n`);
  }
  state.needsAdminPassword = false;
  adminChecked = true;
}

module.exports = { state, hashToken, revokeToken, checkLogin, COOKIE, ADMIN_DAYS, hashPassword, verifyPassword, createToken, userFromRequest, requireRole, ensureInitialAdmin };
