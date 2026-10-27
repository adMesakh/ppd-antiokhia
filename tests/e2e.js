// Uji ujung-ke-ujung: daftar → approve → scan offline → sinkron → hasil. Jalankan: npm test
const { chromium, devices } = require("playwright");
const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const QRCode = require("qrcode");

const PORT = 3911;
const BASE = `http://localhost:${PORT}`;
const DATA = fs.mkdtempSync("/tmp/rpk-e2e-");
const SHOTS = path.join(__dirname, "screenshots");
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (ok, msg) => { results.push([!!ok, msg]); console.log(`${ok ? "✓" : "✗"} ${msg}`); };
const errors = [];
const watch = (page, label) => {
  page.on("pageerror", (e) => errors.push(`${label}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|net::ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(m.text())) errors.push(`${label}: ${m.text()}`); });
};

async function api(method, url, body, cookie) {
  const res = await fetch(BASE + url, { method, headers: { "Content-Type": "application/json", "X-RPK": "1", ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null), headers: res.headers };
}

(async () => {
  const server = spawn("node", [process.env.E2E_SERVER || "server/start.js"], { cwd: path.join(__dirname, ".."), env: { ...process.env, PORT, DATA_DIR: DATA, ADMIN_USERNAME: "admin", ADMIN_PASSWORD: "panitia-rahasia" }, stdio: "inherit" });
  for (let i = 0; i < 120; i++) { try { if ((await fetch(BASE + "/api/ping")).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  const browser = await chromium.launch();
  try {
    // ---------- Persiapan data oleh admin (lewat UI) ----------
    const adminCtx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    const admin = await adminCtx.newPage(); watch(admin, "admin");
    await admin.goto(BASE + "/admin/");
    check(/\/admin\/login\.html/.test(admin.url()), "Membuka dashboard tanpa login diarahkan ke halaman login terpisah");
    await admin.fill("#lgUser", "admin"); await admin.fill("#lgPass", "salah-password"); await admin.click("#lgBtn");
    await admin.waitForSelector("#lgErr:not([hidden])");
    check(/salah/.test(await admin.textContent("#lgErr")), "Password salah ditolak dengan pesan jelas");
    await admin.fill("#lgPass", "panitia-rahasia"); await admin.click("#lgBtn");
    await admin.waitForURL(/\/admin\/$/);
    await admin.waitForSelector("#app:not([hidden])");
    check(true, "Admin login di halaman terpisah lalu masuk ke dashboard");
    await admin.goto(BASE + "/admin/#gereja");
    await admin.waitForSelector("#addC");
    check(!(await admin.$("#cAdd")), "Halaman gereja tanpa form terbuka; tambah lewat tombol");
    await admin.click("#addC"); await admin.waitForSelector("dialog[open] #cAdd");
    check(await admin.locator("#cAdd [name=name]").isVisible() && await admin.locator("#cAdd textarea").isHidden(), "Tombol Tambah gereja membuka modal, bawaan '1 gereja'");
    await admin.fill("#cAdd [name=name]", "GKII Jemaat Sungai Raya"); await admin.fill("#cAdd [name=city]", "Kubu Raya");
    await admin.click("#cBtn"); await admin.waitForSelector("#toast:has-text(\"Gereja ditambahkan\")");
    await admin.waitForSelector("dialog[open]", { state: "detached" }).catch(() => {});
    await admin.click("#addC"); await admin.waitForSelector("dialog[open] #cAdd");
    await admin.check("#cAdd [name=cmode][value=bulk]", { force: true });
    check(await admin.locator("#cAdd textarea").isVisible() && await admin.locator("#cAdd [name=name]").isHidden(), "Pilih 'Banyak gereja': form di modal berganti jadi kotak tempel");
    await admin.fill("#cAdd textarea", "GKII Jemaat Sungai Raya, Kubu Raya\nGPdI Siloam, Pontianak\nGBI Rock Singkawang, Singkawang\nGKE Imanuel, Ketapang\nHKBP Pontianak, Pontianak\nGPIB Maranatha, Pontianak");
    await admin.click("#cBtn");
    await admin.waitForFunction(() => /5 ditambahkan, 1 dilewati/.test(document.querySelector("#toast").textContent));
    await admin.waitForSelector("#cTable tbody tr");
    check(await admin.locator("#cTable tbody tr").count() === 6, "Admin menambah 1 gereja lalu menempel banyak sekaligus (yang sudah ada dilewati)");
    await admin.fill("#cQ", "pontianak");
    check(await admin.locator("#cTable tbody tr").count() === 3 && /3 dari 6/.test(await admin.textContent("#cCount")), "Pencarian di tabel gereja (nama/kota) menyaring hasil");
    await admin.fill("#cQ", "");
    const cookie = (await adminCtx.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");

    await admin.goto(BASE + "/admin/#jadwal");
    const addSession = async (title, kind, day, start) => {
      await admin.click("#newS");
      await admin.fill("#sf [name=title]", title); await admin.selectOption("#sf [name=kind]", kind);
      await admin.fill("#sf [name=day]", String(day)); await admin.fill("#sf [name=starts_at]", start);
      await admin.click("#sf button.primary"); await admin.waitForSelector("dialog[open]", { state: "detached" }).catch(() => {});
      await admin.waitForTimeout(300);
    };
    await addSession("Registrasi ulang", "checkin", 1, "08:00");
    await addSession("Seminar 1: Identitas", "seminar", 1, "10:00");
    await addSession("Seminar 2: Panggilan", "seminar", 2, "09:00");
    check((await api("GET", "/api/admin/sessions", null, cookie)).data.length === 3, "Admin membuat 3 sesi lewat form");

    await admin.goto(BASE + "/admin/#konten");
    await admin.fill("[name=fee_per_person]", "150000");
    await admin.fill("[name=contact]", "Panitia · 0812-0000-0000");
    await admin.click("#setF button.primary");
    await admin.waitForSelector("#toast:has-text(\"Konten disimpan\")");
    // contoh file: foto pembicara + lagu kecil + lagu besar (> 4 MB, harus dikecilkan di browser)
    const FX = path.join(DATA, "fx"); fs.mkdirSync(FX, { recursive: true });
    const ff = (args) => require("child_process").execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...args]);
    ff(["-f", "lavfi", "-i", "testsrc=size=640x800:rate=1", "-frames:v", "1", path.join(FX, "pembicara.jpg")]);
    ff(["-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-ac", "2", "-b:a", "128k", path.join(FX, "kecil.mp3")]);
    ff(["-f", "lavfi", "-i", "anoisesrc=d=200:c=pink:a=0.2", "-ac", "2", "-b:a", "192k", path.join(FX, "besar.mp3")]);
    await admin.fill("#luF [name=name]", "Pdt. Contoh Utama"); await admin.selectOption("#luF [name=tier]", "utama");
    await admin.setInputFiles("#luF [name=photo]", path.join(FX, "pembicara.jpg"));
    await admin.click("#luF button");
    await admin.waitForSelector("img.lu-thumb");
    const lu1 = (await api("GET", "/api/public")).data.lineup.find((l) => l.name === "Pdt. Contoh Utama");
    check(lu1 && /^\/uploads\/lineup-.*\.jpg$/.test(lu1.photo_url) && (await fetch(BASE + lu1.photo_url)).ok, "Admin mengunggah foto pembicara di lineup");
    await admin.fill("#musicF [name=title]", "Sukacita Melimpah · NDC Worship");
    await admin.setInputFiles("#musicF [name=file]", path.join(FX, "kecil.mp3"));
    await admin.click("#musicBtn");
    await admin.waitForSelector(".music-now audio");
    let S1 = (await api("GET", "/api/public")).data.settings;
    check(S1.music_title === "Sukacita Melimpah · NDC Worship" && /\.mp3$/.test(S1.music_url) && (await fetch(BASE + S1.music_url)).ok, "Admin mengunggah lagu latar MP3 beserta judulnya");
    const playableIn = (pg, u) => pg.evaluate((u) => new Promise((ok) => { const a = new Audio(); a.onloadedmetadata = () => ok(a.duration); a.onerror = () => ok(-1); a.src = u; setTimeout(() => ok(0), 10000); }), u);
    // lagu 4,8 MB (lebih dari batas satu permintaan Vercel) dikirim per potongan tanpa diubah
    const bigSize = fs.statSync(path.join(FX, "besar.mp3")).size;
    await admin.setInputFiles("#musicF [name=file]", path.join(FX, "besar.mp3"));
    await admin.click("#musicBtn");
    await admin.waitForFunction((old) => { const a = document.querySelector(".music-now audio"); return a && a.getAttribute("src") !== old; }, S1.music_url, { timeout: 120000 });
    const S2 = (await api("GET", "/api/public")).data.settings;
    const up2 = Buffer.from(await (await fetch(BASE + S2.music_url)).arrayBuffer());
    check(up2.equals(fs.readFileSync(path.join(FX, "besar.mp3"))) && await playableIn(admin, S2.music_url) > 190 && !fs.existsSync(path.join(DATA, "uploads", path.basename(S1.music_url))),
      `Lagu ${(bigSize / 1e6).toFixed(1)} MB terunggah utuh per potongan (byte sama persis), bisa diputar, lagu lama terhapus`);
    check((await api("GET", "/api/admin/settings", null, cookie)).status === 200 && (await api("POST", "/api/admin/music/finish", { upload_id: "abcdefabcdef12", total: 2, size: 10 }, cookie)).status === 400, "Unggahan lagu yang potongannya hilang ditolak");
    // lagu > 15 MB dikecilkan dulu di browser
    ff(["-f", "lavfi", "-i", "anoisesrc=d=420:c=pink:a=0.2", "-ac", "2", "-b:a", "320k", path.join(FX, "raksasa.mp3")]);
    await admin.setInputFiles("#musicF [name=file]", path.join(FX, "raksasa.mp3"));
    await admin.click("#musicBtn");
    await admin.waitForFunction((old) => { const a = document.querySelector(".music-now audio"); return a && a.getAttribute("src") !== old; }, S2.music_url, { timeout: 240000 });
    const S3 = (await api("GET", "/api/public")).data.settings;
    const up3 = Number((await fetch(BASE + S3.music_url)).headers.get("content-length"));
    const d3 = await playableIn(admin, S3.music_url);
    check(up3 < 15.8e6 && d3 > 400, `Lagu ${(fs.statSync(path.join(FX, "raksasa.mp3")).size / 1e6).toFixed(1)} MB dikecilkan jadi ${(up3 / 1e6).toFixed(1)} MB dan tetap bisa diputar (${Math.round(d3)} detik)`);
    await admin.fill("#musicF [name=title]", "Sukacita Melimpah · NDC Worship");
    await admin.setInputFiles("#musicF [name=file]", path.join(FX, "kecil.mp3"));
    await admin.click("#musicBtn");
    await admin.waitForFunction((old) => { const a = document.querySelector(".music-now audio"); return a && a.getAttribute("src") !== old; }, S3.music_url);
    await admin.fill("#luF [name=name]", "Bintang Tamu Contoh"); await admin.selectOption("#luF [name=tier]", "tamu"); await admin.click("#luF button");
    await admin.waitForTimeout(400);
    check((await api("GET", "/api/public")).data.settings.fee_per_person === 150000, "Biaya per peserta tersimpan");

    // ---------- Pendaftaran publik ----------
    const pubCtx = await browser.newContext({ ...devices["Pixel 7"] });
    // pengunjung ini dulu pernah menekan "hentikan" saat pad bawaan diputar
    await pubCtx.addInitScript(() => { if (!sessionStorage.getItem("x")) { sessionStorage.setItem("x", 1); localStorage.setItem("rpk-muted-for", "pad"); } });
    const pub = await pubCtx.newPage(); watch(pub, "landing");
    await pub.goto(BASE + "/");
    await pub.waitForSelector(".ecard");
    check(!(await pub.$("#regForm")), "Landing page tidak memuat formulir pendaftaran");
    check(!/Unsplash/i.test(await pub.locator("footer").innerText()), "Kredit foto tidak tampil di footer");
    await pub.waitForSelector(".scard img.face");
    check(await pub.locator(".scard img.face").first().getAttribute("src") === lu1.photo_url, "Lineup di website memakai foto pembicara");
    check(/Sukacita Melimpah/.test(await pub.textContent("#npTitle")), "Pemutar menampilkan judul lagu yang diunggah");
    await pub.locator("h1").first().click();
    await pub.waitForFunction(() => /Sedang diputar/.test(document.querySelector("#npState").textContent), null, { timeout: 8000 }).catch(() => {});
    check(/Sedang diputar/.test(await pub.textContent("#npState")), "Lagu baru tetap diputar pada sentuhan pertama walau pengunjung pernah menghentikan musik lama");
    await pub.screenshot({ path: path.join(SHOTS, "landing-mobile.png"), fullPage: false });
    await pub.click("#heroCta");
    await pub.waitForURL(/\/daftar\.html/);
    check(true, "Tombol Daftar sekarang membuka halaman pendaftaran terpisah");
    await pub.waitForSelector("#church option:nth-child(2)", { state: "attached" });
    await pub.screenshot({ path: path.join(SHOTS, "daftar-mobile.png"), fullPage: true });
    const churchVal = await pub.locator("#church option", { hasText: "GPdI Siloam" }).getAttribute("value");
    // --- daftar diri sendiri (pilihan bawaan) ---
    check(await pub.isChecked("[name=mode][value=sendiri]") && await pub.locator(".prow").count() === 1 && await pub.locator("#addWrap").isHidden() && !(await pub.$("#coord")),
      "Formulir bawaan: daftar diri sendiri, satu data diri, tanpa koordinator");
    await pub.selectOption("#church", churchVal); await pub.fill("#phone", "0813 1111 2222");
    await pub.locator(".prow [data-f=name]").fill("Yosua Mandiri");
    await pub.locator(".prow input[data-f=gender][value=L]").check({ force: true });
    await pub.click("#submitBtn"); await pub.waitForURL(/status\.html/); await pub.waitForSelector(".code");
    const soloCode = (await pub.locator(".code").textContent()).trim();
    const soloReg = (await api("GET", "/api/admin/registrations?q=" + soloCode, null, cookie)).data[0];
    check(soloReg && soloReg.n === 1 && soloReg.coordinator === "Yosua Mandiri", `Daftar sendiri terkirim (${soloCode}, 1 orang, pendaftar = nama peserta)`);
    check((await api("POST", "/api/registrations", { church_id: Number(churchVal), phone: "081311112222", mode: "sendiri", participants: [{ name: "A Satu", role: "peserta", gender: "L" }, { name: "B Dua", role: "peserta", gender: "P" }] })).status === 400, "Server menolak 'daftar sendiri' berisi lebih dari satu orang");
    // --- daftar rombongan ---
    await pub.goto(BASE + "/daftar.html"); await pub.waitForSelector("#church option:nth-child(2)", { state: "attached" });
    await pub.check("[name=mode][value=rombongan]", { force: true });
    check(await pub.locator(".prow").count() === 3 && await pub.locator("#addWrap").isVisible(), "Pilih Rombongan: muncul 3 baris peserta + tombol tambah");
    await pub.selectOption("#church", churchVal);
    await pub.fill("#phone", "0812 3456 7890");
    const rows = pub.locator(".prow");
    const fillRow = async (i, name, role, g) => {
      const r = rows.nth(i);
      await r.locator("[data-f=name]").fill(name);
      await r.locator(`input[value=${role}]`).check({ force: true });
      if (g) await r.locator(`input[data-f=gender][value=${g}]`).check({ force: true });
    };
    await fillRow(0, "Pdt. Yohanes", "gembala", "L");
    await fillRow(1, "Maria Angelina", "peserta", "P");
    await fillRow(2, "Kevin Pratama", "peserta", null);
    check(!(await pub.$("[data-f=age]")) && !(await pub.$("#consent")), "Formulir tidak lagi menanyakan usia");
    check(await pub.locator(".prow").first().locator("input[data-f=gender]").count() === 2, "Jenis kelamin hanya dua pilihan: Laki-laki dan Perempuan");
    await pub.click("#submitBtn");
    check(await pub.locator("#formErr").isVisible() && /jenis kelamin/.test(await pub.locator("#formErr").textContent()), "Formulir menolak peserta tanpa jenis kelamin");
    await fillRow(2, "Kevin Pratama", "peserta", "L");
    await pub.click("#submitBtn");
    await pub.waitForURL(/status\.html/);
    await pub.waitForSelector(".code");
    const regCode = (await pub.locator(".code").textContent()).trim();
    check(/^PPD27-[A-Z0-9]{5}$/.test(regCode) && /Menunggu/.test(await pub.textContent(".pill")), `Pendaftaran terkirim dengan kode ${regCode}, status menunggu`);
    check(/450\.000/.test(await pub.textContent("#box")), "Total tagihan 3 × Rp150.000 tampil");
    await pub.screenshot({ path: path.join(SHOTS, "status-menunggu.png"), fullPage: true });

    // cek status lewat formulir (kode + WA)
    await pub.goto(BASE + "/daftar.html#cek-status");
    await pub.fill("#lkCode", regCode.toLowerCase()); await pub.fill("#lkPhone", "+62 812-3456-7890");
    await pub.click("#lookupForm button"); await pub.waitForURL(/status\.html/);
    check(true, "Cek status dengan kode + nomor WA berhasil");

    // ---------- Admin menandai lunas ----------
    await admin.goto(BASE + "/admin/#pendaftaran");
    await admin.waitForSelector(`text=${regCode}`);
    await admin.screenshot({ path: path.join(SHOTS, "admin-pendaftaran.png") });
    await admin.click(`[data-code="${regCode}"]`);
    await admin.click("[data-yes]");
    await admin.waitForSelector("#toast:has-text(\"Ditandai lunas\")");
    const st = await api("GET", "/api/admin/registrations?status=lunas", null, cookie);
    check(st.data.some((r) => r.code === regCode), "Admin menandai pendaftaran lunas");

    await pub.reload(); await pub.waitForSelector(".pass img");
    await pub.waitForFunction(() => [...document.querySelectorAll(".pass img")].every((e) => e.complete), null, { timeout: 8000 }).catch(() => {});
    const imgsOk = await pub.$$eval(".pass img", (els) => els.every((e) => e.complete && e.naturalWidth > 0));
    check(imgsOk && (await pub.locator(".pass").count()) === 3, "Halaman status menampilkan 3 pass dengan QR");
    await pub.screenshot({ path: path.join(SHOTS, "status-lunas.png"), fullPage: true });

    // tambah data lain lewat API untuk mengisi nominasi
    const churchesList = (await api("GET", "/api/admin/churches", null, cookie)).data;
    const cid = (name) => churchesList.find((c) => c.name.startsWith(name)).id;
    const mk = (n, prefix) => Array.from({ length: n }, (_, i) => ({ name: `${prefix} ${i + 1}`, role: i === 0 ? "gembala" : "peserta", gender: i % 2 ? "P" : "L" }));
    await api("POST", "/api/admin/registrations", { church_id: cid("GKII"), coordinator: "Andre", phone: "081211112222", status: "lunas", participants: mk(8, "Peserta GKII") }, cookie);
    await api("POST", "/api/admin/registrations", { church_id: cid("GBI"), coordinator: "Sinta", phone: "081233334444", status: "lunas", participants: mk(5, "Peserta GBI") }, cookie);
    await api("POST", "/api/admin/registrations", { church_id: cid("GKE"), coordinator: "Daniel", phone: "081255556666", status: "menunggu", participants: mk(4, "Peserta GKE") }, cookie);

    // ---------- Scanner (HP Android) ----------
    const parts = (await api("GET", "/api/admin/participants?status=lunas", null, cookie)).data;
    const yoh = parts.find((p) => p.name === "Pdt. Yohanes");
    const kevin = parts.find((p) => p.name === "Kevin Pratama");
    await api("POST", "/api/admin/users", { username: "scan-pintu1", name: "Petugas Pintu 1", role: "scanner", password: "pintu12345" }, cookie);

    // video kamera palsu berisi QR Yohanes
    const png = path.join(DATA, "qr.png"), y4m = path.join(DATA, "qr.y4m");
    await QRCode.toFile(png, yoh.qr_token, { margin: 2, width: 400 });
    execFileSync("python3", [path.join(__dirname, "make_y4m.py"), png, y4m]);
    const camBrowser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${y4m}`] });
    const scanCtx = await camBrowser.newContext({ ...devices["Pixel 7"], permissions: ["camera"] });
    const sc = await scanCtx.newPage(); watch(sc, "scanner");
    await sc.goto(BASE + "/scan/");
    await sc.waitForSelector("#scrLogin:not([hidden])");
    await sc.fill("#lgUser", "scan-pintu1"); await sc.fill("#lgPass", "pintu12345"); await sc.click("#lgBtn");
    await sc.waitForSelector("#scrHome:not([hidden])");
    await sc.waitForFunction(() => document.querySelectorAll(".session").length === 3);
    check(/16 peserta lunas, 3 sesi/.test(await sc.textContent("#dataInfo")), "Scanner login dan mengunduh 16 peserta lunas + 3 sesi (yang belum lunas tidak ikut)");
    await sc.evaluate(() => navigator.serviceWorker.ready);
    await sc.reload(); await sc.waitForSelector("#scrHome:not([hidden])");
    check(await sc.evaluate(() => !!navigator.serviceWorker.controller), "Service worker aktif dan mengendalikan aplikasi");
    await sc.screenshot({ path: path.join(SHOTS, "scanner-home.png") });

    // scan lewat kamera (QR asli didekode jsQR)
    await sc.locator(".session", { hasText: "Registrasi ulang" }).click();
    await sc.waitForSelector("#result.ok", { timeout: 15000 });
    check((await sc.textContent("#rName")) === "Pdt. Yohanes", "Kamera membaca QR di ID card dan mencatat Pdt. Yohanes (hijau)");
    const bp = await sc.evaluate(() => window.__rpkLastBeep);
    check(bp && bp.kind === "ok" && bp.state === "running", `Scan berhasil berbunyi sukses (audio ${bp && bp.state})`);
    await sc.screenshot({ path: path.join(SHOTS, "scanner-scan-ok.png") });
    await sc.waitForTimeout(3600); // QR yang sama masih di depan kamera setelah jeda → kuning
    await sc.waitForSelector("#result.dup", { timeout: 10000 });
    check(/Sudah tercatat/.test(await sc.textContent("#rState")), "QR yang sama di sesi yang sama ditandai 'sudah tercatat' (kuning)");
    await sc.screenshot({ path: path.join(SHOTS, "scanner-scan-dup.png") });

    // scan pertama terkirim otomatis karena HP sedang online
    let auto = 0;
    for (let i = 0; i < 20 && !auto; i++) { await sc.waitForTimeout(500); auto = (await api("GET", "/api/admin/attendance", null, cookie)).data.length; }
    check(auto === 1, "Saat online, scan langsung terkirim otomatis ke server");

    // ---------- OFFLINE ----------
    await scanCtx.setOffline(true);
    await sc.click("[data-tab=code]");
    await sc.fill("#codeIn", kevin.code.toLowerCase()); await sc.click("#codeForm button");
    await sc.waitForSelector("#result.ok");
    check((await sc.textContent("#rName")) === "Kevin Pratama", "OFFLINE: ketik kode peserta tetap tercatat");
    await sc.fill("#codeIn", "PPD27-ZZZZZ-999"); await sc.click("#codeForm button");
    await sc.waitForSelector("#result.err");
    check(true, "Kode tak dikenal ditandai merah");
    await sc.click("[data-tab=name]");
    await sc.fill("#nameQ", "maria ang");
    await sc.waitForSelector("#nameResults [data-p]");
    await sc.click("#nameResults [data-p]");
    await sc.waitForSelector("#result.ok");
    check((await sc.textContent("#rName")) === "Maria Angelina", "OFFLINE: cari nama lalu catat hadir");
    await sc.screenshot({ path: path.join(SHOTS, "scanner-cari-nama.png") });
    // sesi seminar, beberapa peserta GKII & GBI
    await sc.click("#backBtn"); await sc.waitForSelector("#scrHome:not([hidden])");
    check(/Offline/.test(await sc.textContent("#conn")), "Beranda scanner menunjukkan status Offline");
    const pendingBefore = Number(await sc.textContent("#pendingN"));
    check(pendingBefore === 2, `Ada 2 scan offline menunggu terkirim (terbaca ${pendingBefore})`);
    // aplikasi tetap terbuka saat dimuat ulang tanpa internet
    await sc.reload(); await sc.waitForSelector("#scrHome:not([hidden])", { timeout: 10000 });
    check(true, "OFFLINE: aplikasi scanner tetap terbuka setelah dimuat ulang tanpa internet");
    await sc.locator(".session", { hasText: "Seminar 1" }).click();
    await sc.click("[data-tab=code]");
    const seminar1 = parts.filter((p) => p.church.startsWith("GKII")).slice(0, 7).concat(parts.filter((p) => p.church.startsWith("GBI")).slice(0, 5));
    for (const p of seminar1) { await sc.fill("#codeIn", p.code); await sc.click("#codeForm button"); await sc.waitForTimeout(80); }
    await sc.click("#backBtn"); await sc.waitForSelector("#scrHome:not([hidden])");
    await sc.screenshot({ path: path.join(SHOTS, "scanner-offline.png") });
    const pending2 = Number(await sc.textContent("#pendingN"));
    check(pending2 === 14, `14 scan offline tersimpan di HP (terbaca ${pending2})`);
    const serverBefore = (await api("GET", "/api/admin/attendance", null, cookie)).data.length;
    check(serverBefore === 1, `Server baru menerima 1 scan (yang online), terbaca ${serverBefore}`);

    // ---------- WiFi berbayar belum login (captive portal) ----------
    await sc.route("**/api/ping*", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<html>Login WiFi Rp5.000/jam</html>" }));
    await scanCtx.setOffline(false);
    await sc.click("#syncBtn");
    await sc.waitForSelector("#syncMsg:not([hidden])");
    const capMsg = await sc.textContent("#syncMsg"), capConn = await sc.textContent("#conn"), capPending = await sc.textContent("#pendingN");
    check(/login WiFi/i.test(capMsg) && /WiFi perlu login/.test(capConn) && capPending === "14", `WiFi berbayar yang belum login terdeteksi, 14 scan tetap aman (${capConn} · ${capPending})`);
    await sc.screenshot({ path: path.join(SHOTS, "scanner-captive.png") });
    await sc.unroute("**/api/ping*");

    // ---------- Sinkron ----------
    await sc.click("#syncBtn");
    await sc.waitForFunction(() => document.querySelector("#pendingN").textContent === "0", null, { timeout: 15000 });
    const serverAfter = (await api("GET", "/api/admin/attendance", null, cookie)).data.length;
    check(serverAfter === 15, `Setelah sinkron, server punya 15 scan (terbaca ${serverAfter})`);
    // sinkron ulang tidak menggandakan
    await sc.click("#syncBtn"); await sc.waitForTimeout(1200);
    check((await api("GET", "/api/admin/attendance", null, cookie)).data.length === 15, "Sinkron ulang tidak menggandakan data");
    await sc.screenshot({ path: path.join(SHOTS, "scanner-synced.png") });

    // HP kedua mencatat orang yang sama → ditolak sebagai duplikat oleh server, tetap dianggap terkirim
    const sc2Ctx = await browser.newContext({ ...devices["Pixel 7"] });
    const sc2 = await sc2Ctx.newPage(); watch(sc2, "scanner2");
    await sc2.goto(BASE + "/scan/"); await sc2.fill("#lgUser", "admin"); await sc2.fill("#lgPass", "panitia-rahasia"); await sc2.click("#lgBtn");
    await sc2.waitForSelector("#scrHome:not([hidden])");
    await sc2.locator(".session", { hasText: "Seminar 1" }).click();
    await sc2.click("[data-tab=code]"); await sc2.fill("#codeIn", seminar1[0].code); await sc2.click("#codeForm button");
    await sc2.waitForSelector("#result.dup");
    check(true, "HP kedua langsung tahu peserta sudah di-scan HP pertama (data ditarik saat unduh)");

    // ---------- Hasil ----------
    const rk = (await api("GET", "/api/admin/rankings", null, cookie)).data;
    check(rk.most_participants[0].church.startsWith("GBI") || rk.most_participants[0].church.startsWith("GKII"), `Nominasi peserta terbanyak: ${rk.most_participants.map((r) => r.church + "=" + r.present).join(", ")}`);
    check(rk.most_active[0].church.startsWith("GBI") && rk.most_active.every((r) => r.confirmed >= 5), `Nominasi paling aktif dihitung per peserta (GBI 5/5 mengalahkan GKII 7/8): ${rk.most_active.map((r) => r.church + "=" + r.seminar_per_person).join(", ")}`);
    await admin.goto(BASE + "/admin/#hasil");
    await admin.waitForSelector("text=Gereja paling aktif seminar");
    await admin.fill("#ctF [name=contest]", "Lomba paduan suara"); await admin.fill("#ctF [name=winner]", "Paduan suara GPdI Siloam"); await admin.click("#ctF button");
    await admin.waitForSelector("#toast:has-text(\"Pemenang ditambahkan\")");
    await admin.check("#pub"); await admin.waitForSelector("#toast:has-text(\"Hasil tampil\")");
    await admin.screenshot({ path: path.join(SHOTS, "admin-hasil.png"), fullPage: true });
    const deskCtx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    const desk = await deskCtx.newPage(); watch(desk, "landing-desktop");
    await desk.goto(BASE + "/");
    await desk.waitForSelector(".rank li");
    check(/Papan skor akhir/.test(await desk.textContent("#scoreTitle")) && /paduan suara/i.test(await desk.textContent("#contests")), "Website menampilkan nominasi dan pemenang lomba setelah dipublikasikan");
    await desk.screenshot({ path: path.join(SHOTS, "landing-desktop.png"), fullPage: true });

    // ---------- Cetak ID card ----------
    const pr = await adminCtx.newPage(); watch(pr, "print");
    await pr.goto(BASE + "/admin/print.html");
    await pr.waitForSelector("#printBtn:not([disabled])");
    check((await pr.locator(".card").count()) === 16, "Halaman cetak berisi 16 ID card (hanya peserta lunas)");
    await pr.screenshot({ path: path.join(SHOTS, "print-idcard.png") });
    await pr.emulateMedia({ media: "print" });
    await pr.pdf({ path: path.join(SHOTS, "contoh-idcard.pdf"), format: "A4", printBackground: true });

    // halaman admin lain terbuka tanpa error
    for (const v of ["ringkasan", "peserta", "galeri", "akun"]) {
      await admin.goto(BASE + "/admin/#" + v); await admin.waitForTimeout(500);
      if (v === "ringkasan" || v === "peserta") await admin.screenshot({ path: path.join(SHOTS, `admin-${v}.png`) });
    }
    // Peserta: urutkan
    await admin.goto(BASE + "/admin/#peserta"); await admin.waitForSelector("#pTable tbody tr");
    const names = async () => admin.$$eval("#pTable tbody tr td:nth-child(2)", (t) => t.map((x) => x.firstChild.textContent.trim()));
    await admin.selectOption("#pSort", "name:-1");
    const zToA = await names();
    await admin.selectOption("#pSort", "scans:-1");
    const scansCol = await admin.$$eval("#pTable tbody tr td:nth-child(7)", (t) => t.map((x) => Number(x.textContent)));
    await admin.click("th[data-sort=name]");
    const aToZ = await names();
    check(zToA.join() === [...zToA].sort((a, b) => b.localeCompare(a, "id")).join() && aToZ.join() === [...aToZ].sort((a, b) => a.localeCompare(b, "id")).join()
      && scansCol.every((v, i) => i === 0 || scansCol[i - 1] >= v), "Peserta bisa diurutkan (nama Z–A, scan terbanyak, klik judul kolom)");
    // Jadwal & kehadiran digabung
    check(!(await admin.$("a[data-nav=kehadiran]")) && /kehadiran/i.test(await admin.textContent("a[data-nav=jadwal]")), "Menu Jadwal dan Kehadiran digabung");
    await admin.goto(BASE + "/admin/#jadwal"); await admin.waitForSelector("[data-open]");
    await admin.locator("tr[data-open]", { hasText: "Registrasi ulang" }).locator("td").nth(1).click();
    await admin.waitForSelector("#aTable");
    const hadirTxt = await admin.textContent(".tiles .tile");
    check(/\/admin\/#jadwal\/\d+$/.test(admin.url()) && /hadir/.test(hadirTxt) && (await admin.locator("#aTable tbody tr").count()) > 0 && await admin.locator(".bar-row").count() > 0,
      `Klik sesi membuka detail kehadiran (${hadirTxt.replace(/\s+/g, " ").trim()})`);
    await admin.screenshot({ path: path.join(SHOTS, "admin-kehadiran.png"), fullPage: true });
    await admin.goto(BASE + "/admin/#kehadiran"); await admin.waitForTimeout(400);
    check(/#jadwal$/.test(admin.url()), "Alamat lama #kehadiran diarahkan ke Jadwal & kehadiran");
    // Galeri: link Google Drive
    await admin.goto(BASE + "/admin/#galeri"); await admin.waitForSelector("#driveF");
    await admin.fill("#driveF [name=gallery_drive_url]", "https://drive.google.com/drive/folders/contoh123"); await admin.click("#driveF button");
    await admin.waitForSelector("#toast:has-text(\"Link Google Drive disimpan\")");
    const pg = await (await browser.newContext()).newPage();
    await pg.goto(BASE + "/"); await pg.waitForSelector("#driveWrap:not([hidden])");
    check(await pg.getAttribute("#driveLink", "href") === "https://drive.google.com/drive/folders/contoh123" && await pg.getAttribute("#driveLink", "target") === "_blank",
      "Tombol 'Lihat semua foto' di landing membuka Google Drive di tab baru");
    check(true, "Semua halaman admin terbuka");

    // keamanan dasar
    check((await api("GET", "/api/admin/summary")).status === 401, "API admin menolak tanpa login");
    const scanTok = (await api("POST", "/api/auth/login", { username: "scan-pintu1", password: "pintu12345", mode: "scanner" })).data.token;
    const r403 = await fetch(BASE + "/api/admin/summary", { headers: { Authorization: "Bearer " + scanTok } });
    check(r403.status === 403, "Akun scanner tidak bisa membuka API admin");
    check((await api("POST", "/api/auth/login", { username: "scan-pintu1", password: "pintu12345" })).status === 403, "Akun scanner tidak bisa masuk dashboard admin");
    const gke = (await api("GET", "/api/admin/participants?status=menunggu", null, cookie)).data[0];
    check((await fetch(BASE + `/api/qr/${gke.qr_token}.svg`)).status === 404, "QR peserta yang belum lunas tidak bisa diambil");

    await camBrowser.close();
  } catch (e) {
    console.error(e);
    check(false, "Pengujian berhenti karena error: " + e.message);
  } finally {
    await browser.close();
    server.kill();
    const failed = results.filter((r) => !r[0]).length;
    if (errors.length) { console.log("\nError di konsol browser:"); errors.forEach((e) => console.log("  - " + e)); }
    console.log(`\n${results.length - failed}/${results.length} pemeriksaan lolos${errors.length ? `, ${errors.length} error konsol` : ""}.`);
    process.exit(failed || errors.length ? 1 : 0);
  }
})();
