// Cadangkan seluruh isi database ke satu file JSON (bisa dipakai untuk Neon/Postgres maupun PGlite lokal).
// Jalankan: npm run backup   → file tersimpan di data/backup/
const path = require("path");
const fs = require("fs");
const { init, many, DATA_DIR } = require("./db");

const TABLES = ["settings", "users", "churches", "lineup", "registrations", "participants", "sessions", "attendance", "contest_results", "photos"];

(async () => {
  await init();
  const out = { created_at: new Date().toISOString(), tables: {} };
  for (const t of TABLES) out.tables[t] = await many(`SELECT * FROM ${t} ORDER BY 1`);
  const dir = path.join(DATA_DIR, "backup");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `ppd-${out.created_at.replace(/[:.]/g, "-").slice(0, 19)}.json`);
  fs.writeFileSync(file, JSON.stringify(out));
  console.log("Cadangan tersimpan:", file);
  process.exit(0);
})().catch((e) => { console.error("Gagal mencadangkan:", e.message); process.exit(1); });
