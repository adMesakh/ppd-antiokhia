const crypto = require("crypto");
const { query, one } = require("./db");

const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // tanpa O/0/I/1 supaya mudah dibaca dan diketik

function randomCode(len) {
  const bytes = crypto.randomBytes(len);
  let s = "";
  for (let i = 0; i < len; i++) s += ALPHA[bytes[i] % ALPHA.length];
  return s;
}

function cleanText(v, max = 120) {
  return String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

// Normalisasi nomor HP Indonesia ke format 08xxxxxxxxx. Mengembalikan null bila tidak valid.
function normalizePhone(v) {
  let d = String(v ?? "").replace(/[^\d+]/g, "");
  if (d.startsWith("+62")) d = "0" + d.slice(3);
  else if (d.startsWith("62")) d = "0" + d.slice(2);
  return /^08\d{7,12}$/.test(d) ? d : null;
}

function csv(rows, headers) {
  const esc = (v) => {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s; // cegah rumus berbahaya saat dibuka di Excel
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [headers.map(esc).join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
}

// Pembatas laju yang disimpan di database, supaya tetap berlaku walau Vercel menjalankan banyak salinan aplikasi.
// Maksimal `max` permintaan per `windowMs` per IP untuk setiap nama batas.
// IP pengunjung. Di Vercel dipakai header yang diisi Vercel sendiri (tidak bisa dipalsukan pengunjung).
function clientIp(req) {
  if (process.env.VERCEL) return String(req.get("x-real-ip") || req.get("x-vercel-forwarded-for") || req.ip || "unknown").split(",")[0].trim();
  return req.ip || "unknown";
}
// key(req) opsional: misalnya per username, supaya tebak-tebakan password dari banyak IP tetap dibatasi
function rateLimit({ name, windowMs, max, message, key: keyFn }) {
  return async (req, res, next) => {
    try {
      const id = keyFn ? keyFn(req) : clientIp(req);
      if (!id) return next();
      const key = `${name}:${String(id).slice(0, 80)}`;
      const now = Date.now();
      await query("DELETE FROM rate_hits WHERE key LIKE $1 AND at < $2", [name + ":%", now - windowMs]);
      // Catat dulu baru hitung, supaya permintaan paralel tidak bisa lolos bersamaan
      await query("INSERT INTO rate_hits (key, at) VALUES ($1, $2)", [key, now]);
      const n = (await one("SELECT COUNT(*)::int AS n FROM rate_hits WHERE key = $1 AND at >= $2", [key, now - windowMs])).n;
      if (n > max) return res.status(429).json({ error: message || "Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi." });
      next();
    } catch (e) { next(e); }
  };
}

// Hanya alamat https (untuk tautan yang diisi admin: Spotify, Google Drive)
const httpsUrl = (u) => /^https:\/\/[^\s"'<>]+\.[^\s"'<>]+$/.test(String(u || ""));
module.exports = { randomCode, cleanText, normalizePhone, csv, rateLimit, clientIp, httpsUrl };
