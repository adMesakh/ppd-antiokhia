// Aplikasi Express: semua API, plus file statis saat berjalan di laptop/VPS.
// Di Vercel, file di folder public/ dilayani CDN dan aplikasi ini menjadi satu Vercel Function.
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const QRCode = require("qrcode");

const { init, query, one, many, tx, getSettings, saveSettings } = require("./db");
const auth = require("./auth");
const { randomCode, cleanText, normalizePhone, csv, rateLimit } = require("./util");
const { churchRankings, contestResults } = require("./stats");
const storage = require("./storage");

const PUBLIC_DIR = path.join(__dirname, "..", "public");

const app = express();
app.disable("x-powered-by");
if (process.env.VERCEL || process.env.TRUST_PROXY) app.set("trust proxy", true);

app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Referrer-Policy", "same-origin");
  res.set("X-Frame-Options", "DENY");
  res.set("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
  next();
});

// Batas Vercel untuk isi permintaan adalah 4,5 MB
const jsonSmall = express.json({ limit: "200kb" });
const jsonLarge = express.json({ limit: "4mb" });

const now = () => new Date().toISOString();
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const intId = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next); // tangkap error async

// Database siap + admin pertama dibuat sebelum API dipakai
app.use("/api", h(async (req, res, next) => { await init(); await auth.ensureInitialAdmin(); next(); }));

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
    "results_published", "music_url", "music_title", "spotify_url"];
  return Object.fromEntries(keys.map((k) => [k, s[k]]));
}

app.get("/api/public", h(async (req, res) => {
  const s = await getSettings();
  const [churches, lineup, sessions, photos, counts] = await Promise.all([
    many("SELECT id, name, city FROM churches ORDER BY lower(name)"),
    many("SELECT id, name, tier, note, photo_url FROM lineup ORDER BY CASE tier WHEN 'utama' THEN 0 WHEN 'pembicara' THEN 1 ELSE 2 END, sort, id"),
    many("SELECT id, title, kind, day, starts_at, ends_at, location, speaker FROM sessions ORDER BY day, starts_at, id"),
    many("SELECT id, url, caption, width, height FROM photos ORDER BY created_at DESC, id DESC LIMIT 60"),
    one(`SELECT COUNT(DISTINCT r.church_id)::int AS churches, COUNT(p.id)::int AS participants
         FROM registrations r LEFT JOIN participants p ON p.registration_id = r.id WHERE r.status = 'lunas'`),
  ]);
  let results = null;
  if (s.results_published) {
    const rk = await churchRankings();
    const strip = (r) => ({ church: r.church, city: r.city, present: r.present, confirmed: r.confirmed, seminar_per_person: r.seminar_per_person, seminar_rate: r.seminar_rate });
    results = {
      seminar_count: rk.seminar_count,
      most_participants: rk.most_participants.slice(0, 5).map(strip),
      most_active: rk.most_active.slice(0, 5).map(strip),
      contests: (await contestResults()).map((c) => ({ contest: c.contest, rank: c.rank, winner: c.winner, church: c.church })),
    };
  }
  res.set("Cache-Control", "no-cache");
  res.json({ settings: publicSettings(s), churches, lineup, sessions, photos, stats: counts, results });
}));

function parseParticipants(list, res) {
  const out = [];
  for (const [i, p] of (Array.isArray(list) ? list : []).entries()) {
    const name = cleanText(p.name, 80);
    const role = p.role === "gembala" ? "gembala" : p.role === "peserta" ? "peserta" : null;
    const gender = p.gender === "L" || p.gender === "P" ? p.gender : null;
    if (name.length < 2 || !role || !gender) {
      bad(res, `Data peserta nomor ${i + 1} belum lengkap (nama, status, jenis kelamin).`);
      return null;
    }
    out.push({ name, role, gender, age: null });
  }
  return out;
}

app.post("/api/registrations", rateLimit({ name: "daftar", windowMs: 10 * 60e3, max: 12 }), jsonSmall, h(async (req, res) => {
  const s = await getSettings();
  if (!s.registration_open) return bad(res, "Pendaftaran sedang ditutup. Hubungi panitia.");
  const b = req.body || {};
  const church = await one("SELECT id, name FROM churches WHERE id = $1", [intId(b.church_id)]);
  if (!church) return bad(res, "Pilih gereja asal dari daftar.");
  const coordinator = cleanText(b.coordinator, 80);
  if (coordinator.length < 2) return bad(res, "Isi nama koordinator.");
  const phone = normalizePhone(b.phone);
  if (!phone) return bad(res, "Nomor WhatsApp tidak valid. Gunakan format 08xxxxxxxxxx.");
  if (!Array.isArray(b.participants) || !b.participants.length) return bad(res, "Tambahkan minimal satu peserta.");
  if (b.participants.length > 150) return bad(res, "Maksimal 150 peserta per pendaftaran. Pecah menjadi beberapa pendaftaran.");
  const participants = parseParticipants(b.participants, res);
  if (!participants) return;
  const reg = await createRegistration({ church_id: church.id, coordinator, phone, consent: !!b.consent, participants, source: "online", status: "menunggu", fee: Number(s.fee_per_person) || 0, prefix: s.code_prefix });
  res.status(201).json({ code: reg.code, status_token: reg.status_token, status: reg.status, church: church.name, participants: participants.length });
}));

