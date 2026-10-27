// Aplikasi scanner (PWA). Semua pencatatan terjadi di HP; server hanya dihubungi saat unduh data dan sinkron.
(function () {
  const S = window.RPKStore;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const hhmm = (iso) => new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  const ago = (iso) => {
    if (!iso) return "belum pernah";
    const m = Math.round((Date.now() - new Date(iso)) / 6e4);
    return m < 1 ? "baru saja" : m < 60 ? `${m} menit lalu` : m < 1440 ? `${Math.round(m / 60)} jam lalu` : new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short" });
  };
  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
  const ROLE = { gembala: "Gembala sidang", peserta: "Peserta" };
  const KIND = { seminar: "Seminar", checkin: "Check-in" };

  let participants = [], byQr = new Map(), byCode = new Map(), byId = new Map(), churches = new Map(), sessions = [];
  let session = null, conn = "offline";

  // ---------- Layar ----------
  const screens = ["scrLogin", "scrHome", "scrScan", "scrHistory"];
  function show(id) { screens.forEach((s) => ($("#" + s).hidden = s !== id)); if (id !== "scrScan") stopCamera(); window.scrollTo(0, 0); }

  // ---------- Service worker & penyimpanan ----------
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/scan/sw.js", { scope: "/scan/" }).catch(() => {});
    let first = !navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (!first) $("#updateBanner").hidden = false; first = false; });
    navigator.serviceWorker.addEventListener("message", (e) => { if (e.data?.type === "synced") refreshHome(); });
  }
  $("#reloadBtn").onclick = () => location.reload();

  async function ensureDeviceId() {
    let id = await S.kv("device_id");
    if (!id) { id = "hp-" + Math.random().toString(36).slice(2, 8); await S.setKv("device_id", id); }
    return id;
  }

  // ---------- Umpan balik: getar + bunyi ----------
  // Chrome Android hanya mengizinkan suara yang "dibuka" lewat sentuhan. Scan kamera bukan sentuhan,
  // jadi suara dibuka pada sentuhan pertama petugas (login, pilih sesi, dsb.) lalu dipakai terus.
  let actx = null;
  function audio() {
    if (!actx) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; actx = new AC(); }
    if (actx.state !== "running") actx.resume().catch(() => {});
    return actx;
  }
  function unlockAudio() {
    const ctx = audio(); if (!ctx) return;
    const b = ctx.createBuffer(1, 1, 22050), src = ctx.createBufferSource(); // bunyi kosong untuk membuka izin
    src.buffer = b; src.connect(ctx.destination); src.start(0);
    if (ctx.state === "running") ["pointerdown", "touchend", "keydown"].forEach((t) => document.removeEventListener(t, unlockAudio, true));
  }
  ["pointerdown", "touchend", "keydown"].forEach((t) => document.addEventListener(t, unlockAudio, true));
  document.addEventListener("visibilitychange", () => { if (!document.hidden && actx) actx.resume().catch(() => {}); });

  // ok: "jringgg" (lonceng logam bergetar) · dup: dua nada sedang · err: dengung rendah
  function jring(ctx) {
    const t = ctx.currentTime + 0.01, len = 1.6;
    // dibuat nyaring: dikeraskan lalu ditahan kompresor supaya tidak pecah di speaker HP
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20; comp.knee.value = 6; comp.ratio.value = 12; comp.attack.value = 0.002; comp.release.value = 0.3;
    const makeup = ctx.createGain(); makeup.gain.value = 1.35;
    const out = ctx.createGain(); out.gain.value = 2.6; out.connect(comp).connect(makeup).connect(ctx.destination);
    // "rrr": volume bergetar cepat seperti lonceng sepeda / bel kasir
    const trem = ctx.createGain(), lfo = ctx.createOscillator(), depth = ctx.createGain();
    lfo.frequency.value = 24; depth.gain.value = 0.4; trem.gain.value = 0.55;
    lfo.connect(depth).connect(trem.gain); trem.connect(out); lfo.start(t); lfo.stop(t + len);
    // "j": desis logam singkat di awal
    const n = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.05), ctx.sampleRate), d = n.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const ns = ctx.createBufferSource(), hp = ctx.createBiquadFilter(), ng = ctx.createGain();
    ns.buffer = n; hp.type = "highpass"; hp.frequency.value = 5000; ng.gain.value = 0.35;
    ns.connect(hp).connect(ng).connect(out); ns.start(t);
    // "ringgg": nada-nada lonceng terang yang memudar
    [[1318.5, 0.32], [1975.5, 0.26], [2637, 0.2], [3322, 0.14], [4186, 0.1], [5274, 0.06]].forEach(([f, v], i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.value = f; o.detune.value = (i % 2 ? 7 : -7);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len * (1 - i * 0.1));
      o.connect(g).connect(trem); o.start(t); o.stop(t + len + 0.05);
    });
  }
  const SOUNDS = {
    dup: [[740, 0, 0.13, "triangle"], [740, 0.2, 0.13, "triangle"]],
    err: [[196, 0, 0.4, "square"]],
  };
  function beep(kind) {
    window.__rpkLastBeep = { kind, at: Date.now(), state: actx ? actx.state : "none" };
    try {
      const ctx = audio();
      if (ctx && kind === "ok") jring(ctx);
      else if (ctx) for (const [f, at, dur, type] of SOUNDS[kind] || SOUNDS.err) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = type; o.frequency.value = f;
        const t = ctx.currentTime + 0.01 + at, peak = type === "square" ? 0.18 : 0.6;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + dur + 0.03);
      }
    } catch (_) {}
    if (navigator.vibrate) navigator.vibrate(kind === "ok" ? 70 : kind === "dup" ? [50, 80, 50] : [220, 90, 220]);
  }
  let resultTimer = null;
  function showResult(kind, state, name, sub) {
    const r = $("#result");
    r.className = "result " + kind; r.hidden = false;
    $("#rState").textContent = state; $("#rName").textContent = name; $("#rSub").textContent = sub || "";
    clearTimeout(resultTimer); resultTimer = setTimeout(() => (r.hidden = true), kind === "ok" ? 2600 : 4200);
    beep(kind);
  }

  // ---------- Data lokal ----------
  async function loadLocal() {
    participants = await S.all("participants");
    byQr = new Map(participants.map((p) => [p.qr, p]));
    byCode = new Map(participants.map((p) => [p.code.toUpperCase(), p]));
    byId = new Map(participants.map((p) => [p.id, p]));
    churches = new Map((await S.all("churches")).map((c) => [c.id, c]));
    sessions = (await S.all("sessions")).sort((a, b) => a.day - b.day || String(a.starts_at).localeCompare(String(b.starts_at)) || a.id - b.id);
    participants.forEach((p) => (p._n = norm(p.name)));
  }

  // ---------- Login ----------
  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#lgErr"), btn = $("#lgBtn"); err.hidden = true; btn.disabled = true; btn.textContent = "Masuk…";
    try {
      const device = await ensureDeviceId();
      const res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: $("#lgUser").value.trim(), password: $("#lgPass").value, mode: "scanner", device }) });
      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("json")) throw new Error("Koneksi dialihkan. Jika memakai WiFi berbayar, login WiFi dulu di browser.");
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      await S.setKv("auth", { token: d.token, user: d.user, expires: d.expires });
      btn.textContent = "Mengunduh data peserta…";
      await S.downloadDataset();
      if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
      $("#lgPass").value = "";
      await goHome();
    } catch (x) {
      err.textContent = x.message === "Failed to fetch" ? "Tidak ada koneksi. Login membutuhkan internet sekali di awal." : x.message;
      err.hidden = false;
    } finally { btn.disabled = false; btn.textContent = "Masuk & unduh data"; }
  });

  // ---------- Beranda ----------
  async function goHome() {
    await loadLocal();
    show("scrHome");
    await refreshHome();
    checkConn();
  }
  async function refreshHome() {
    const auth = await S.kv("auth"), meta = await S.kv("dataset");
    $("#evName").textContent = meta?.event_name || "Retreat";
    $("#userName").textContent = auth?.user ? `${auth.user.name} · ${await S.kv("device_id")}` : "";
    const pending = await S.pendingCount();
    $("#pendingN").textContent = pending;
    $(".pending").classList.toggle("has", pending > 0);
    $("#pendingLbl").textContent = pending ? "scan belum terkirim ke server" : "semua scan sudah terkirim";
    $("#lastSync").textContent = "Sinkron: " + ago(await S.kv("last_sync"));
    $("#dataInfo").textContent = meta ? `Data: ${meta.participants} peserta lunas, ${meta.sessions} sesi · diunduh ${ago(meta.at)}. Unduh ulang bila ada pendaftaran atau jadwal baru.` : "";
    const known = await S.all("known");
    const counts = new Map();
    known.forEach((k) => counts.set(k.s, (counts.get(k.s) || 0) + 1));
    const list = $("#sessionList");
    if (!sessions.length) { list.innerHTML = `<div class="empty">Belum ada sesi. Minta admin menambahkan jadwal, lalu tekan Unduh ulang data.</div>`; return; }
    let html = "", lastDay = null;
    for (const s of sessions) {
      if (s.day !== lastDay) { html += `<div class="day">Hari ${s.day}</div>`; lastDay = s.day; }
      html += `<button class="session" data-s="${s.id}"><b><span class="kind ${s.kind}">${KIND[s.kind]}</span>${esc(s.title)}</b>
        <small>${[s.starts_at && (s.starts_at + (s.ends_at ? "–" + s.ends_at : "")), s.location].filter(Boolean).map(esc).join(" · ") || "&nbsp;"}</small>
        <span class="n">${counts.get(s.id) || 0}<span>tercatat</span></span></button>`;
    }
    list.innerHTML = html;
  }
  $("#sessionList").onclick = (e) => { const b = e.target.closest("[data-s]"); if (b) openSession(Number(b.dataset.s)); };

  async function checkConn() {
    conn = await S.probe();
    const label = { online: "Terhubung ke server", offline: "Offline · scan tetap jalan", captive: "WiFi perlu login" }[conn];
    const el = $("#conn"); el.className = "conn " + conn; el.textContent = label;
    $("#dot").className = "dot " + conn; $("#dot").title = label;
    return conn;
  }

  function syncMsg(text, kind) { const m = $("#syncMsg"); m.textContent = text; m.className = "note " + (kind || ""); m.hidden = !text; }
  async function doSync(silent) {
    try {
      if (!silent) { $("#syncBtn").disabled = true; $("#syncBtn").textContent = "Mengirim…"; }
      const r = await S.syncNow();
      conn = "online";
      if (!silent) syncMsg(`Terkirim ${r.sent} scan${r.dup ? `, ${r.dup} sudah tercatat oleh HP lain` : ""}${r.rejected ? `, ${r.rejected} ditolak (lihat riwayat)` : ""}.`, r.rejected ? "warn" : "ok");
    } catch (x) {
      if (x.code === "auth") { syncMsg(x.message, "err"); if (!silent) promptRelogin(); }
      else if (!silent) syncMsg(x.code === "captive" ? "WiFi tersambung tapi belum bisa ke server. Buka browser dan login WiFi berbayar dulu, lalu coba lagi." : x.code === "offline" ? "Tidak ada koneksi. Scan tetap tersimpan di HP." : x.message, "warn");
    } finally {
      if (!silent) { $("#syncBtn").disabled = false; $("#syncBtn").textContent = "Sinkronkan"; }
      if (!$("#scrHome").hidden) { await refreshHome(); checkConn(); }
      updateScanHeader();
    }
  }
  $("#syncBtn").onclick = () => doSync(false);
  $("#dlBtn").onclick = async () => {
    const btn = $("#dlBtn"); btn.disabled = true; btn.textContent = "Mengunduh…";
    try {
      if ((await S.probe()) !== "online") throw new Error("Butuh koneksi ke server untuk mengunduh data.");
      await doSync(true);
      await S.downloadDataset(); await loadLocal(); await refreshHome();
      syncMsg(`Data terbaru: ${participants.length} peserta, ${sessions.length} sesi.`, "ok");
    } catch (x) { syncMsg(x.code === "auth" ? x.message : x.message, "warn"); if (x.code === "auth") promptRelogin(); }
    finally { btn.disabled = false; btn.textContent = "Unduh ulang data"; }
  };

  function sheet(html) { $("#sheetCard").innerHTML = html; $("#sheet").hidden = false; }
  function closeSheet() { $("#sheet").hidden = true; }
  $("#sheet").addEventListener("click", (e) => { if (e.target.id === "sheet" || e.target.closest("[data-close]")) closeSheet(); });

  function promptRelogin() {
    sheet(`<h3>Login ulang</h3><p class="muted">Sesi login berakhir atau akun diubah admin. Scan yang belum terkirim tetap aman di HP.</p>
      <form id="reForm" class="stack"><input id="reUser" placeholder="Username" autocapitalize="none"><input id="rePass" type="password" placeholder="Password">
      <div class="note err" id="reErr" hidden></div><button class="btn primary big">Login</button><button type="button" class="btn ghost" data-close>Nanti</button></form>`);
    S.kv("auth").then((a) => { if (a?.user) $("#reUser").value = a.user.username; });
    $("#reForm").onsubmit = async (e) => {
      e.preventDefault();
      try {
        const res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: $("#reUser").value.trim(), password: $("#rePass").value, mode: "scanner", device: await S.kv("device_id") }) });
        const d = await res.json(); if (!res.ok) throw new Error(d.error);
        await S.setKv("auth", { token: d.token, user: d.user, expires: d.expires });
        closeSheet(); doSync(false);
      } catch (x) { const er = $("#reErr"); er.textContent = x.message === "Failed to fetch" ? "Tidak ada koneksi." : x.message; er.hidden = false; }
    };
  }

  $("#logoutBtn").onclick = async () => {
    const pending = await S.pendingCount();
    sheet(`<h3>Keluar dari scanner?</h3>
      ${pending ? `<div class="note err">Masih ada <b>${pending} scan</b> yang belum terkirim. Sinkronkan dulu sebelum keluar. Jika tetap keluar, scan tetap tersimpan di HP dan terkirim setelah login lagi di HP ini.</div>` : `<p class="muted">Data peserta di HP ini akan dihapus. Login lagi membutuhkan internet.</p>`}
      <button class="btn big" id="doLogout">Keluar</button><button class="btn ghost" data-close>Batal</button>`);
    $("#doLogout").onclick = async () => {
      const auth = await S.kv("auth");
      try { if (auth?.token) await fetch("/api/auth/logout", { method: "POST", headers: { Authorization: "Bearer " + auth.token } }); } catch (_) {}
      await S.del("kv", "auth");
      closeSheet(); show("scrLogin");
    };
  };

  // ---------- Sesi & pencatatan ----------
  async function openSession(id) {
    session = sessions.find((s) => s.id === id);
    if (!session) return;
    await S.setKv("last_session", id);
    $("#sesTitle").textContent = session.title;
    show("scrScan");
    setTab("cam");
    updateScanHeader();
    fillChurchFilter();
  }
  async function updateScanHeader() {
    if (!session) return;
    const known = await S.all("known");
    const n = known.filter((k) => k.s === session.id).length;
    const pending = await S.pendingCount();
    $("#sesCount").textContent = `${n} tercatat · Hari ${session.day}${pending ? ` · ${pending} belum terkirim` : ""}`;
  }
  $("#backBtn").onclick = () => { session = null; goHome(); };

  async function record(p, method) {
    if (!session) return;
    const r = await S.record(p.id, session.id, method);
    const ch = churches.get(p.church_id)?.name || "";
    if (r.status === "ok") showResult("ok", "Hadir · tercatat", p.name, `${ch} · ${ROLE[p.role]}`);
    else showResult("dup", `Sudah tercatat ${hhmm(r.time)}`, p.name, ch);
    updateScanHeader();
    if (r.status === "ok") scheduleSync();
    return r;
  }

  let syncT = null;
  function scheduleSync() {
    // Minta Chrome mengirim di latar belakang begitu ada koneksi, plus coba langsung bila sedang online.
    navigator.serviceWorker?.ready.then((reg) => reg.sync?.register("rpk-sync")).catch(() => {});
    clearTimeout(syncT); syncT = setTimeout(() => { if (navigator.onLine) doSync(true); }, 1500);
  }

  function handleCode(raw, method) {
    const text = String(raw || "").trim();
    const p = byQr.get(text) || byCode.get(text.toUpperCase());
    if (p) return record(p, method);
    showResult("err", "Tidak dikenal", method === "kode" ? text.toUpperCase() : "QR tidak ada di data HP ini",
      "Pastikan pendaftarannya lunas, lalu Unduh ulang data saat ada koneksi.");
  }

  // ---------- Tab ----------
  function setTab(tab) {
    document.querySelectorAll(".tabs [data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
    $("#paneCam").hidden = tab !== "cam"; $("#paneName").hidden = tab !== "name"; $("#paneCode").hidden = tab !== "code";
    if (tab === "cam") startCamera(); else stopCamera();
    if (tab === "name") setTimeout(() => $("#nameQ").focus(), 50);
    if (tab === "code") setTimeout(() => $("#codeIn").focus(), 50);
  }
  document.querySelector(".tabs").onclick = (e) => { const b = e.target.closest("[data-tab]"); if (b) setTab(b.dataset.tab); };

  // ---------- Cari nama ----------
  function fillChurchFilter() {
    const sel = $("#churchF"), cur = sel.value;
    const used = new Set(participants.map((p) => p.church_id));
    sel.innerHTML = `<option value="">Semua gereja</option>` + [...churches.values()].filter((c) => used.has(c.id)).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
    sel.value = cur;
  }
  async function searchNames() {
    const q = norm($("#nameQ").value), cf = Number($("#churchF").value) || null;
    const box = $("#nameResults");
    if (q.length < 2 && !cf) { box.innerHTML = `<p class="muted small">Ketik minimal 2 huruf, atau pilih gereja.</p>`; return; }
    const words = q.split(" ").filter(Boolean);
    const hits = participants.filter((p) => (!cf || p.church_id === cf) && words.every((w) => p._n.includes(w))).slice(0, 60);
    const known = new Map((await S.all("known")).filter((k) => k.s === session.id).map((k) => [k.p, k.t]));
    box.innerHTML = hits.length ? hits.map((p) => {
      const t = known.get(p.id);
      return `<div class="item${t ? " done" : ""}"><b>${esc(p.name)}</b><small>${esc(churches.get(p.church_id)?.name || "")} · ${ROLE[p.role]}</small>
        <span class="act">${t ? `<span class="tag wait">Tercatat ${hhmm(t)}</span>` : `<button class="btn sm primary" data-p="${p.id}">Hadir</button>`}</span></div>`;
    }).join("") : `<div class="empty">Tidak ditemukan di data HP ini. Jika baru lunas, Unduh ulang data saat ada koneksi.</div>`;
  }
  let nt; $("#nameQ").oninput = () => { clearTimeout(nt); nt = setTimeout(searchNames, 120); };
  $("#churchF").onchange = searchNames;
  $("#nameResults").onclick = async (e) => {
    const b = e.target.closest("[data-p]"); if (!b) return;
    b.disabled = true;
    await record(byId.get(Number(b.dataset.p)), "manual");
    searchNames();
  };

  // ---------- Ketik kode ----------
  $("#codeForm").onsubmit = (e) => { e.preventDefault(); const v = $("#codeIn").value; if (!v.trim()) return; handleCode(v, "kode"); $("#codeIn").value = ""; $("#codeIn").focus(); };

  // ---------- Kamera ----------
  let stream = null, rafId = null, detector = null, canvas = null, ctx2d = null, lastText = "", lastAt = 0, pausedUntil = 0, wakeLock = null, busy = false;
  async function startCamera() {
    if (stream) return;
    const msg = $("#camMsg"); msg.hidden = false; msg.textContent = "Menyalakan kamera…";
    if (!navigator.mediaDevices?.getUserMedia) { msg.textContent = "Kamera tidak tersedia di browser ini. Pakai Cari nama atau Ketik kode."; return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      const v = $("#video"); v.srcObject = stream; await v.play();
      if ("BarcodeDetector" in window) {
        try { const f = await BarcodeDetector.getSupportedFormats(); if (f.includes("qr_code")) detector = new BarcodeDetector({ formats: ["qr_code"] }); } catch (_) { detector = null; }
      }
      const track = stream.getVideoTracks()[0];
      const caps = track.getCapabilities ? track.getCapabilities() : {};
      $("#torchBtn").hidden = !caps.torch;
      msg.textContent = "Arahkan QR di ID card ke dalam bingkai";
      try { wakeLock = await navigator.wakeLock?.request("screen"); } catch (_) {}
      loop();
    } catch (x) {
      stream = null;
      msg.textContent = x.name === "NotAllowedError" ? "Izin kamera ditolak. Buka pengaturan situs di Chrome dan izinkan kamera." : "Kamera tidak bisa dibuka. Pakai Cari nama atau Ketik kode.";
    }
  }
  function stopCamera() {
    cancelAnimationFrame(rafId); rafId = null;
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    try { wakeLock?.release(); } catch (_) {}
    wakeLock = null;
    const v = $("#video"); if (v) v.srcObject = null;
    $("#torchBtn").setAttribute("aria-pressed", "false");
  }
  let lastTick = 0;
  function loop(ts = 0) {
    rafId = requestAnimationFrame(loop);
    if (busy || ts - lastTick < 110 || Date.now() < pausedUntil) return;
    lastTick = ts;
    const v = $("#video");
    if (!v.videoWidth) return;
    busy = true;
    decode(v).then((text) => {
      if (!text) return;
      const now = Date.now();
      if (text === lastText && now - lastAt < 3000) return; // QR yang sama masih di depan kamera
      lastText = text; lastAt = now; pausedUntil = now + 900;
      handleCode(text, "qr");
    }).catch(() => {}).finally(() => (busy = false));
  }
  async function decode(v) {
    if (detector) {
      const codes = await detector.detect(v);
      return codes[0]?.rawValue || null;
    }
    if (!window.jsQR) return null;
    const w = 640, h = Math.round((v.videoHeight / v.videoWidth) * w);
    if (!canvas) { canvas = document.createElement("canvas"); ctx2d = canvas.getContext("2d", { willReadFrequently: true }); }
    canvas.width = w; canvas.height = h;
    ctx2d.drawImage(v, 0, 0, w, h);
    const img = ctx2d.getImageData(0, 0, w, h);
    const r = window.jsQR(img.data, w, h, { inversionAttempts: "dontInvert" });
    return r?.data || null;
  }
  $("#torchBtn").onclick = async () => {
    const t = stream?.getVideoTracks()[0]; if (!t) return;
    const on = $("#torchBtn").getAttribute("aria-pressed") !== "true";
    try { await t.applyConstraints({ advanced: [{ torch: on }] }); $("#torchBtn").setAttribute("aria-pressed", String(on)); } catch (_) {}
  };
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopCamera();
    else if (!$("#scrScan").hidden && !$("#paneCam").hidden) startCamera();
    if (!document.hidden && navigator.onLine) doSync(true);
  });

  // ---------- Riwayat ----------
  $("#historyBtn").onclick = async () => {
    const scans = (await S.all("scans")).sort((a, b) => b.scanned_at.localeCompare(a.scanned_at)).slice(0, 300);
    const sesMap = new Map(sessions.map((s) => [s.id, s]));
    $("#histList").innerHTML = scans.length ? scans.map((s) => {
      const p = byId.get(s.participant_id);
      const tag = s.synced === 1 ? `<span class="tag ok">Terkirim</span>` : s.synced === 2 ? `<span class="tag err">Ditolak</span>` : `<span class="tag wait">Belum terkirim</span>`;
      return `<div class="item"><b>${esc(p?.name || "Peserta #" + s.participant_id)}</b><small>${hhmm(s.scanned_at)} · ${esc(sesMap.get(s.session_id)?.title || "Sesi #" + s.session_id)}${s.note ? " · " + esc(s.note) : ""}</small><span class="act">${tag}</span></div>`;
    }).join("") : `<div class="empty">Belum ada scan di HP ini.</div>`;
    show("scrHistory");
  };
  $("#histBack").onclick = () => goHome();

  // ---------- Sinkron otomatis ----------
  window.addEventListener("online", () => doSync(true));
  window.addEventListener("offline", () => { conn = "offline"; checkConn(); });
  setInterval(() => { if (!document.hidden && navigator.onLine) doSync(true); else checkConn(); }, 60000);

  // ---------- Mulai ----------
  (async () => {
    await ensureDeviceId();
    const auth = await S.kv("auth");
    const meta = await S.kv("dataset");
    if (!auth || !meta) { show("scrLogin"); return; }
    await goHome();
    if (navigator.onLine) doSync(true);
  })();
})();
