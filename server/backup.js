// Cadangkan database ke folder data/backup dengan nama berstempel waktu. Jalankan: npm run backup
const path = require("path");
const fs = require("fs");
const { db, DATA_DIR } = require("./db");

const dir = path.join(DATA_DIR, "backup");
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const file = path.join(dir, `retreat-${stamp}.db`);
db.backup(file).then(() => { console.log("Cadangan tersimpan:", file); process.exit(0); })
  .catch((e) => { console.error("Gagal mencadangkan:", e.message); process.exit(1); });
