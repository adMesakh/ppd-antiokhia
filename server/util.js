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
    const s = v == null ? "" : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [headers.map(esc).join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
}

// Pembatas laju yang disimpan di database, supaya tetap berlaku walau Vercel menjalankan banyak salinan aplikasi.
// Maksimal `max` permintaan per `windowMs` per IP untuk setiap nama batas.
function rateLimit({ name, windowMs, max, message }) {
  return async (req, res, next) => {
    try {
      const key = `${name}:${req.ip || "unknown"}`;
      const now = Date.now();
      await query("DELETE FROM rate_hits WHERE at < $1", [now - windowMs]);
      // Catat dulu baru hitung, supaya permintaan paralel tidak bisa lolos bersamaan
      await query("INSERT INTO rate_hits (key, at) VALUES ($1, $2)", [key, now]);
      const n = (await one("SELECT COUNT(*)::int AS n FROM rate_hits WHERE key = $1 AND at >= $2", [key, now - windowMs])).n;
      if (n > max) return res.status(429).json({ error: message || "Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi." });
      next();
    } catch (e) { next(e); }
  };
}

module.exports = { randomCode, cleanText, normalizePhone, csv, rateLimit };
