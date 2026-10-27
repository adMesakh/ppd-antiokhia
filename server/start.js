// Menjalankan server di laptop/VPS: npm start
const app = require("./index");
const { init } = require("./db");
const { ensureInitialAdmin } = require("./auth");

const PORT = Number(process.env.PORT) || 3000;
(async () => {
  await init();
  await ensureInitialAdmin();
  app.listen(PORT, () => console.log(`PPD Antiokhia berjalan di http://localhost:${PORT}`));
})().catch((e) => { console.error("Gagal menyalakan server:", e.message); process.exit(1); });
