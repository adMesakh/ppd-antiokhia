// Database: satu file SQLite. Semua tabel dibuat otomatis saat server pertama kali jalan.
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
fs.mkdirSync(path.join(DATA_DIR, "uploads"), { recursive: true });

const db = new Database(path.join(DATA_DIR, "retreat.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','scanner')),
  pass_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS auth_tokens (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL,
  label TEXT
);
CREATE TABLE IF NOT EXISTS churches (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  city TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS lineup (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('utama','pembicara','tamu')),
  note TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS registrations (
  id INTEGER PRIMARY KEY,
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
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  confirmed_at TEXT,
  confirmed_by INTEGER REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS participants (
  id INTEGER PRIMARY KEY,
  registration_id INTEGER NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  church_id INTEGER NOT NULL REFERENCES churches(id),
  seq INTEGER NOT NULL,
  code TEXT NOT NULL UNIQUE,
  qr_token TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('gembala','peserta')),
  gender TEXT NOT NULL CHECK (gender IN ('L','P')),
  age INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_participants_reg ON participants(registration_id);
CREATE INDEX IF NOT EXISTS idx_participants_church ON participants(church_id);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('checkin','seminar')),
  day INTEGER NOT NULL DEFAULT 1,
  starts_at TEXT NOT NULL DEFAULT '',
  ends_at TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  speaker TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY,
  participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  scanned_at TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'qr',
  device_id TEXT NOT NULL DEFAULT '',
  user_id INTEGER REFERENCES users(id),
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (participant_id, session_id)
);
CREATE INDEX IF NOT EXISTS idx_attendance_session ON attendance(session_id);
CREATE TABLE IF NOT EXISTS contest_results (
  id INTEGER PRIMARY KEY,
  contest TEXT NOT NULL,
  rank INTEGER NOT NULL,
  winner TEXT NOT NULL,
  church_id INTEGER REFERENCES churches(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY,
  filename TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  width INTEGER, height INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`);

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
  spotify_url: "https://open.spotify.com/search/NDC%20Worship",
  code_prefix: "PPD27",
};

function getSettings() {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    try { out[r.key] = JSON.parse(r.value); } catch { /* abaikan nilai rusak */ }
  }
  return out;
}

function saveSettings(patch) {
  const stmt = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  const tx = db.transaction((entries) => { for (const [k, v] of entries) stmt.run(k, JSON.stringify(v)); });
  tx(Object.entries(patch).filter(([k]) => k in DEFAULT_SETTINGS));
  return getSettings();
}

module.exports = { db, DATA_DIR, getSettings, saveSettings, DEFAULT_SETTINGS };
