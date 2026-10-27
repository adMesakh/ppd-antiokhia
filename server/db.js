// Database Postgres.
// - Di Vercel (atau server mana pun) dengan DATABASE_URL: memakai Postgres sungguhan (misalnya Neon).
// - Tanpa DATABASE_URL (laptop, VPS, pengujian): memakai PGlite, Postgres yang berjalan di dalam Node dan menyimpan data di folder DATA_DIR.
// Semua tabel dibuat otomatis saat aplikasi pertama kali berjalan.
const path = require("path");
const fs = require("fs");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
// Nama variabel bisa berawalan bila "Custom Prefix" diisi saat menyambungkan Neon (misalnya STORAGE_DATABASE_URL)
const envFind = (re) => Object.keys(process.env).sort().find((k) => re.test(k) && process.env[k]);
const DB_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL
  || process.env[envFind(/^(?!.*UNPOOLED).*_DATABASE_URL$/)] || process.env[envFind(/^(?!.*(NON_POOLING|UNPOOLED|PRISMA)).*_POSTGRES_URL$/)] || "";
const USE_PG = !!DB_URL;

const NOW = `to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','scanner')),
  pass_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower ON users (lower(username));
CREATE TABLE IF NOT EXISTS auth_tokens (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  expires_at TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS churches (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE UNIQUE INDEX IF NOT EXISTS churches_name_lower ON churches (lower(name));
CREATE TABLE IF NOT EXISTS lineup (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('utama','pembicara','tamu')),
  note TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS registrations (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  status_token TEXT NOT NULL UNIQUE,
  church_id INTEGER NOT NULL REFERENCES churches(id),
  coordinator TEXT NOT NULL,
  phone TEXT NOT NULL,
  consent INTEGER NOT NULL DEFAULT 0,
  fee_per_person INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'menunggu' CHECK (status IN ('menunggu','lunas','batal')),
  source TEXT NOT NULL DEFAULT 'online',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT ${NOW},
  confirmed_at TEXT,
  confirmed_by INTEGER REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS participants (
  id SERIAL PRIMARY KEY,
  registration_id INTEGER NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  church_id INTEGER NOT NULL REFERENCES churches(id),
  seq INTEGER NOT NULL,
  code TEXT NOT NULL UNIQUE,
  qr_token TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('gembala','peserta')),
  gender TEXT NOT NULL CHECK (gender IN ('L','P')),
  age INTEGER,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS participants_reg ON participants (registration_id);
CREATE INDEX IF NOT EXISTS participants_church ON participants (church_id);
CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('checkin','seminar')),
  day INTEGER NOT NULL DEFAULT 1,
  starts_at TEXT NOT NULL DEFAULT '',
  ends_at TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  speaker TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE TABLE IF NOT EXISTS attendance (
  id SERIAL PRIMARY KEY,
  participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  scanned_at TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'qr',
  device_id TEXT NOT NULL DEFAULT '',
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  received_at TEXT NOT NULL DEFAULT ${NOW},
  UNIQUE (participant_id, session_id)
);
CREATE INDEX IF NOT EXISTS attendance_session ON attendance (session_id);
CREATE INDEX IF NOT EXISTS attendance_received ON attendance (received_at);
CREATE TABLE IF NOT EXISTS contest_results (
  id SERIAL PRIMARY KEY,
  contest TEXT NOT NULL,
  rank INTEGER NOT NULL,
  winner TEXT NOT NULL,
  church_id INTEGER REFERENCES churches(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE TABLE IF NOT EXISTS photos (
  id SERIAL PRIMARY KEY,
  filename TEXT NOT NULL,
  url TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  width INTEGER, height INTEGER,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
ALTER TABLE lineup ADD COLUMN IF NOT EXISTS photo_url TEXT NOT NULL DEFAULT '';
-- Usia tidak lagi diminta saat pendaftaran
ALTER TABLE participants ALTER COLUMN age DROP NOT NULL;
-- potongan file unggahan besar (lagu); dirakit lalu dihapus
CREATE TABLE IF NOT EXISTS upload_chunks (upload_id TEXT NOT NULL, idx INTEGER NOT NULL, data BYTEA NOT NULL, at BIGINT NOT NULL, PRIMARY KEY (upload_id, idx));
CREATE TABLE IF NOT EXISTS rate_hits (key TEXT NOT NULL, at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS rate_hits_key ON rate_hits (key, at);
`;

// ---------- koneksi ----------
let driver = null; // { query(text, params), exec(sql), tx(fn) }

