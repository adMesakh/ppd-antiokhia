// Server utama: melayani landing page, dashboard admin, scanner PWA, dan semua API.
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const QRCode = require("qrcode");

const { db, DATA_DIR, getSettings, saveSettings } = require("./db");
const auth = require("./auth");
const { randomCode, cleanText, normalizePhone, csv, rateLimit } = require("./util");
const { churchRankings, contestResults } = require("./stats");

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

auth.ensureInitialAdmin();

const app = express();
app.disable("x-powered-by");
if (process.env.TRUST_PROXY) app.set("trust proxy", process.env.TRUST_PROXY === "true" ? true : process.env.TRUST_PROXY);

app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Referrer-Policy", "same-origin");
  res.set("X-Frame-Options", "DENY");
  res.set("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
  next();
});

const jsonSmall = express.json({ limit: "200kb" });
const jsonLarge = express.json({ limit: "15mb" });

const now = () => new Date().toISOString();
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const intId = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

// ---------------------------------------------------------------------------
// PUBLIK
// ---------------------------------------------------------------------------

// Dipakai scanner untuk membedakan "tersambung WiFi" dengan "benar-benar bisa menghubungi server"
// (WiFi berbayar yang belum login akan mengembalikan halaman login, bukan JSON ini).
app.get("/api/ping", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ ok: true, app: "rpk", time: now() });
});

function publicSettings(s) {
  const keys = ["event_name", "title_line1", "title_line2", "tagline", "start_at", "end_at", "dates_label", "location",
    "est_churches", "est_participants", "fee_per_person", "payment_note", "contact", "registration_open",
    "results_published", "music_url", "spotify_url"];
  return Object.fromEntries(keys.map((k) => [k, s[k]]));
}

app.get("/api/public", (req, res) => {
  const s = getSettings();
  const churches = db.prepare("SELECT id, name, city FROM churches ORDER BY name COLLATE NOCASE").all();
  const lineup = db.prepare("SELECT id, name, tier, note FROM lineup ORDER BY CASE tier WHEN 'utama' THEN 0 WHEN 'pembicara' THEN 1 ELSE 2 END, sort, id").all();
  const sessions = db.prepare("SELECT id, title, kind, day, starts_at, ends_at, location, speaker FROM sessions ORDER BY day, starts_at, id").all();
  const photos = db.prepare("SELECT id, filename, caption, width, height FROM photos ORDER BY created_at DESC, id DESC LIMIT 60").all()
    .map((p) => ({ ...p, url: `/uploads/${p.filename}` }));
  const counts = db.prepare(`
    SELECT COUNT(DISTINCT r.church_id) AS churches, COUNT(p.id) AS participants
    FROM registrations r LEFT JOIN participants p ON p.registration_id = r.id
    WHERE r.status = 'lunas'`).get();
  let results = null;
  if (s.results_published) {
    const rk = churchRankings();
    const strip = (r) => ({ church: r.church, city: r.city, present: r.present, confirmed: r.confirmed, seminar_per_person: r.seminar_per_person, seminar_rate: r.seminar_rate });
    results = {
      seminar_count: rk.seminar_count,
      most_participants: rk.most_participants.slice(0, 5).map(strip),
      most_active: rk.most_active.slice(0, 5).map(strip),
      contests: contestResults().map((c) => ({ contest: c.contest, rank: c.rank, winner: c.winner, church: c.church })),
    };
  }
  res.set("Cache-Control", "no-cache");
  res.json({ settings: publicSettings(s), churches, lineup, sessions, photos, stats: counts, results });
});

const registerLimit = rateLimit({ windowMs: 10 * 60e3, max: 12 });

app.post("/api/registrations", registerLimit, jsonSmall, (req, res) => {
  const s = getSettings();
  if (!s.registration_open) return bad(res, "Pendaftaran sedang ditutup. Hubungi panitia.");
  const b = req.body || {};
  const church = db.prepare("SELECT id, name FROM churches WHERE id = ?").get(intId(b.church_id));
  if (!church) return bad(res, "Pilih gereja asal dari daftar.");
  const coordinator = cleanText(b.coordinator, 80);
  if (coordinator.length < 2) return bad(res, "Isi nama koordinator.");
  const phone = normalizePhone(b.phone);
  if (!phone) return bad(res, "Nomor WhatsApp tidak valid. Gunakan format 08xxxxxxxxxx.");
  const list = Array.isArray(b.participants) ? b.participants : [];
  if (!list.length) return bad(res, "Tambahkan minimal satu peserta.");
  if (list.length > 150) return bad(res, "Maksimal 150 peserta per pendaftaran. Pecah menjadi beberapa pendaftaran.");
  const participants = [];
  for (const [i, p] of list.entries()) {
    const name = cleanText(p.name, 80);
    const role = p.role === "gembala" ? "gembala" : p.role === "peserta" ? "peserta" : null;
    const gender = p.gender === "L" || p.gender === "P" ? p.gender : null;
    const age = Number(p.age);
    if (name.length < 2 || !role || !gender || !Number.isInteger(age) || age < 5 || age > 99) {
      return bad(res, `Data peserta nomor ${i + 1} belum lengkap (nama, status, jenis kelamin, usia).`);
    }
    participants.push({ name, role, gender, age });
  }
  const hasMinor = participants.some((p) => p.age < 18);
  if (hasMinor && !b.consent) return bad(res, "Centang pernyataan izin orang tua untuk peserta di bawah 18 tahun.");
  const reg = createRegistration({ church_id: church.id, coordinator, phone, consent: !!b.consent, participants, source: "online", status: "menunggu", fee: Number(s.fee_per_person) || 0 });
  res.status(201).json({ code: reg.code, status_token: reg.status_token, status: reg.status, church: church.name, participants: participants.length });
});

