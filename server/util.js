const crypto = require("crypto");

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

// Pembatas laju sederhana di memori: maksimal `max` permintaan per `windowMs` per IP.
function rateLimit({ windowMs, max, message }) {
  const hits = new Map();
  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [k, arr] of hits) {
      const kept = arr.filter((t) => t > cutoff);
      if (kept.length) hits.set(k, kept); else hits.delete(k);
    }
  }, windowMs).unref();
  return (req, res, next) => {
    const key = req.ip || "unknown";
    const cutoff = Date.now() - windowMs;
    const arr = (hits.get(key) || []).filter((t) => t > cutoff);
    if (arr.length >= max) return res.status(429).json({ error: message || "Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi." });
    arr.push(Date.now());
    hits.set(key, arr);
    next();
  };
}

module.exports = { randomCode, cleanText, normalizePhone, csv, rateLimit };