let pgPool = null;
function makePg() {
  const { Pool } = require("pg");
  const pool = pgPool || (pgPool = new Pool({ connectionString: DB_URL, max: 3, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 10_000 }));
  if (process.env.VERCEL && !pool._ppdAttached) {
    // Vercel menutup koneksi menganggur dengan rapi sebelum fungsi ditidurkan
    try { require("@vercel/functions").attachDatabasePool(pool); } catch (_) {}
    pool._ppdAttached = true;
  }
  if (pool.listenerCount("error") === 0) pool.on("error", (e) => console.error("[db] koneksi menganggur error:", e.message));
  return {
    kind: "postgres",
    query: (text, params) => pool.query(text, params),
    exec: (sql) => pool.query(sql),
    // Beberapa salinan fungsi Vercel bisa menyala bersamaan; kunci supaya pembuatan tabel tidak bentrok.
    async setup(sql) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(7270627)");
        await client.query(sql);
        await client.query("COMMIT");
      } catch (e) {
        try { await client.query("ROLLBACK"); } catch (_) {}
        throw e;
      } finally { client.release(); }
    },
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const out = await fn((t, p) => client.query(t, p));
        await client.query("COMMIT");
        return out;
      } catch (e) {
        try { await client.query("ROLLBACK"); } catch (_) {}
        throw e;
      } finally { client.release(); }
    },
  };
}

async function makePglite() {
  if (process.env.VERCEL) throw new Error("DATABASE_URL belum diatur. Sambungkan database Neon dari tab Storage di Vercel.");
  const { PGlite } = await import("@electric-sql/pglite");
  const dir = process.env.PGLITE_MEMORY ? undefined : path.join(DATA_DIR, "pgdata");
  if (dir) fs.mkdirSync(dir, { recursive: true });
  const pg = dir ? new PGlite(dir) : new PGlite();
  await pg.waitReady;
  const norm = (r) => ({ rows: r.rows, rowCount: r.affectedRows ?? r.rows.length });
  return {
    kind: "pglite",
    pg,
    query: async (text, params) => norm(await pg.query(text, params)),
    exec: (sql) => pg.exec(sql),
    tx: (fn) => pg.transaction((t) => fn(async (text, params) => norm(await t.query(text, params)))),
  };
}

let ready = null;
function init() {
  if (!ready) {
    ready = (async () => {
      driver = USE_PG ? makePg() : await makePglite();
      await (driver.setup ? driver.setup(SCHEMA) : driver.exec(SCHEMA));
      return driver;
    })();
    ready.catch(() => { ready = null; }); // coba lagi di permintaan berikutnya
  }
  return ready;
}

async function query(text, params) { await init(); const r = await driver.query(text, params); return { rows: r.rows, rowCount: r.rowCount ?? r.rows.length }; }
const one = async (text, params) => (await query(text, params)).rows[0] || null;
const many = async (text, params) => (await query(text, params)).rows;
// fn menerima q(text, params) → {rows,rowCount} yang berjalan di dalam satu transaksi
async function tx(fn) {
  await init();
  return driver.tx(async (raw) => {
    const q = async (t, p) => { const r = await raw(t, p); return { rows: r.rows, rowCount: r.rowCount ?? r.rows.length }; };
    return fn(q);
  });
}

// ---------- pengaturan ----------
const DEFAULT_SETTINGS = {
  event_name: "PPD Antiokhia 2027",
  title_line1: "PPD Antiokhia",
  title_line2: "Satu tubuh, satu suara",
  tagline: "Retreat pemuda antar gereja · Kalimantan Barat",
  start_at: "2027-07-06T08:00:00+07:00",
  end_at: "2027-07-09T17:00:00+07:00",
  dates_label: "6–9 Juli 2027",
  location: "Kalimantan Barat",
  est_churches: 40,
  est_participants: 0,
  fee_per_person: 0,
  payment_note: "Bayar tunai ke bendahara panitia. Sebutkan kode pendaftaran saat membayar.",
  contact: "",
  registration_open: true,
  results_published: false,
  min_participants_for_activity: 5,
  music_url: "",
  music_title: "",
  gallery_drive_url: "",
  spotify_url: "https://open.spotify.com/search/NDC%20Worship",
  code_prefix: "PPD27",
};

async function getSettings() {
  const rows = await many("SELECT key, value FROM settings");
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) { try { out[r.key] = JSON.parse(r.value); } catch (_) { /* abaikan nilai rusak */ } }
  return out;
}

async function saveSettings(patch) {
  const entries = Object.entries(patch).filter(([k]) => k in DEFAULT_SETTINGS);
  if (entries.length) {
    await tx(async (q) => {
      for (const [k, v] of entries) await q("INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [k, JSON.stringify(v)]);
    });
  }
  return getSettings();
}

module.exports = { DATA_DIR, USE_PG, init, query, one, many, tx, getSettings, saveSettings, DEFAULT_SETTINGS, driver: () => driver };