async function createRegistration({ church_id, coordinator, phone, consent, participants, source, status, fee, note = "", userId = null, prefix }) {
  const pre = cleanText(prefix, 8) || "RP";
  return tx(async (q) => {
    let code;
    do { code = `${pre}-${randomCode(5)}`; } while ((await q("SELECT 1 FROM registrations WHERE code = $1", [code])).rows.length);
    const statusToken = crypto.randomBytes(18).toString("base64url");
    const paid = status === "lunas";
    const reg = (await q(`INSERT INTO registrations (code, status_token, church_id, coordinator, phone, consent, fee_per_person, status, source, note, confirmed_at, confirmed_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
      [code, statusToken, church_id, coordinator, phone, consent ? 1 : 0, fee, status, source, note, paid ? now() : null, paid ? userId : null])).rows[0];
    for (const [i, p] of participants.entries()) await insertParticipant(q, reg.id, church_id, code, i + 1, p);
    return { id: reg.id, code, status_token: statusToken, status };
  });
}

async function newQrToken(q) {
  let t;
  do { t = "R" + randomCode(11); } while ((await q("SELECT 1 FROM participants WHERE qr_token = $1", [t])).rows.length);
  return t;
}

async function insertParticipant(q, registrationId, churchId, regCode, seq, p) {
  const code = `${regCode}-${String(seq).padStart(3, "0")}`;
  const r = await q(`INSERT INTO participants (registration_id, church_id, seq, code, qr_token, name, role, gender, age) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [registrationId, churchId, seq, code, await newQrToken(q), p.name, p.role, p.gender, p.age ?? null]);
  return r.rows[0].id;
}

async function registrationView(reg, { includeQr }) {
  const church = (await one("SELECT name, city FROM churches WHERE id = $1", [reg.church_id])) || { name: "", city: "" };
  const participants = (await many("SELECT id, code, qr_token, name, role, gender, age FROM participants WHERE registration_id = $1 ORDER BY seq", [reg.id]))
    .map((p) => {
      const out = { code: p.code, name: p.name, role: p.role, gender: p.gender };
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

app.get("/api/status/:token", h(async (req, res) => {
  const reg = await one("SELECT * FROM registrations WHERE status_token = $1", [String(req.params.token)]);
  if (!reg) return bad(res, "Pendaftaran tidak ditemukan. Periksa kembali tautan status kamu.", 404);
  res.set("Cache-Control", "no-store");
  res.json({ ...(await registrationView(reg, { includeQr: true })), payment_note: (await getSettings()).payment_note });
}));

app.post("/api/status/lookup", rateLimit({ name: "cek", windowMs: 10 * 60e3, max: 20 }), jsonSmall, h(async (req, res) => {
  const code = cleanText(req.body?.code, 20).toUpperCase();
  const phone = normalizePhone(req.body?.phone);
  const reg = phone && await one("SELECT status_token FROM registrations WHERE code = $1 AND phone = $2", [code, phone]);
  if (!reg) return bad(res, "Kode pendaftaran dan nomor WhatsApp tidak cocok.", 404);
  res.json({ status_token: reg.status_token });
}));

// Gambar QR. Hanya untuk peserta yang pendaftarannya sudah lunas.
app.get("/api/qr/:file", h(async (req, res) => {
  const token = String(req.params.file).replace(/\.svg$/, "");
  const row = await one(`SELECT p.qr_token FROM participants p JOIN registrations r ON r.id = p.registration_id
    WHERE p.qr_token = $1 AND r.status = 'lunas'`, [token]);
  if (!row) return res.status(404).end();
  const svg = await QRCode.toString(row.qr_token, { type: "svg", errorCorrectionLevel: "M", margin: 1, color: { dark: "#000000", light: "#ffffff" } });
  res.set("Content-Type", "image/svg+xml");
  res.set("Cache-Control", "private, max-age=86400");
  res.send(svg);
}));

// ---------------------------------------------------------------------------
// LOGIN
// ---------------------------------------------------------------------------
app.post("/api/auth/login", rateLimit({ name: "login", windowMs: 10 * 60e3, max: 15, message: "Terlalu banyak percobaan login. Tunggu 10 menit." }), jsonSmall, h(async (req, res) => {
  const username = cleanText(req.body?.username, 60);
  const password = String(req.body?.password || "");
  const mode = req.body?.mode === "scanner" ? "scanner" : "admin";
  if (auth.state.needsAdminPassword) return bad(res, "Admin belum dibuat. Isi ADMIN_PASSWORD di Vercel (Settings → Environment Variables), lalu Redeploy.", 503);
  const user = await one("SELECT * FROM users WHERE lower(username) = lower($1)", [username]);
  if (!user || !user.active || !auth.verifyPassword(password, user.pass_hash)) return bad(res, "Username atau password salah.", 401);
  if (mode === "admin" && user.role !== "admin") return bad(res, "Akun ini hanya untuk scanner. Buka aplikasi scanner di /scan.", 403);
  const { token, expires } = await auth.createToken(user, mode === "scanner" ? cleanText(req.body?.device, 60) || "scanner" : "admin-web");
  const pub = { id: user.id, username: user.username, name: user.name, role: user.role };
  if (mode === "scanner") return res.json({ token, expires, user: pub });
  const secure = req.secure || req.get("x-forwarded-proto") === "https";
  res.set("Set-Cookie", `${auth.COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${auth.ADMIN_DAYS * 86400}${secure ? "; Secure" : ""}`);
  res.json({ user: pub });
}));

app.post("/api/auth/logout", h(async (req, res) => {
  const u = await auth.userFromRequest(req);
  if (u) await query("DELETE FROM auth_tokens WHERE token = $1", [u.token]);
  res.set("Set-Cookie", `${auth.COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.json({ ok: true });
}));

app.get("/api/auth/me", h(async (req, res) => {
  const u = await auth.userFromRequest(req);
  if (!u) return bad(res, "Belum login.", 401);
  res.json({ user: { id: u.id, username: u.username, name: u.name, role: u.role } });
}));

// ---------------------------------------------------------------------------
// ADMIN
// ---------------------------------------------------------------------------
const admin = express.Router();
admin.use(auth.requireRole("admin"));
const A = {
  get: (p, ...fns) => admin.get(p, ...fns.slice(0, -1), h(fns.at(-1))),
  post: (p, ...fns) => admin.post(p, ...fns.slice(0, -1), h(fns.at(-1))),
  put: (p, ...fns) => admin.put(p, ...fns.slice(0, -1), h(fns.at(-1))),
  patch: (p, ...fns) => admin.patch(p, ...fns.slice(0, -1), h(fns.at(-1))),
  del: (p, ...fns) => admin.delete(p, ...fns.slice(0, -1), h(fns.at(-1))),
};

A.get("/summary", async (req, res) => {
  const [reg, ppl, money, churches, att, recent] = await Promise.all([
    one(`SELECT COUNT(*) FILTER (WHERE status='menunggu')::int AS waiting, COUNT(*) FILTER (WHERE status='lunas')::int AS paid,
           COUNT(*) FILTER (WHERE status='batal')::int AS cancelled FROM registrations`),
    one(`SELECT COUNT(*) FILTER (WHERE r.status='menunggu')::int AS waiting, COUNT(*) FILTER (WHERE r.status='lunas')::int AS paid,
           COUNT(*) FILTER (WHERE r.status='lunas' AND p.role='gembala')::int AS pastors,
           COUNT(*) FILTER (WHERE r.status='lunas' AND p.gender='L')::int AS male, COUNT(*) FILTER (WHERE r.status='lunas' AND p.gender='P')::int AS female
         FROM participants p JOIN registrations r ON r.id = p.registration_id`),
    one(`SELECT COALESCE(SUM(CASE WHEN r.status='lunas' THEN r.fee_per_person ELSE 0 END),0)::float8 AS received,
           COALESCE(SUM(CASE WHEN r.status='menunggu' THEN r.fee_per_person ELSE 0 END),0)::float8 AS outstanding
         FROM participants p JOIN registrations r ON r.id = p.registration_id`),
    one("SELECT COUNT(*)::int AS total, (SELECT COUNT(DISTINCT church_id)::int FROM registrations WHERE status='lunas') AS paid FROM churches"),
    one("SELECT COUNT(*)::int AS scans, COUNT(DISTINCT participant_id)::int AS people, MAX(received_at) AS last FROM attendance"),
    many(`SELECT r.id, r.code, r.status, r.created_at, c.name AS church, (SELECT COUNT(*)::int FROM participants WHERE registration_id = r.id) AS n
          FROM registrations r JOIN churches c ON c.id = r.church_id ORDER BY r.created_at DESC LIMIT 8`),
  ]);
  res.json({ registrations: reg, participants: ppl, money, churches, attendance: att, recent });
});

A.get("/settings", async (req, res) => res.json(await getSettings()));
A.put("/settings", jsonSmall, async (req, res) => {
  const b = req.body || {};
  const patch = {};
  const text = ["event_name", "title_line1", "title_line2", "tagline", "dates_label", "location", "payment_note", "contact", "music_url", "music_title", "spotify_url", "code_prefix"];
  for (const k of text) if (k in b) patch[k] = cleanText(b[k], k === "payment_note" ? 400 : 200);
  for (const k of ["start_at", "end_at"]) if (k in b) {
    if (Number.isNaN(new Date(b[k]).getTime())) return bad(res, "Format tanggal tidak valid.");
    patch[k] = String(b[k]);
  }
  for (const k of ["est_churches", "est_participants", "fee_per_person", "min_participants_for_activity"]) if (k in b) {
    const n = Number(b[k]);
    if (!Number.isFinite(n) || n < 0) return bad(res, "Angka tidak valid.");
    patch[k] = Math.round(n);
  }
  for (const k of ["registration_open", "results_published"]) if (k in b) patch[k] = !!b[k];
  if (patch.code_prefix !== undefined) patch.code_prefix = patch.code_prefix.toUpperCase().replace(/[^A-Z0-9]/g, "") || "RP";
  res.json(await saveSettings(patch));
});

// --- Gereja ---
A.get("/churches", async (req, res) => {
  res.json(await many(`SELECT c.*,
      (SELECT COUNT(*)::int FROM registrations r WHERE r.church_id = c.id AND r.status != 'batal') AS registrations,
      (SELECT COUNT(*)::int FROM participants p JOIN registrations r ON r.id = p.registration_id WHERE p.church_id = c.id AND r.status = 'lunas') AS paid_participants
    FROM churches c ORDER BY lower(c.name)`));
});
A.post("/churches", jsonSmall, async (req, res) => {
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
  const added = await tx(async (q) => {
    let n = 0;
    for (const it of items) n += (await q("INSERT INTO churches (name, city) VALUES ($1, $2) ON CONFLICT (lower(name)) DO NOTHING", [it.name, it.city])).rowCount;
    return n;
  });
  res.status(201).json({ added, skipped: items.length - added });
});
A.put("/churches/:id", jsonSmall, async (req, res) => {
  const name = cleanText(req.body?.name, 120);
  if (!name) return bad(res, "Nama gereja tidak boleh kosong.");
  try {
    const r = await query("UPDATE churches SET name = $1, city = $2 WHERE id = $3", [name, cleanText(req.body?.city, 80), intId(req.params.id)]);
    if (!r.rowCount) return bad(res, "Gereja tidak ditemukan.", 404);
  } catch (e) { if (e.code === "23505") return bad(res, "Nama gereja sudah ada."); throw e; }
  res.json({ ok: true });
});
A.del("/churches/:id", async (req, res) => {
  const id = intId(req.params.id);
  const used = (await one("SELECT COUNT(*)::int AS n FROM registrations WHERE church_id = $1", [id])).n;
  if (used) return bad(res, "Gereja ini sudah punya pendaftaran, jadi tidak bisa dihapus. Ubah namanya saja bila salah ketik.");
  await query("DELETE FROM churches WHERE id = $1", [id]);
  res.json({ ok: true });
});

// --- Lineup (pembicara & bintang tamu) ---
const LINEUP_ORDER = "ORDER BY CASE tier WHEN 'utama' THEN 0 WHEN 'pembicara' THEN 1 ELSE 2 END, sort, id";
A.get("/lineup", async (req, res) => res.json(await many(`SELECT * FROM lineup ${LINEUP_ORDER}`)));
function lineupBody(b) {
  const name = cleanText(b?.name, 80);
  const tier = ["utama", "pembicara", "tamu"].includes(b?.tier) ? b.tier : null;
  if (!name || !tier) return null;
  return [name, tier, cleanText(b?.note, 120), Math.round(Number(b?.sort) || 0)];
}
A.post("/lineup", jsonSmall, async (req, res) => {
  const v = lineupBody(req.body); if (!v) return bad(res, "Isi nama dan pilih peran.");
  const r = await one("INSERT INTO lineup (name, tier, note, sort) VALUES ($1, $2, $3, $4) RETURNING id", v);
  res.status(201).json({ ok: true, id: r.id });
});
A.put("/lineup/:id", jsonSmall, async (req, res) => {
  const v = lineupBody(req.body); if (!v) return bad(res, "Isi nama dan pilih peran.");
  await query("UPDATE lineup SET name=$1, tier=$2, note=$3, sort=$4 WHERE id=$5", [...v, intId(req.params.id)]);
  res.json({ ok: true });
});
A.del("/lineup/:id", async (req, res) => {
  const l = await one("SELECT photo_url FROM lineup WHERE id = $1", [intId(req.params.id)]);
  await query("DELETE FROM lineup WHERE id = $1", [intId(req.params.id)]);
  if (l) await storage.removeFile(l.photo_url);
  res.json({ ok: true });
});
// Foto pembicara / bintang tamu
A.post("/lineup/:id/photo", jsonLarge, async (req, res) => {
  const l = await one("SELECT id, photo_url FROM lineup WHERE id = $1", [intId(req.params.id)]);
  if (!l) return bad(res, "Lineup tidak ditemukan.", 404);
  const img = parseImage(req.body?.data);
  if (img.error) return bad(res, img.error);
  const url = await storage.saveFile(img.buf, "lineup", `lineup-${l.id}-${Date.now()}.${img.ext}`, img.type);
  await query("UPDATE lineup SET photo_url = $1 WHERE id = $2", [url, l.id]);
  await storage.removeFile(l.photo_url);
  res.status(201).json({ photo_url: url });
});
A.del("/lineup/:id/photo", async (req, res) => {
  const l = await one("SELECT id, photo_url FROM lineup WHERE id = $1", [intId(req.params.id)]);
  if (l) { await query("UPDATE lineup SET photo_url = '' WHERE id = $1", [l.id]); await storage.removeFile(l.photo_url); }
  res.json({ ok: true });
});

// --- Lagu latar landing page ---
// Dikirim sebagai file mentah (bukan JSON) supaya muat di batas 4,5 MB Vercel. Dashboard mengecilkan lagu yang lebih besar.
A.post("/music", express.raw({ type: () => true, limit: "4400kb" }), async (req, res) => {
  const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const isMp3 = buf.length > 1024 && (buf.subarray(0, 3).toString() === "ID3" || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0));
  if (!isMp3) return bad(res, "File lagu harus berformat MP3.");
  const before = await getSettings();
  const url = await storage.saveFile(buf, "musik", `lagu-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.mp3`, "audio/mpeg");
  const s = await saveSettings({ music_url: url, music_title: cleanText(req.query.title, 120) });
  if (before.music_url && before.music_url !== url) await storage.removeFile(before.music_url);
  res.status(201).json(s);
});
A.del("/music", async (req, res) => {
  const before = await getSettings();
  const s = await saveSettings({ music_url: "", music_title: "" });
  await storage.removeFile(before.music_url);
  res.json(s);
});

// --- Pendaftaran ---
A.get("/registrations", async (req, res) => {
  const where = []; const args = [];
  if (["menunggu", "lunas", "batal"].includes(req.query.status)) { args.push(req.query.status); where.push(`r.status = $${args.length}`); }
  if (req.query.q) { args.push(`%${cleanText(req.query.q, 60)}%`); const i = args.length; where.push(`(r.code ILIKE $${i} OR r.coordinator ILIKE $${i} OR r.phone ILIKE $${i} OR c.name ILIKE $${i})`); }
  res.json(await many(`SELECT r.id, r.code, r.status, r.coordinator, r.phone, r.fee_per_person, r.source, r.note, r.created_at, r.confirmed_at,
      c.name AS church, c.city, u.name AS confirmed_by_name,
      (SELECT COUNT(*)::int FROM participants p WHERE p.registration_id = r.id) AS n,
      (SELECT COUNT(*)::int FROM participants p WHERE p.registration_id = r.id AND p.role='gembala') AS pastors
    FROM registrations r JOIN churches c ON c.id = r.church_id LEFT JOIN users u ON u.id = r.confirmed_by
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY CASE r.status WHEN 'menunggu' THEN 0 WHEN 'lunas' THEN 1 ELSE 2 END, r.created_at DESC`, args));
});
A.get("/registrations/:id", async (req, res) => {
  const reg = await one("SELECT * FROM registrations WHERE id = $1", [intId(req.params.id)]);
  if (!reg) return bad(res, "Pendaftaran tidak ditemukan.", 404);
  const church = await one("SELECT id, name, city FROM churches WHERE id = $1", [reg.church_id]);
  const participants = await many(`SELECT p.*, (SELECT COUNT(*)::int FROM attendance a WHERE a.participant_id = p.id) AS scans FROM participants p WHERE registration_id = $1 ORDER BY seq`, [reg.id]);
  res.json({ ...reg, church, participants, status_url: `/status.html?t=${reg.status_token}` });
});
A.post("/registrations", jsonSmall, async (req, res) => {
  const b = req.body || {};
  const church = await one("SELECT id FROM churches WHERE id = $1", [intId(b.church_id)]);
  if (!church) return bad(res, "Pilih gereja.");
  const coordinator = cleanText(b.coordinator, 80) || "Didaftarkan admin";
  const phone = b.phone ? normalizePhone(b.phone) : "-";
  if (!phone) return bad(res, "Nomor WhatsApp tidak valid.");
  const participants = parseParticipants(b.participants, res);
  if (!participants) return;
  if (!participants.length) return bad(res, "Tambahkan minimal satu peserta.");
  const s = await getSettings();
  const status = b.status === "lunas" ? "lunas" : "menunggu";
  const fee = Number.isFinite(Number(b.fee_per_person)) ? Math.max(0, Math.round(Number(b.fee_per_person))) : Number(s.fee_per_person) || 0;
  const reg = await createRegistration({ church_id: church.id, coordinator, phone, consent: true, participants, source: "admin", status, fee, note: cleanText(b.note, 300), userId: req.user.id, prefix: s.code_prefix });
  res.status(201).json(reg);
});
A.put("/registrations/:id", jsonSmall, async (req, res) => {
  const b = req.body || {};
  const reg = await one("SELECT * FROM registrations WHERE id = $1", [intId(req.params.id)]);
  if (!reg) return bad(res, "Pendaftaran tidak ditemukan.", 404);
  const phone = b.phone !== undefined ? (normalizePhone(b.phone) || (b.phone === "-" ? "-" : null)) : reg.phone;
  if (!phone) return bad(res, "Nomor WhatsApp tidak valid.");
  const fee = b.fee_per_person !== undefined ? Math.max(0, Math.round(Number(b.fee_per_person) || 0)) : reg.fee_per_person;
  await query("UPDATE registrations SET coordinator = $1, phone = $2, note = $3, fee_per_person = $4 WHERE id = $5",
    [cleanText(b.coordinator ?? reg.coordinator, 80), phone, cleanText(b.note ?? reg.note, 300), fee, reg.id]);
  res.json({ ok: true });
});
A.patch("/registrations/:id/status", jsonSmall, async (req, res) => {
  const status = req.body?.status;
  if (!["menunggu", "lunas", "batal"].includes(status)) return bad(res, "Status tidak dikenal.");
  const paid = status === "lunas";
  const r = await query("UPDATE registrations SET status = $1, confirmed_at = $2, confirmed_by = $3 WHERE id = $4",
    [status, paid ? now() : null, paid ? req.user.id : null, intId(req.params.id)]);
  if (!r.rowCount) return bad(res, "Pendaftaran tidak ditemukan.", 404);
  res.json({ ok: true });
});
A.del("/registrations/:id", async (req, res) => {
  const id = intId(req.params.id);
  const scans = (await one("SELECT COUNT(*)::int AS n FROM attendance a JOIN participants p ON p.id = a.participant_id WHERE p.registration_id = $1", [id])).n;
  if (scans) return bad(res, "Peserta di pendaftaran ini sudah punya data kehadiran. Ubah statusnya menjadi Batal saja.");
  await query("DELETE FROM registrations WHERE id = $1", [id]);
  res.json({ ok: true });
});

// --- Peserta ---
function participantBody(b) {
  const name = cleanText(b?.name, 80);
  if (name.length < 2 || !["gembala", "peserta"].includes(b?.role) || !["L", "P"].includes(b?.gender)) return null;
  return { name, role: b.role, gender: b.gender };
}
A.get("/participants", async (req, res) => {
  const where = ["TRUE"]; const args = [];
  if (["menunggu", "lunas", "batal"].includes(req.query.status)) { args.push(req.query.status); where.push(`r.status = $${args.length}`); }
  if (intId(req.query.church_id)) { args.push(intId(req.query.church_id)); where.push(`p.church_id = $${args.length}`); }
  if (req.query.q) { args.push(`%${cleanText(req.query.q, 60)}%`); where.push(`(p.name ILIKE $${args.length} OR p.code ILIKE $${args.length})`); }
  res.json(await many(`SELECT p.id, p.code, p.qr_token, p.name, p.role, p.gender, p.age, r.id AS registration_id, r.code AS registration_code, r.status,
      c.id AS church_id, c.name AS church, (SELECT COUNT(*)::int FROM attendance a WHERE a.participant_id = p.id) AS scans
    FROM participants p JOIN registrations r ON r.id = p.registration_id JOIN churches c ON c.id = p.church_id
    WHERE ${where.join(" AND ")} ORDER BY lower(c.name), lower(p.name) LIMIT 3000`, args));
});
A.post("/registrations/:id/participants", jsonSmall, async (req, res) => {
  const reg = await one("SELECT * FROM registrations WHERE id = $1", [intId(req.params.id)]);
  if (!reg) return bad(res, "Pendaftaran tidak ditemukan.", 404);
  const v = participantBody(req.body); if (!v) return bad(res, "Lengkapi nama, status, dan jenis kelamin.");
  await tx(async (q) => {
    await q("SELECT id FROM registrations WHERE id = $1 FOR UPDATE", [reg.id]); // satu per satu per pendaftaran
    const seq = ((await q("SELECT MAX(seq) AS m FROM participants WHERE registration_id = $1", [reg.id])).rows[0].m || 0) + 1;
    await insertParticipant(q, reg.id, reg.church_id, reg.code, seq, v);
  });
  res.status(201).json({ ok: true });
});
A.put("/participants/:id", jsonSmall, async (req, res) => {
  const v = participantBody(req.body); if (!v) return bad(res, "Lengkapi nama, status, dan jenis kelamin.");
  const r = await query("UPDATE participants SET name=$1, role=$2, gender=$3 WHERE id=$4", [v.name, v.role, v.gender, intId(req.params.id)]);
  if (!r.rowCount) return bad(res, "Peserta tidak ditemukan.", 404);
  res.json({ ok: true });
});
A.del("/participants/:id", async (req, res) => {
  const id = intId(req.params.id);
  if ((await one("SELECT COUNT(*)::int AS n FROM attendance WHERE participant_id = $1", [id])).n) return bad(res, "Peserta ini sudah punya data kehadiran, jadi tidak bisa dihapus.");
  await query("DELETE FROM participants WHERE id = $1", [id]);
  res.json({ ok: true });
});
// Terbitkan QR baru (misalnya ID card hilang dan dikhawatirkan dipakai orang lain)
A.post("/participants/:id/reissue", async (req, res) => {
  const r = await tx(async (q) => q("UPDATE participants SET qr_token = $1 WHERE id = $2", [await newQrToken(q), intId(req.params.id)]));
  if (!r.rowCount) return bad(res, "Peserta tidak ditemukan.", 404);
  res.json({ ok: true });
});

A.get("/print", async (req, res) => {
  const where = ["r.status = 'lunas'"]; const args = [];
  if (intId(req.query.church_id)) { args.push(intId(req.query.church_id)); where.push(`p.church_id = $${args.length}`); }
  if (intId(req.query.registration_id)) { args.push(intId(req.query.registration_id)); where.push(`p.registration_id = $${args.length}`); }
  if (req.query.ids) {
    const ids = String(req.query.ids).split(",").map(intId).filter(Boolean).slice(0, 500);
    if (ids.length) { args.push(ids); where.push(`p.id = ANY($${args.length}::int[])`); }
  }
  const s = await getSettings();
  res.json({
    event_name: s.event_name, dates_label: s.dates_label,
    participants: await many(`SELECT p.code, p.qr_token, p.name, p.role, c.name AS church, c.city
      FROM participants p JOIN registrations r ON r.id = p.registration_id JOIN churches c ON c.id = p.church_id
      WHERE ${where.join(" AND ")} ORDER BY lower(c.name), p.role, lower(p.name)`, args),
  });
});

// --- Jadwal sesi ---
function sessionBody(b) {
  const title = cleanText(b?.title, 120);
  const kind = ["checkin", "seminar"].includes(b?.kind) ? b.kind : null;
  const day = Number(b?.day);
  const t = (v) => /^\d{2}:\d{2}$/.test(String(v || "")) ? String(v) : "";
  if (!title || !kind || !Number.isInteger(day) || day < 1 || day > 14) return null;
  return [title, kind, day, t(b.starts_at), t(b.ends_at), cleanText(b?.location, 80), cleanText(b?.speaker, 80)];
}
A.get("/sessions", async (req, res) => {
  res.json(await many(`SELECT s.*, (SELECT COUNT(*)::int FROM attendance a WHERE a.session_id = s.id) AS scans FROM sessions s ORDER BY day, starts_at, id`));
});
A.post("/sessions", jsonSmall, async (req, res) => {
  const v = sessionBody(req.body); if (!v) return bad(res, "Isi judul, jenis, dan hari ke-berapa.");
  await query("INSERT INTO sessions (title, kind, day, starts_at, ends_at, location, speaker) VALUES ($1, $2, $3, $4, $5, $6, $7)", v);
  res.status(201).json({ ok: true });
});
A.put("/sessions/:id", jsonSmall, async (req, res) => {
  const v = sessionBody(req.body); if (!v) return bad(res, "Isi judul, jenis, dan hari ke-berapa.");
  await query("UPDATE sessions SET title=$1, kind=$2, day=$3, starts_at=$4, ends_at=$5, location=$6, speaker=$7 WHERE id=$8", [...v, intId(req.params.id)]);
  res.json({ ok: true });
});
A.del("/sessions/:id", async (req, res) => {
  const id = intId(req.params.id);
  const n = (await one("SELECT COUNT(*)::int AS n FROM attendance WHERE session_id = $1", [id])).n;
  if (n && req.query.force !== "1") return bad(res, `Sesi ini sudah punya ${n} data scan. Hapus tetap? Kirim ulang dengan konfirmasi.`, 409);
  await query("DELETE FROM sessions WHERE id = $1", [id]);
  res.json({ ok: true });
});

// --- Kehadiran ---
A.get("/attendance", async (req, res) => {
  const where = ["TRUE"]; const args = [];
  if (intId(req.query.session_id)) { args.push(intId(req.query.session_id)); where.push(`a.session_id = $${args.length}`); }
  if (intId(req.query.church_id)) { args.push(intId(req.query.church_id)); where.push(`p.church_id = $${args.length}`); }
  res.json(await many(`SELECT a.id, a.scanned_at, a.received_at, a.method, a.device_id, p.code, p.name, p.role, c.name AS church, s.title AS session, s.kind, u.name AS scanner
    FROM attendance a JOIN participants p ON p.id = a.participant_id JOIN churches c ON c.id = p.church_id
    JOIN sessions s ON s.id = a.session_id LEFT JOIN users u ON u.id = a.user_id
    WHERE ${where.join(" AND ")} ORDER BY a.scanned_at DESC LIMIT 2000`, args));
});
A.post("/attendance", jsonSmall, async (req, res) => {
  const pid = intId(req.body?.participant_id), sid = intId(req.body?.session_id);
  if (!(await one("SELECT 1 AS x FROM participants WHERE id = $1", [pid])) || !(await one("SELECT 1 AS x FROM sessions WHERE id = $1", [sid]))) return bad(res, "Peserta atau sesi tidak ditemukan.");
  const r = await query(`INSERT INTO attendance (participant_id, session_id, scanned_at, method, device_id, user_id) VALUES ($1, $2, $3, 'admin', 'admin-web', $4)
    ON CONFLICT (participant_id, session_id) DO NOTHING`, [pid, sid, now(), req.user.id]);
  res.status(r.rowCount ? 201 : 200).json({ added: r.rowCount });
});
A.del("/attendance/:id", async (req, res) => { await query("DELETE FROM attendance WHERE id = $1", [intId(req.params.id)]); res.json({ ok: true }); });

// --- Hasil & lomba ---
A.get("/rankings", async (req, res) => res.json(await churchRankings()));
A.get("/contests", async (req, res) => res.json(await contestResults()));
async function contestBody(b) {
  const contest = cleanText(b?.contest, 80), winner = cleanText(b?.winner, 120), rank = Number(b?.rank);
  if (!contest || !winner || !Number.isInteger(rank) || rank < 1 || rank > 20) return null;
  const church = intId(b?.church_id);
  const exists = church && await one("SELECT 1 AS x FROM churches WHERE id = $1", [church]);
  return [contest, rank, winner, exists ? church : null];
}
A.post("/contests", jsonSmall, async (req, res) => {
  const v = await contestBody(req.body); if (!v) return bad(res, "Isi nama lomba, peringkat, dan pemenang.");
  await query("INSERT INTO contest_results (contest, rank, winner, church_id) VALUES ($1, $2, $3, $4)", v);
  res.status(201).json({ ok: true });
});
A.put("/contests/:id", jsonSmall, async (req, res) => {
  const v = await contestBody(req.body); if (!v) return bad(res, "Isi nama lomba, peringkat, dan pemenang.");
  await query("UPDATE contest_results SET contest=$1, rank=$2, winner=$3, church_id=$4 WHERE id=$5", [...v, intId(req.params.id)]);
  res.json({ ok: true });
});
A.del("/contests/:id", async (req, res) => { await query("DELETE FROM contest_results WHERE id = $1", [intId(req.params.id)]); res.json({ ok: true }); });

// --- Galeri ---
// Foto dikirim sebagai data URL; isi file diperiksa supaya benar-benar gambar.
function parseImage(data) {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(data || ""));
  if (!m) return { error: "Format foto harus JPG, PNG, atau WebP." };
  const buf = Buffer.from(m[2], "base64");
  const sig = buf.subarray(0, 12).toString("hex");
  const okSig = (m[1] === "jpeg" && sig.startsWith("ffd8ff")) || (m[1] === "png" && sig.startsWith("89504e47")) || (m[1] === "webp" && buf.subarray(8, 12).toString() === "WEBP");
  if (!okSig) return { error: "File foto rusak." };
  return { buf, ext: m[1] === "jpeg" ? "jpg" : m[1], type: `image/${m[1]}` };
}
A.get("/photos", async (req, res) => res.json(await many("SELECT * FROM photos ORDER BY created_at DESC, id DESC")));
A.post("/photos", jsonLarge, async (req, res) => {
  const img = parseImage(req.body?.data);
  if (img.error) return bad(res, img.error);
  const filename = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${img.ext}`;
  const url = await storage.savePhoto(img.buf, filename, img.type);
  await query("INSERT INTO photos (filename, url, caption, width, height) VALUES ($1, $2, $3, $4, $5)", [filename, url, cleanText(req.body?.caption, 200), intId(req.body?.width), intId(req.body?.height)]);
  res.status(201).json({ ok: true });
});
A.put("/photos/:id", jsonSmall, async (req, res) => { await query("UPDATE photos SET caption = $1 WHERE id = $2", [cleanText(req.body?.caption, 200), intId(req.params.id)]); res.json({ ok: true }); });
A.del("/photos/:id", async (req, res) => {
  const p = await one("SELECT * FROM photos WHERE id = $1", [intId(req.params.id)]);
  if (p) { await storage.removePhoto(p); await query("DELETE FROM photos WHERE id = $1", [p.id]); }
  res.json({ ok: true });
});

// --- Akun ---
A.get("/users", async (req, res) => {
  res.json(await many(`SELECT u.id, u.username, u.name, u.role, u.active, u.created_at,
      (SELECT COUNT(*)::int FROM auth_tokens t WHERE t.user_id = u.id AND t.expires_at > $1) AS sessions,
      (SELECT COUNT(*)::int FROM attendance a WHERE a.user_id = u.id) AS scans
    FROM users u ORDER BY u.role, lower(u.username)`, [now()]));
});
A.post("/users", jsonSmall, async (req, res) => {
  const username = cleanText(req.body?.username, 40).toLowerCase();
  const name = cleanText(req.body?.name, 60);
  const role = req.body?.role === "admin" ? "admin" : "scanner";
  const password = String(req.body?.password || "");
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) return bad(res, "Username 3–40 karakter: huruf kecil, angka, titik, strip.");
  if (password.length < 8) return bad(res, "Password minimal 8 karakter.");
  try {
    await query("INSERT INTO users (username, name, role, pass_hash) VALUES ($1, $2, $3, $4)", [username, name || username, role, auth.hashPassword(password)]);
  } catch (e) { if (e.code === "23505") return bad(res, "Username sudah dipakai."); throw e; }
  res.status(201).json({ ok: true });
});
A.put("/users/:id", jsonSmall, async (req, res) => {
  const id = intId(req.params.id);
  const u = await one("SELECT * FROM users WHERE id = $1", [id]);
  if (!u) return bad(res, "Akun tidak ditemukan.", 404);
  const role = req.body?.role === "admin" ? "admin" : req.body?.role === "scanner" ? "scanner" : u.role;
  const active = req.body?.active === undefined ? u.active : (req.body.active ? 1 : 0);
  if (u.id === req.user.id && (role !== "admin" || !active)) return bad(res, "Kamu tidak bisa menonaktifkan atau menurunkan akunmu sendiri.");
  const pw = req.body?.password ? String(req.body.password) : null;
  if (pw && pw.length < 8) return bad(res, "Password minimal 8 karakter.");
  await query("UPDATE users SET name = $1, role = $2, active = $3, pass_hash = $4 WHERE id = $5",
    [cleanText(req.body?.name ?? u.name, 60) || u.username, role, active, pw ? auth.hashPassword(pw) : u.pass_hash, id]);
  if (!active || pw) await query("DELETE FROM auth_tokens WHERE user_id = $1 AND token != $2", [id, req.user.token]);
  res.json({ ok: true });
});

// --- Export CSV ---
function sendCsv(res, name, rows, headers) {
  res.set("Content-Type", "text/csv; charset=utf-8");
  res.set("Content-Disposition", `attachment; filename="${name}"`);
  res.send(csv(rows, headers));
}
A.get("/export/participants.csv", async (req, res) => {
  const rows = await many(`SELECT p.code AS kode_peserta, p.name AS nama, CASE p.role WHEN 'gembala' THEN 'Gembala sidang' ELSE 'Peserta' END AS status_peserta,
      CASE p.gender WHEN 'P' THEN 'Perempuan' ELSE 'Laki-laki' END AS jenis_kelamin, c.name AS gereja, c.city AS kota, r.code AS kode_pendaftaran, r.status AS status_bayar, r.coordinator AS koordinator, r.phone AS wa_koordinator,
      (SELECT COUNT(*)::int FROM attendance a WHERE a.participant_id = p.id) AS jumlah_scan
    FROM participants p JOIN registrations r ON r.id = p.registration_id JOIN churches c ON c.id = p.church_id ORDER BY lower(c.name), lower(p.name)`);
  sendCsv(res, "peserta.csv", rows, ["kode_peserta", "nama", "status_peserta", "jenis_kelamin", "gereja", "kota", "kode_pendaftaran", "status_bayar", "koordinator", "wa_koordinator", "jumlah_scan"]);
});
A.get("/export/attendance.csv", async (req, res) => {
  const rows = await many(`SELECT s.day AS hari, s.title AS sesi, s.kind AS jenis, p.code AS kode_peserta, p.name AS nama, c.name AS gereja, a.scanned_at AS waktu_scan, a.method AS metode, u.name AS petugas, a.device_id AS perangkat
    FROM attendance a JOIN participants p ON p.id = a.participant_id JOIN churches c ON c.id = p.church_id JOIN sessions s ON s.id = a.session_id LEFT JOIN users u ON u.id = a.user_id
    ORDER BY s.day, s.starts_at, a.scanned_at`);
  sendCsv(res, "kehadiran.csv", rows, ["hari", "sesi", "jenis", "kode_peserta", "nama", "gereja", "waktu_scan", "metode", "petugas", "perangkat"]);
});
A.get("/export/rankings.csv", async (req, res) => {
  const rows = (await churchRankings()).all.map((r) => ({ gereja: r.church, kota: r.city, peserta_lunas: r.confirmed, peserta_hadir: r.present, scan_seminar: r.seminar_scans, seminar_per_peserta: r.seminar_per_person, persen_kehadiran_seminar: r.seminar_rate, ikut_nominasi_aktif: r.eligible_activity ? "ya" : "tidak" }));
  sendCsv(res, "nominasi-gereja.csv", rows, ["gereja", "kota", "peserta_lunas", "peserta_hadir", "scan_seminar", "seminar_per_peserta", "persen_kehadiran_seminar", "ikut_nominasi_aktif"]);
});

app.use("/api/admin", admin);

// ---------------------------------------------------------------------------
// SCANNER (admin juga boleh)
// ---------------------------------------------------------------------------
const scanner = express.Router();
scanner.use(auth.requireRole("scanner"));

scanner.get("/dataset", h(async (req, res) => {
  const [participants, churches, sessions, attendance, s] = await Promise.all([
    many(`SELECT p.id, p.code, p.qr_token AS qr, p.name, p.role, p.church_id
      FROM participants p JOIN registrations r ON r.id = p.registration_id WHERE r.status = 'lunas' ORDER BY lower(p.name)`),
    many("SELECT id, name, city FROM churches ORDER BY lower(name)"),
    many("SELECT id, title, kind, day, starts_at, ends_at, location FROM sessions ORDER BY day, starts_at, id"),
    many("SELECT participant_id AS p, session_id AS s, scanned_at AS t FROM attendance"),
    getSettings(),
  ]);
  res.set("Cache-Control", "no-store");
  res.json({ generated_at: now(), event_name: s.event_name, participants, churches, sessions, attendance });
}));

scanner.post("/sync", express.json({ limit: "2mb" }), h(async (req, res) => {
  const records = Array.isArray(req.body?.records) ? req.body.records.slice(0, 5000) : [];
  const device = cleanText(req.body?.device_id, 60);
  const accepted = [], duplicates = [], rejected = [];
  const valid = [];
  for (const r of records) {
    const lid = String(r?.local_id || "");
    const pid = intId(r?.participant_id), sid = intId(r?.session_id);
    const t = new Date(r?.scanned_at);
    if (!lid || !pid || !sid || Number.isNaN(t.getTime())) { rejected.push({ local_id: lid, reason: "Data tidak lengkap" }); continue; }
    valid.push({ lid, pid, sid, t: t.toISOString(), method: ["qr", "manual", "kode"].includes(r.method) ? r.method : "qr" });
  }
  if (valid.length) {
    const pids = [...new Set(valid.map((v) => v.pid))], sids = [...new Set(valid.map((v) => v.sid))];
    const [knownP, knownS] = await Promise.all([
      many("SELECT id FROM participants WHERE id = ANY($1::int[])", [pids]),
      many("SELECT id FROM sessions WHERE id = ANY($1::int[])", [sids]),
    ]);
    const okP = new Set(knownP.map((x) => x.id)), okS = new Set(knownS.map((x) => x.id));
    await tx(async (q) => {
      for (const v of valid) {
        if (!okP.has(v.pid)) { rejected.push({ local_id: v.lid, reason: "Peserta sudah dihapus dari sistem" }); continue; }
        if (!okS.has(v.sid)) { rejected.push({ local_id: v.lid, reason: "Sesi sudah dihapus dari sistem" }); continue; }
        const ins = await q(`INSERT INTO attendance (participant_id, session_id, scanned_at, method, device_id, user_id) VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (participant_id, session_id) DO NOTHING`, [v.pid, v.sid, v.t, v.method, device, req.user.id]);
        if (ins.rowCount) accepted.push(v.lid);
        else duplicates.push({ local_id: v.lid, scanned_at: (await q("SELECT scanned_at FROM attendance WHERE participant_id = $1 AND session_id = $2", [v.pid, v.sid])).rows[0]?.scanned_at });
      }
    });
  }
  res.json({ accepted, duplicates, rejected, server_time: now() });
}));

scanner.get("/attendance", h(async (req, res) => {
  const since = req.query.since ? new Date(String(req.query.since)) : null;
  // Mundur 5 menit: baris dari transaksi yang lama selesai atau jam server yang sedikit berbeda tetap ikut terambil.
  // Mengambil ulang baris yang sama aman karena HP menyimpannya per (peserta, sesi).
  const rows = since && !Number.isNaN(since.getTime())
    ? await many("SELECT participant_id AS p, session_id AS s, scanned_at AS t, received_at AS r FROM attendance WHERE received_at > $1", [new Date(since.getTime() - 5 * 60e3).toISOString()])
    : await many("SELECT participant_id AS p, session_id AS s, scanned_at AS t, received_at AS r FROM attendance");
  res.set("Cache-Control", "no-store");
  res.json({ rows, server_time: now() });
}));

app.use("/api/scanner", scanner);

app.use("/api", (req, res) => bad(res, "Alamat API tidak dikenal.", 404));

// ---------------------------------------------------------------------------
// FILE STATIS (hanya di laptop/VPS; di Vercel dilayani CDN dari folder public/)
// ---------------------------------------------------------------------------
app.use("/uploads", express.static(storage.UPLOAD_DIR, { maxAge: "7d", immutable: true, fallthrough: false }));
// Dashboard dan halaman cetak hanya untuk admin yang sudah login; selain itu diarahkan ke halaman login.
app.get(["/admin", "/admin/", "/admin/index.html", "/admin/print.html"], h(async (req, res, next) => {
  await init();
  const u = await auth.userFromRequest(req);
  if (u && u.role === "admin") return next();
  res.set("Cache-Control", "no-store");
  res.redirect(302, "/admin/login.html?next=" + encodeURIComponent(req.originalUrl === "/admin" ? "/admin/" : req.originalUrl));
}));
app.get("/scan/sw.js", (req, res, next) => { res.set("Cache-Control", "no-cache"); res.set("Service-Worker-Allowed", "/scan/"); next(); });
app.use(express.static(PUBLIC_DIR, {
  extensions: ["html"],
  setHeaders(res, file) {
    if (file.endsWith(".html") || file.endsWith(".webmanifest") || file.endsWith("sw.js")) res.set("Cache-Control", "no-cache");
    else res.set("Cache-Control", "public, max-age=300");
  },
}));
app.use((req, res) => res.status(404).sendFile(path.join(PUBLIC_DIR, "404.html"), (err) => { if (err && !res.headersSent) res.type("text").send("Halaman tidak ditemukan."); }));

// Kesalahan JSON / ukuran body / server
app.use((err, req, res, next) => {
  if (err?.type === "entity.too.large") return bad(res, "Data terlalu besar.", 413);
  if (err?.type === "entity.parse.failed") return bad(res, "Format data tidak valid.");
  if (err?.status === 400) return bad(res, err.message);
  if (err?.status === 404) return res.status(404).type("text").send("Tidak ditemukan.");
  console.error(err);
  bad(res, process.env.VERCEL && /DATABASE_URL/.test(err?.message || "") ? err.message : "Terjadi kesalahan di server.", 500);
});

module.exports = app;