function createRegistration({ church_id, coordinator, phone, consent, participants, source, status, fee, note = "", userId = null }) {
  const prefix = cleanText(getSettings().code_prefix, 8) || "RP";
  const tx = db.transaction(() => {
    let code;
    do { code = `${prefix}-${randomCode(5)}`; } while (db.prepare("SELECT 1 FROM registrations WHERE code = ?").get(code));
    const statusToken = crypto.randomBytes(18).toString("base64url");
    const info = db.prepare(`INSERT INTO registrations (code, status_token, church_id, coordinator, phone, consent, fee_per_person, status, source, note, confirmed_at, confirmed_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(code, statusToken, church_id, coordinator, phone, consent ? 1 : 0, fee, status, source, note,
      status === "lunas" ? now() : null, status === "lunas" ? userId : null);
    participants.forEach((p, i) => insertParticipant(info.lastInsertRowid, church_id, code, i + 1, p));
    return { id: info.lastInsertRowid, code, status_token: statusToken, status };
  });
  return tx();
}

function newQrToken() {
  let t;
  do { t = "R" + randomCode(11); } while (db.prepare("SELECT 1 FROM participants WHERE qr_token = ?").get(t));
  return t;
}

function insertParticipant(registrationId, churchId, regCode, seq, p) {
  const code = `${regCode}-${String(seq).padStart(3, "0")}`;
  return db.prepare(`INSERT INTO participants (registration_id, church_id, seq, code, qr_token, name, role, gender, age) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(registrationId, churchId, seq, code, newQrToken(), p.name, p.role, p.gender, p.age).lastInsertRowid;
}

function registrationView(reg, { includeQr }) {
  const church = db.prepare("SELECT name, city FROM churches WHERE id = ?").get(reg.church_id) || { name: "", city: "" };
  const participants = db.prepare("SELECT id, code, qr_token, name, role, gender, age FROM participants WHERE registration_id = ? ORDER BY seq").all(reg.id)
    .map((p) => {
      const out = { code: p.code, name: p.name, role: p.role, gender: p.gender, age: p.age };
      if (includeQr && reg.status === "lunas") out.qr = p.qr_token;
      return out;
    });
  return {
    code: reg.code, status: reg.status, church: church.name, city: church.city,
    coordinator: reg.coordinator, phone: reg.phone, fee_per_person: reg.fee_per_person,
    total: reg.fee_per_person * participants.length, created_at: reg.created_at, confirmed_at: reg.confirmed_at,
    participants,
  };
}

app.get("/api/status/:token", (req, res) => {
  const reg = db.prepare("SELECT * FROM registrations WHERE status_token = ?").get(String(req.params.token));
  if (!reg) return bad(res, "Pendaftaran tidak ditemukan. Periksa kembali tautan status kamu.", 404);
  res.set("Cache-Control", "no-store");
  res.json({ ...registrationView(reg, { includeQr: true }), payment_note: getSettings().payment_note });
});

const lookupLimit = rateLimit({ windowMs: 10 * 60e3, max: 20 });
app.post("/api/status/lookup", lookupLimit, jsonSmall, (req, res) => {
  const code = cleanText(req.body?.code, 20).toUpperCase();
  const phone = normalizePhone(req.body?.phone);
  const reg = phone && db.prepare("SELECT status_token FROM registrations WHERE code = ? AND phone = ?").get(code, phone);
  if (!reg) return bad(res, "Kode pendaftaran dan nomor WhatsApp tidak cocok.", 404);
  res.json({ status_token: reg.status_token });
});

// Gambar QR. Hanya untuk peserta yang pendaftarannya sudah lunas.
app.get("/api/qr/:token.svg", async (req, res) => {
  const row = db.prepare(`SELECT p.qr_token FROM participants p JOIN registrations r ON r.id = p.registration_id
    WHERE p.qr_token = ? AND r.status = 'lunas'`).get(String(req.params.token));
  if (!row) return res.status(404).end();
  const svg = await QRCode.toString(row.qr_token, { type: "svg", errorCorrectionLevel: "M", margin: 1, color: { dark: "#000000", light: "#ffffff" } });
  res.set("Content-Type", "image/svg+xml");
  res.set("Cache-Control", "private, max-age=86400");
  res.send(svg);
});

// ---------------------------------------------------------------------------
// LOGIN
// ---------------------------------------------------------------------------
const loginLimit = rateLimit({ windowMs: 10 * 60e3, max: 15, message: "Terlalu banyak percobaan login. Tunggu 10 menit." });

app.post("/api/auth/login", loginLimit, jsonSmall, (req, res) => {
  const username = cleanText(req.body?.username, 60);
  const password = String(req.body?.password || "");
  const mode = req.body?.mode === "scanner" ? "scanner" : "admin";
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!user || !user.active || !auth.verifyPassword(password, user.pass_hash)) return bad(res, "Username atau password salah.", 401);
  if (mode === "admin" && user.role !== "admin") return bad(res, "Akun ini hanya untuk scanner. Buka aplikasi scanner di /scan.", 403);
  const { token, expires } = auth.createToken(user, mode === "scanner" ? cleanText(req.body?.device, 60) || "scanner" : "admin-web");
  const pub = { id: user.id, username: user.username, name: user.name, role: user.role };
  if (mode === "scanner") return res.json({ token, expires, user: pub });
  const secure = req.secure || req.get("x-forwarded-proto") === "https";
  res.set("Set-Cookie", `${auth.COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${auth.ADMIN_DAYS * 86400}${secure ? "; Secure" : ""}`);
  res.json({ user: pub });
});

app.post("/api/auth/logout", (req, res) => {
  const u = auth.userFromRequest(req);
  if (u) db.prepare("DELETE FROM auth_tokens WHERE token = ?").run(u.token);
  res.set("Set-Cookie", `${auth.COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.json({ ok: true });
});

app.get("/api/auth/me", (req, res) => {
  const u = auth.userFromRequest(req);
  if (!u) return bad(res, "Belum login.", 401);
  res.json({ user: { id: u.id, username: u.username, name: u.name, role: u.role } });
});

// ---------------------------------------------------------------------------
// ADMIN
// ---------------------------------------------------------------------------
const admin = express.Router();
admin.use(auth.requireRole("admin"));

admin.get("/summary", (req, res) => {
  const reg = db.prepare(`SELECT
      SUM(status='menunggu') AS waiting, SUM(status='lunas') AS paid, SUM(status='batal') AS cancelled
    FROM registrations`).get();
  const ppl = db.prepare(`SELECT
      SUM(r.status='menunggu') AS waiting, SUM(r.status='lunas') AS paid,
      SUM(r.status='lunas' AND p.role='gembala') AS pastors,
      SUM(r.status='lunas' AND p.gender='L') AS male, SUM(r.status='lunas' AND p.gender='P') AS female,
      SUM(r.status='lunas' AND p.age < 18) AS minors
    FROM participants p JOIN registrations r ON r.id = p.registration_id`).get();
  const money = db.prepare(`SELECT
      SUM(CASE WHEN r.status='lunas' THEN r.fee_per_person ELSE 0 END) AS received,
      SUM(CASE WHEN r.status='menunggu' THEN r.fee_per_person ELSE 0 END) AS outstanding
    FROM participants p JOIN registrations r ON r.id = p.registration_id`).get();
  const churches = db.prepare("SELECT COUNT(*) AS total, (SELECT COUNT(DISTINCT church_id) FROM registrations WHERE status='lunas') AS paid FROM churches").get();
  const att = db.prepare("SELECT COUNT(*) AS scans, COUNT(DISTINCT participant_id) AS people, MAX(received_at) AS last FROM attendance").get();
  const recent = db.prepare(`SELECT r.id, r.code, r.status, r.created_at, c.name AS church, (SELECT COUNT(*) FROM participants WHERE registration_id = r.id) AS n
    FROM registrations r JOIN churches c ON c.id = r.church_id ORDER BY r.created_at DESC LIMIT 8`).all();
  const zero = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v ?? 0]));
  res.json({ registrations: zero(reg), participants: zero(ppl), money: zero(money), churches, attendance: att, recent });
});

admin.get("/settings", (req, res) => res.json(getSettings()));
admin.put("/settings", jsonSmall, (req, res) => {
  const b = req.body || {};
  const patch = {};
  const text = ["event_name", "title_line1", "title_line2", "tagline", "dates_label", "location", "payment_note", "contact", "music_url", "spotify_url", "code_prefix"];
  for (const k of text) if (k in b) patch[k] = cleanText(b[k], k === "payment_note" ? 400 : 200);
  for (const k of ["start_at", "end_at"]) if (k in b) {
    const d = new Date(b[k]);
    if (Number.isNaN(d.getTime())) return bad(res, "Format tanggal tidak valid.");
    patch[k] = String(b[k]);
  }
  for (const k of ["est_churches", "est_participants", "fee_per_person", "min_participants_for_activity"]) if (k in b) {
    const n = Number(b[k]);
    if (!Number.isFinite(n) || n < 0) return bad(res, "Angka tidak valid.");
    patch[k] = Math.round(n);
  }
  for (const k of ["registration_open", "results_published"]) if (k in b) patch[k] = !!b[k];
  if (patch.code_prefix !== undefined) patch.code_prefix = patch.code_prefix.toUpperCase().replace(/[^A-Z0-9]/g, "") || "RP";
  res.json(saveSettings(patch));
});

// --- Gereja ---
admin.get("/churches", (req, res) => {
  res.json(db.prepare(`SELECT c.*,
      (SELECT COUNT(*) FROM registrations r WHERE r.church_id = c.id AND r.status != 'batal') AS registrations,
      (SELECT COUNT(*) FROM participants p JOIN registrations r ON r.id = p.registration_id WHERE p.church_id = c.id AND r.status = 'lunas') AS paid_participants
    FROM churches c ORDER BY c.name COLLATE NOCASE`).all());
});
admin.post("/churches", jsonSmall, (req, res) => {
  // Bisa satu gereja {name, city} atau banyak sekaligus {bulk: "Nama, Kota\nNama, Kota"}
  const items = [];
  if (typeof req.body?.bulk === "string") {
    for (const line of req.body.bulk.split(/\r?\n/)) {
      const [name, city] = line.split(/[;,\t]/).map((x) => cleanText(x, 120));
      if (name) items.push({ name, city: city || "" });
    }
  } else {
    items.push({ name: cleanText(req.body?.name, 120), city: cleanText(req.body?.city, 80) });
  }
  if (!items.length || !items[0].name) return bad(res, "Isi nama gereja.");
  const ins = db.prepare("INSERT INTO churches (name, city) VALUES (?, ?) ON CONFLICT(name) DO NOTHING");
  let added = 0;
  db.transaction(() => { for (const it of items) added += ins.run(it.name, it.city).changes; })();
  res.status(201).json({ added, skipped: items.length - added });
});
admin.put("/churches/:id", jsonSmall, (req, res) => {
  const name = cleanText(req.body?.name, 120);
  if (!name) return bad(res, "Nama gereja tidak boleh kosong.");
  try {
    const r = db.prepare("UPDATE churches SET name = ?, city = ? WHERE id = ?").run(name, cleanText(req.body?.city, 80), intId(req.params.id));
    if (!r.changes) return bad(res, "Gereja tidak ditemukan.", 404);
  } catch { return bad(res, "Nama gereja sudah ada."); }
  res.json({ ok: true });
});
admin.delete("/churches/:id", (req, res) => {
  const id = intId(req.params.id);
  const used = db.prepare("SELECT COUNT(*) AS n FROM registrations WHERE church_id = ?").get(id).n;
  if (used) return bad(res, "Gereja ini sudah punya pendaftaran, jadi tidak bisa dihapus. Ubah namanya saja bila salah ketik.");
  db.prepare("DELETE FROM churches WHERE id = ?").run(id);
  res.json({ ok: true });
});

// --- Lineup (pembicara & bintang tamu) ---
admin.get("/lineup", (req, res) => res.json(db.prepare("SELECT * FROM lineup ORDER BY CASE tier WHEN 'utama' THEN 0 WHEN 'pembicara' THEN 1 ELSE 2 END, sort, id").all()));
function lineupBody(b) {
  const name = cleanText(b?.name, 80);
  const tier = ["utama", "pembicara", "tamu"].includes(b?.tier) ? b.tier : null;
  if (!name || !tier) return null;
  return { name, tier, note: cleanText(b?.note, 120), sort: Number(b?.sort) || 0 };
}
admin.post("/lineup", jsonSmall, (req, res) => {
  const v = lineupBody(req.body); if (!v) return bad(res, "Isi nama dan pilih peran.");
  db.prepare("INSERT INTO lineup (name, tier, note, sort) VALUES (@name, @tier, @note, @sort)").run(v);
  res.status(201).json({ ok: true });
});
admin.put("/lineup/:id", jsonSmall, (req, res) => {
  const v = lineupBody(req.body); if (!v) return bad(res, "Isi nama dan pilih peran.");
  db.prepare("UPDATE lineup SET name=@name, tier=@tier, note=@note, sort=@sort WHERE id=@id").run({ ...v, id: intId(req.params.id) });
  res.json({ ok: true });
});
admin.delete("/lineup/:id", (req, res) => { db.prepare("DELETE FROM lineup WHERE id = ?").run(intId(req.params.id)); res.json({ ok: true }); });

// --- Pendaftaran ---
admin.get("/registrations", (req, res) => {
  const where = []; const args = {};
  if (["menunggu", "lunas", "batal"].includes(req.query.status)) { where.push("r.status = @status"); args.status = req.query.status; }
  if (req.query.q) { where.push("(r.code LIKE @q OR r.coordinator LIKE @q OR r.phone LIKE @q OR c.name LIKE @q)"); args.q = `%${cleanText(req.query.q, 60)}%`; }
  res.json(db.prepare(`SELECT r.id, r.code, r.status, r.coordinator, r.phone, r.fee_per_person, r.source, r.note, r.created_at, r.confirmed_at,
      c.name AS church, c.city, u.name AS confirmed_by_name,
      (SELECT COUNT(*) FROM participants p WHERE p.registration_id = r.id) AS n,
      (SELECT COUNT(*) FROM participants p WHERE p.registration_id = r.id AND p.role='gembala') AS pastors
    FROM registrations r JOIN churches c ON c.id = r.church_id LEFT JOIN users u ON u.id = r.confirmed_by
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY CASE r.status WHEN 'menunggu' THEN 0 WHEN 'lunas' THEN 1 ELSE 2 END, r.created_at DESC`).all(args));
});
admin.get("/registrations/:id", (req, res) => {
  const reg = db.prepare("SELECT * FROM registrations WHERE id = ?").get(intId(req.params.id));
  if (!reg) return bad(res, "Pendaftaran tidak ditemukan.", 404);
  const church = db.prepare("SELECT id, name, city FROM churches WHERE id = ?").get(reg.church_id);
  const participants = db.prepare(`SELECT p.*, (SELECT COUNT(*) FROM attendance a WHERE a.participant_id = p.id) AS scans FROM participants p WHERE registration_id = ? ORDER BY seq`).all(reg.id);
  res.json({ ...reg, church, participants, status_url: `/status.html?t=${reg.status_token}` });
});
admin.post("/registrations", jsonSmall, (req, res) => {
  const b = req.body || {};
  const church = db.prepare("SELECT id FROM churches WHERE id = ?").get(intId(b.church_id));
  if (!church) return bad(res, "Pilih gereja.");
  const coordinator = cleanText(b.coordinator, 80) || "Didaftarkan admin";
  const phone = b.phone ? normalizePhone(b.phone) : "-";
  if (!phone) return bad(res, "Nomor WhatsApp tidak valid.");
  const participants = [];
  for (const [i, p] of (Array.isArray(b.participants) ? b.participants : []).entries()) {
    const name = cleanText(p.name, 80);
    const age = Number(p.age);
    if (name.length < 2 || !["gembala", "peserta"].includes(p.role) || !["L", "P"].includes(p.gender) || !Number.isInteger(age) || age < 5 || age > 99) {
      return bad(res, `Data peserta nomor ${i + 1} belum lengkap.`);
    }
    participants.push({ name, role: p.role, gender: p.gender, age });
  }
  if (!participants.length) return bad(res, "Tambahkan minimal satu peserta.");
  const status = b.status === "lunas" ? "lunas" : "menunggu";
  const fee = Number.isFinite(Number(b.fee_per_person)) ? Math.max(0, Math.round(Number(b.fee_per_person))) : Number(getSettings().fee_per_person) || 0;
  const reg = createRegistration({ church_id: church.id, coordinator, phone, consent: true, participants, source: "admin", status, fee, note: cleanText(b.note, 300), userId: req.user.id });
  res.status(201).json(reg);
});
admin.put("/registrations/:id", jsonSmall, (req, res) => {
  const b = req.body || {};
  const reg = db.prepare("SELECT * FROM registrations WHERE id = ?").get(intId(req.params.id));
  if (!reg) return bad(res, "Pendaftaran tidak ditemukan.", 404);
  const phone = b.phone !== undefined ? (normalizePhone(b.phone) || (b.phone === "-" ? "-" : null)) : reg.phone;
  if (!phone) return bad(res, "Nomor WhatsApp tidak valid.");
  const fee = b.fee_per_person !== undefined ? Math.max(0, Math.round(Number(b.fee_per_person) || 0)) : reg.fee_per_person;
  db.prepare("UPDATE registrations SET coordinator = ?, phone = ?, note = ?, fee_per_person = ? WHERE id = ?")
    .run(cleanText(b.coordinator ?? reg.coordinator, 80), phone, cleanText(b.note ?? reg.note, 300), fee, reg.id);
  res.json({ ok: true });
});
admin.patch("/registrations/:id/status", jsonSmall, (req, res) => {
  const status = req.body?.status;
  if (!["menunggu", "lunas", "batal"].includes(status)) return bad(res, "Status tidak dikenal.");
  const r = db.prepare("UPDATE registrations SET status = ?, confirmed_at = ?, confirmed_by = ? WHERE id = ?")
    .run(status, status === "lunas" ? now() : null, status === "lunas" ? req.user.id : null, intId(req.params.id));
  if (!r.changes) return bad(res, "Pendaftaran tidak ditemukan.", 404);
  res.json({ ok: true });
});
admin.delete("/registrations/:id", (req, res) => {
  const id = intId(req.params.id);
  const scans = db.prepare("SELECT COUNT(*) AS n FROM attendance a JOIN participants p ON p.id = a.participant_id WHERE p.registration_id = ?").get(id).n;
  if (scans) return bad(res, "Peserta di pendaftaran ini sudah punya data kehadiran. Ubah statusnya menjadi Batal saja.");
  db.prepare("DELETE FROM registrations WHERE id = ?").run(id);
  res.json({ ok: true });
});

// --- Peserta ---
function participantBody(b) {
  const name = cleanText(b?.name, 80);
  const age = Number(b?.age);
  if (name.length < 2 || !["gembala", "peserta"].includes(b?.role) || !["L", "P"].includes(b?.gender) || !Number.isInteger(age) || age < 5 || age > 99) return null;
  return { name, role: b.role, gender: b.gender, age };
}
admin.get("/participants", (req, res) => {
  const where = ["1=1"]; const args = {};
  if (req.query.status && ["menunggu", "lunas", "batal"].includes(req.query.status)) { where.push("r.status = @status"); args.status = req.query.status; }
  if (intId(req.query.church_id)) { where.push("p.church_id = @church"); args.church = intId(req.query.church_id); }
  if (req.query.q) { where.push("(p.name LIKE @q OR p.code LIKE @q)"); args.q = `%${cleanText(req.query.q, 60)}%`; }
  res.json(db.prepare(`SELECT p.id, p.code, p.qr_token, p.name, p.role, p.gender, p.age, r.id AS registration_id, r.code AS registration_code, r.status,
      c.id AS church_id, c.name AS church, (SELECT COUNT(*) FROM attendance a WHERE a.participant_id = p.id) AS scans
    FROM participants p JOIN registrations r ON r.id = p.registration_id JOIN churches c ON c.id = p.church_id
    WHERE ${where.join(" AND ")} ORDER BY c.name COLLATE NOCASE, p.name COLLATE NOCASE LIMIT 3000`).all(args));
});
admin.post("/registrations/:id/participants", jsonSmall, (req, res) => {
  const reg = db.prepare("SELECT * FROM registrations WHERE id = ?").get(intId(req.params.id));
  if (!reg) return bad(res, "Pendaftaran tidak ditemukan.", 404);
  const v = participantBody(req.body); if (!v) return bad(res, "Lengkapi nama, status, jenis kelamin, dan usia.");
  const seq = (db.prepare("SELECT MAX(seq) AS m FROM participants WHERE registration_id = ?").get(reg.id).m || 0) + 1;
  insertParticipant(reg.id, reg.church_id, reg.code, seq, v);
  res.status(201).json({ ok: true });
});
admin.put("/participants/:id", jsonSmall, (req, res) => {
  const v = participantBody(req.body); if (!v) return bad(res, "Lengkapi nama, status, jenis kelamin, dan usia.");
  const r = db.prepare("UPDATE participants SET name=@name, role=@role, gender=@gender, age=@age WHERE id=@id").run({ ...v, id: intId(req.params.id) });
  if (!r.changes) return bad(res, "Peserta tidak ditemukan.", 404);
  res.json({ ok: true });
});
admin.delete("/participants/:id", (req, res) => {
  const id = intId(req.params.id);
  if (db.prepare("SELECT COUNT(*) AS n FROM attendance WHERE participant_id = ?").get(id).n) return bad(res, "Peserta ini sudah punya data kehadiran, jadi tidak bisa dihapus.");
  db.prepare("DELETE FROM participants WHERE id = ?").run(id);
  res.json({ ok: true });
});
// Terbitkan QR baru (misalnya ID card hilang dan dikhawatirkan dipakai orang lain)
admin.post("/participants/:id/reissue", (req, res) => {
  const r = db.prepare("UPDATE participants SET qr_token = ? WHERE id = ?").run(newQrToken(), intId(req.params.id));
  if (!r.changes) return bad(res, "Peserta tidak ditemukan.", 404);
  res.json({ ok: true });
});

admin.get("/print", (req, res) => {
  const where = ["r.status = 'lunas'"]; const args = {};
  if (intId(req.query.church_id)) { where.push("p.church_id = @church"); args.church = intId(req.query.church_id); }
  if (intId(req.query.registration_id)) { where.push("p.registration_id = @reg"); args.reg = intId(req.query.registration_id); }
  if (req.query.ids) {
    const ids = String(req.query.ids).split(",").map(intId).filter(Boolean).slice(0, 500);
    if (ids.length) where.push(`p.id IN (${ids.join(",")})`);
  }
  const s = getSettings();
  res.json({
    event_name: s.event_name, dates_label: s.dates_label,
    participants: db.prepare(`SELECT p.code, p.qr_token, p.name, p.role, c.name AS church, c.city
      FROM participants p JOIN registrations r ON r.id = p.registration_id JOIN churches c ON c.id = p.church_id
      WHERE ${where.join(" AND ")} ORDER BY c.name COLLATE NOCASE, p.role, p.name COLLATE NOCASE`).all(args),
  });
});

// --- Jadwal sesi ---
function sessionBody(b) {
  const title = cleanText(b?.title, 120);
  const kind = ["checkin", "seminar"].includes(b?.kind) ? b.kind : null;
  const day = Number(b?.day);
  const t = (v) => /^\d{2}:\d{2}$/.test(String(v || "")) ? String(v) : "";
  if (!title || !kind || !Number.isInteger(day) || day < 1 || day > 14) return null;
  return { title, kind, day, starts_at: t(b.starts_at), ends_at: t(b.ends_at), location: cleanText(b?.location, 80), speaker: cleanText(b?.speaker, 80) };
}
admin.get("/sessions", (req, res) => {
  res.json(db.prepare(`SELECT s.*, (SELECT COUNT(*) FROM attendance a WHERE a.session_id = s.id) AS scans FROM sessions s ORDER BY day, starts_at, id`).all());
});
admin.post("/sessions", jsonSmall, (req, res) => {
  const v = sessionBody(req.body); if (!v) return bad(res, "Isi judul, jenis, dan hari ke-berapa.");
  db.prepare("INSERT INTO sessions (title, kind, day, starts_at, ends_at, location, speaker) VALUES (@title, @kind, @day, @starts_at, @ends_at, @location, @speaker)").run(v);
  res.status(201).json({ ok: true });
});
admin.put("/sessions/:id", jsonSmall, (req, res) => {
  const v = sessionBody(req.body); if (!v) return bad(res, "Isi judul, jenis, dan hari ke-berapa.");
  db.prepare("UPDATE sessions SET title=@title, kind=@kind, day=@day, starts_at=@starts_at, ends_at=@ends_at, location=@location, speaker=@speaker WHERE id=@id").run({ ...v, id: intId(req.params.id) });
  res.json({ ok: true });
});
admin.delete("/sessions/:id", (req, res) => {
  const id = intId(req.params.id);
  const n = db.prepare("SELECT COUNT(*) AS n FROM attendance WHERE session_id = ?").get(id).n;
  if (n && req.query.force !== "1") return bad(res, `Sesi ini sudah punya ${n} data scan. Hapus tetap? Kirim ulang dengan konfirmasi.`, 409);
  db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  res.json({ ok: true });
});

// --- Kehadiran ---
admin.get("/attendance", (req, res) => {
  const where = ["1=1"]; const args = {};
  if (intId(req.query.session_id)) { where.push("a.session_id = @s"); args.s = intId(req.query.session_id); }
  if (intId(req.query.church_id)) { where.push("p.church_id = @c"); args.c = intId(req.query.church_id); }
  res.json(db.prepare(`SELECT a.id, a.scanned_at, a.received_at, a.method, a.device_id, p.code, p.name, p.role, c.name AS church, s.title AS session, s.kind, u.name AS scanner
    FROM attendance a JOIN participants p ON p.id = a.participant_id JOIN churches c ON c.id = p.church_id
    JOIN sessions s ON s.id = a.session_id LEFT JOIN users u ON u.id = a.user_id
    WHERE ${where.join(" AND ")} ORDER BY a.scanned_at DESC LIMIT 2000`).all(args));
});
admin.post("/attendance", jsonSmall, (req, res) => {
  const pid = intId(req.body?.participant_id), sid = intId(req.body?.session_id);
  if (!db.prepare("SELECT 1 FROM participants WHERE id = ?").get(pid) || !db.prepare("SELECT 1 FROM sessions WHERE id = ?").get(sid)) return bad(res, "Peserta atau sesi tidak ditemukan.");
  const r = db.prepare("INSERT OR IGNORE INTO attendance (participant_id, session_id, scanned_at, method, device_id, user_id) VALUES (?, ?, ?, 'admin', 'admin-web', ?)").run(pid, sid, now(), req.user.id);
  res.status(r.changes ? 201 : 200).json({ added: r.changes });
});
admin.delete("/attendance/:id", (req, res) => { db.prepare("DELETE FROM attendance WHERE id = ?").run(intId(req.params.id)); res.json({ ok: true }); });

// --- Hasil & lomba ---
admin.get("/rankings", (req, res) => res.json(churchRankings()));
admin.get("/contests", (req, res) => res.json(contestResults()));
function contestBody(b) {
  const contest = cleanText(b?.contest, 80), winner = cleanText(b?.winner, 120), rank = Number(b?.rank);
  if (!contest || !winner || !Number.isInteger(rank) || rank < 1 || rank > 20) return null;
  const church = intId(b?.church_id);
  return { contest, winner, rank, church_id: church && db.prepare("SELECT 1 FROM churches WHERE id = ?").get(church) ? church : null };
}
admin.post("/contests", jsonSmall, (req, res) => {
  const v = contestBody(req.body); if (!v) return bad(res, "Isi nama lomba, peringkat, dan pemenang.");
  db.prepare("INSERT INTO contest_results (contest, rank, winner, church_id) VALUES (@contest, @rank, @winner, @church_id)").run(v);
  res.status(201).json({ ok: true });
});
admin.put("/contests/:id", jsonSmall, (req, res) => {
  const v = contestBody(req.body); if (!v) return bad(res, "Isi nama lomba, peringkat, dan pemenang.");
  db.prepare("UPDATE contest_results SET contest=@contest, rank=@rank, winner=@winner, church_id=@church_id WHERE id=@id").run({ ...v, id: intId(req.params.id) });
  res.json({ ok: true });
});
admin.delete("/contests/:id", (req, res) => { db.prepare("DELETE FROM contest_results WHERE id = ?").run(intId(req.params.id)); res.json({ ok: true }); });

// --- Galeri ---
admin.get("/photos", (req, res) => res.json(db.prepare("SELECT * FROM photos ORDER BY created_at DESC, id DESC").all().map((p) => ({ ...p, url: `/uploads/${p.filename}` }))));
admin.post("/photos", jsonLarge, (req, res) => {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.data || ""));
  if (!m) return bad(res, "Format foto harus JPG, PNG, atau WebP.");
  const buf = Buffer.from(m[2], "base64");
  const sig = buf.subarray(0, 12).toString("hex");
  const okSig = (m[1] === "jpeg" && sig.startsWith("ffd8ff")) || (m[1] === "png" && sig.startsWith("89504e47")) || (m[1] === "webp" && buf.subarray(8, 12).toString() === "WEBP");
  if (!okSig || buf.length > 10 * 1024 * 1024) return bad(res, "File foto rusak atau terlalu besar (maks 10 MB).");
  const filename = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${m[1] === "jpeg" ? "jpg" : m[1]}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), buf);
  db.prepare("INSERT INTO photos (filename, caption, width, height) VALUES (?, ?, ?, ?)").run(filename, cleanText(req.body?.caption, 200), intId(req.body?.width), intId(req.body?.height));
  res.status(201).json({ ok: true });
});
admin.put("/photos/:id", jsonSmall, (req, res) => { db.prepare("UPDATE photos SET caption = ? WHERE id = ?").run(cleanText(req.body?.caption, 200), intId(req.params.id)); res.json({ ok: true }); });
admin.delete("/photos/:id", (req, res) => {
  const p = db.prepare("SELECT filename FROM photos WHERE id = ?").get(intId(req.params.id));
  if (p) { fs.rmSync(path.join(UPLOAD_DIR, path.basename(p.filename)), { force: true }); db.prepare("DELETE FROM photos WHERE id = ?").run(intId(req.params.id)); }
  res.json({ ok: true });
});

// --- Akun ---
admin.get("/users", (req, res) => {
  res.json(db.prepare(`SELECT u.id, u.username, u.name, u.role, u.active, u.created_at,
      (SELECT COUNT(*) FROM auth_tokens t WHERE t.user_id = u.id AND t.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')) AS sessions,
      (SELECT COUNT(*) FROM attendance a WHERE a.user_id = u.id) AS scans
    FROM users u ORDER BY u.role, u.username COLLATE NOCASE`).all());
});
admin.post("/users", jsonSmall, (req, res) => {
  const username = cleanText(req.body?.username, 40).toLowerCase();
  const name = cleanText(req.body?.name, 60);
  const role = req.body?.role === "admin" ? "admin" : "scanner";
  const password = String(req.body?.password || "");
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) return bad(res, "Username 3–40 karakter: huruf kecil, angka, titik, strip.");
  if (password.length < 8) return bad(res, "Password minimal 8 karakter.");
  try {
    db.prepare("INSERT INTO users (username, name, role, pass_hash) VALUES (?, ?, ?, ?)").run(username, name || username, role, auth.hashPassword(password));
  } catch { return bad(res, "Username sudah dipakai."); }
  res.status(201).json({ ok: true });
});
admin.put("/users/:id", jsonSmall, (req, res) => {
  const id = intId(req.params.id);
  const u = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  if (!u) return bad(res, "Akun tidak ditemukan.", 404);
  const role = req.body?.role === "admin" ? "admin" : req.body?.role === "scanner" ? "scanner" : u.role;
  const active = req.body?.active === undefined ? u.active : (req.body.active ? 1 : 0);
  if (u.id === req.user.id && (role !== "admin" || !active)) return bad(res, "Kamu tidak bisa menonaktifkan atau menurunkan akunmu sendiri.");
  const pw = req.body?.password ? String(req.body.password) : null;
  if (pw && pw.length < 8) return bad(res, "Password minimal 8 karakter.");
  db.prepare("UPDATE users SET name = ?, role = ?, active = ?, pass_hash = ? WHERE id = ?")
    .run(cleanText(req.body?.name ?? u.name, 60) || u.username, role, active, pw ? auth.hashPassword(pw) : u.pass_hash, id);
  if (!active || pw) db.prepare("DELETE FROM auth_tokens WHERE user_id = ? AND token != ?").run(id, req.user.token);
  res.json({ ok: true });
});

// --- Export CSV ---
function sendCsv(res, name, rows, headers) {
  res.set("Content-Type", "text/csv; charset=utf-8");
  res.set("Content-Disposition", `attachment; filename="${name}"`);
  res.send(csv(rows, headers));
}
admin.get("/export/participants.csv", (req, res) => {
  const rows = db.prepare(`SELECT p.code AS kode_peserta, p.name AS nama, CASE p.role WHEN 'gembala' THEN 'Gembala sidang' ELSE 'Peserta' END AS status_peserta,
      p.gender AS jk, p.age AS usia, c.name AS gereja, c.city AS kota, r.code AS kode_pendaftaran, r.status AS status_bayar, r.coordinator AS koordinator, r.phone AS wa_koordinator,
      (SELECT COUNT(*) FROM attendance a WHERE a.participant_id = p.id) AS jumlah_scan
    FROM participants p JOIN registrations r ON r.id = p.registration_id JOIN churches c ON c.id = p.church_id ORDER BY c.name, p.name`).all();
  sendCsv(res, "peserta.csv", rows, ["kode_peserta", "nama", "status_peserta", "jk", "usia", "gereja", "kota", "kode_pendaftaran", "status_bayar", "koordinator", "wa_koordinator", "jumlah_scan"]);
});
admin.get("/export/attendance.csv", (req, res) => {
  const rows = db.prepare(`SELECT s.day AS hari, s.title AS sesi, s.kind AS jenis, p.code AS kode_peserta, p.name AS nama, c.name AS gereja, a.scanned_at AS waktu_scan, a.method AS metode, u.name AS petugas, a.device_id AS perangkat
    FROM attendance a JOIN participants p ON p.id = a.participant_id JOIN churches c ON c.id = p.church_id JOIN sessions s ON s.id = a.session_id LEFT JOIN users u ON u.id = a.user_id
    ORDER BY s.day, s.starts_at, a.scanned_at`).all();
  sendCsv(res, "kehadiran.csv", rows, ["hari", "sesi", "jenis", "kode_peserta", "nama", "gereja", "waktu_scan", "metode", "petugas", "perangkat"]);
});
admin.get("/export/rankings.csv", (req, res) => {
  const rows = churchRankings().all.map((r) => ({ gereja: r.church, kota: r.city, peserta_lunas: r.confirmed, peserta_hadir: r.present, scan_seminar: r.seminar_scans, seminar_per_peserta: r.seminar_per_person, persen_kehadiran_seminar: r.seminar_rate, ikut_nominasi_aktif: r.eligible_activity ? "ya" : "tidak" }));
  sendCsv(res, "nominasi-gereja.csv", rows, ["gereja", "kota", "peserta_lunas", "peserta_hadir", "scan_seminar", "seminar_per_peserta", "persen_kehadiran_seminar", "ikut_nominasi_aktif"]);
});

app.use("/api/admin", admin);

// ---------------------------------------------------------------------------
// SCANNER (admin juga boleh)
// ---------------------------------------------------------------------------
const scanner = express.Router();
scanner.use(auth.requireRole("scanner"));

scanner.get("/dataset", (req, res) => {
  const participants = db.prepare(`SELECT p.id, p.code, p.qr_token AS qr, p.name, p.role, p.church_id
    FROM participants p JOIN registrations r ON r.id = p.registration_id WHERE r.status = 'lunas' ORDER BY p.name COLLATE NOCASE`).all();
  const churches = db.prepare("SELECT id, name, city FROM churches ORDER BY name COLLATE NOCASE").all();
  const sessions = db.prepare("SELECT id, title, kind, day, starts_at, ends_at, location FROM sessions ORDER BY day, starts_at, id").all();
  const attendance = db.prepare("SELECT participant_id AS p, session_id AS s, scanned_at AS t FROM attendance").all();
  res.set("Cache-Control", "no-store");
  res.json({ generated_at: now(), event_name: getSettings().event_name, participants, churches, sessions, attendance });
});

scanner.post("/sync", jsonLarge, (req, res) => {
  const records = Array.isArray(req.body?.records) ? req.body.records.slice(0, 5000) : [];
  const device = cleanText(req.body?.device_id, 60);
  const accepted = [], duplicates = [], rejected = [];
  const findP = db.prepare("SELECT id FROM participants WHERE id = ?");
  const findS = db.prepare("SELECT id FROM sessions WHERE id = ?");
  const ins = db.prepare("INSERT OR IGNORE INTO attendance (participant_id, session_id, scanned_at, method, device_id, user_id) VALUES (?, ?, ?, ?, ?, ?)");
  const existing = db.prepare("SELECT scanned_at FROM attendance WHERE participant_id = ? AND session_id = ?");
  db.transaction(() => {
    for (const r of records) {
      const lid = String(r?.local_id || "");
      const pid = intId(r?.participant_id), sid = intId(r?.session_id);
      const t = new Date(r?.scanned_at);
      if (!lid || !pid || !sid || Number.isNaN(t.getTime())) { rejected.push({ local_id: lid, reason: "Data tidak lengkap" }); continue; }
      if (!findP.get(pid)) { rejected.push({ local_id: lid, reason: "Peserta sudah dihapus dari sistem" }); continue; }
      if (!findS.get(sid)) { rejected.push({ local_id: lid, reason: "Sesi sudah dihapus dari sistem" }); continue; }
      const method = ["qr", "manual", "kode"].includes(r.method) ? r.method : "qr";
      const info = ins.run(pid, sid, t.toISOString(), method, device, req.user.id);
      if (info.changes) accepted.push(lid);
      else duplicates.push({ local_id: lid, scanned_at: existing.get(pid, sid)?.scanned_at });
    }
  })();
  res.json({ accepted, duplicates, rejected, server_time: now() });
});

scanner.get("/attendance", (req, res) => {
  const since = req.query.since ? new Date(String(req.query.since)) : null;
  const rows = since && !Number.isNaN(since.getTime())
    ? db.prepare("SELECT participant_id AS p, session_id AS s, scanned_at AS t, received_at AS r FROM attendance WHERE received_at > ?").all(since.toISOString())
    : db.prepare("SELECT participant_id AS p, session_id AS s, scanned_at AS t, received_at AS r FROM attendance").all();
  res.set("Cache-Control", "no-store");
  res.json({ rows, server_time: now() });
});

app.use("/api/scanner", scanner);

app.use("/api", (req, res) => bad(res, "Alamat API tidak dikenal.", 404));

// Kesalahan JSON / ukuran body
app.use((err, req, res, next) => {
  if (err?.type === "entity.too.large") return bad(res, "Data terlalu besar.", 413);
  if (err?.type === "entity.parse.failed") return bad(res, "Format data tidak valid.");
  console.error(err);
  bad(res, "Terjadi kesalahan di server.", 500);
});

// ---------------------------------------------------------------------------
// FILE STATIS
// ---------------------------------------------------------------------------
app.use("/uploads", express.static(UPLOAD_DIR, { maxAge: "7d", immutable: true, fallthrough: false }));
app.get(["/scan/sw.js"], (req, res, next) => { res.set("Cache-Control", "no-cache"); res.set("Service-Worker-Allowed", "/scan/"); next(); });
// Dashboard dan halaman cetak hanya untuk admin yang sudah login; selain itu diarahkan ke halaman login.
app.get(["/admin", "/admin/", "/admin/index.html", "/admin/print.html"], (req, res, next) => {
  const u = auth.userFromRequest(req);
  if (u && u.role === "admin") return next();
  res.set("Cache-Control", "no-store");
  res.redirect(302, "/admin/login.html?next=" + encodeURIComponent(req.originalUrl === "/admin" ? "/admin/" : req.originalUrl));
});
app.use(express.static(PUBLIC_DIR, {
  extensions: ["html"],
  setHeaders(res, file) {
    if (file.endsWith(".html") || file.endsWith(".webmanifest") || file.endsWith("sw.js")) res.set("Cache-Control", "no-cache");
    else res.set("Cache-Control", "public, max-age=300");
  },
}));
app.use((req, res) => res.status(404).sendFile(path.join(PUBLIC_DIR, "404.html")));

if (require.main === module) {
  app.listen(PORT, () => console.log(`Retreat app berjalan di http://localhost:${PORT}  (admin: /admin, scanner: /scan)`));
}

module.exports = app;
