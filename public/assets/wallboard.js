// Wallboard TV panitia (dipisah dari HTML supaya bisa memakai Content-Security-Policy ketat)
(function () {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n) => Number(n || 0).toLocaleString("id-ID");
  const pad = (n) => String(n).padStart(2, "0");
  const HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"], BLN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  const wib = (t) => new Date(t + 7 * 36e5); // selalu tampil dalam WIB
  const hm = (iso) => { const d = wib(new Date(iso).getTime()); return `${pad(d.getUTCHours())}.${pad(d.getUTCMinutes())}`; };
  const tgl = (iso) => { const d = wib(new Date(iso).getTime()); return `${d.getUTCDate()} ${BLN[d.getUTCMonth()]}`; };
  let D = null, lastIds = null, prev = {};

  function tick() {
    const n = wib(Date.now());
    $("#clock").textContent = `${pad(n.getUTCHours())}:${pad(n.getUTCMinutes())}`;
    $("#date").textContent = `${HARI[n.getUTCDay()]}, ${n.getUTCDate()} ${BLN[n.getUTCMonth()]} ${n.getUTCFullYear()}`;
  }
  setInterval(tick, 1000); tick();

  function setNum(el, v) {
    const from = prev[el.id] ?? v; prev[el.id] = v;
    if (from === v) { el.textContent = fmt(v); return; }
    if (from < v) { el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump"); }
    const t0 = performance.now();
    const step = (t) => { const k = Math.min(1, (t - t0) / 900), e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(Math.round(from + (v - from) * e)); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
  const ago = (iso) => {
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return "Baru saja"; if (s < 3600) return Math.floor(s / 60) + " menit lalu"; if (s < 86400) return Math.floor(s / 3600) + " jam lalu";
    return Math.floor(s / 86400) < 7 ? Math.floor(s / 86400) + " hari lalu" : tgl(iso);
  };

  // ---------- acara berlangsung & berikutnya (mengikuti jadwal sesi) ----------
  const sameDay = (a, b) => wib(a).toISOString().slice(0, 10) === wib(b).toISOString().slice(0, 10);
  const whenNext = (s, t) => {
    const st = new Date(s.start).getTime(), tom = sameDay(st, t + 864e5);
    return `${sameDay(st, t) ? "Hari ini" : tom ? "Besok" : `Hari ${s.day}, ${tgl(s.start)}`} · ${hm(s.start)}`;
  };
  function renderNow() {
    if (!D) return;
    const t = Date.now(), list = D.sessions, total = D.paid;
    const cur = list.find((s) => new Date(s.start).getTime() <= t && t < new Date(s.end).getTime());
    const upcoming = list.filter((s) => new Date(s.start).getTime() > t);
    const fact = (label, val, cls = "") => val ? `<div class="fact ${cls}"><span>${label}</span><b>${val}</b></div>` : "";
    let html, tag;
    if (cur) {
      const checkin = cur.kind === "checkin";
      const facts = checkin
        ? fact("Sudah daftar ulang", `${fmt(cur.present)}<small>dari ${fmt(total)}</small>`, "num")
        : fact("Pembicara", esc(cur.speaker)) + fact("Topik", esc(cur.topic)) + fact("Peserta hadir", `${fmt(cur.present)}<small>dari ${fmt(total)}</small>`, "num");
      const n = (facts.match(/class="fact/g) || []).length;
      tag = `<span class="tag"><i></i>Sedang berlangsung</span>`;
      html = `<div class="title">${esc(cur.title)}</div>
        <div class="meta">Hari ${cur.day} · ${hm(cur.start)}–${hm(cur.end)}${cur.location ? " · " + esc(cur.location) : ""}</div>
        <div class="facts${n === 2 ? " two" : ""}"${n === 1 ? ' style="grid-template-columns:minmax(0,1fr)"' : ""}>${facts}</div>`;
    } else if (!list.length) {
      tag = `<span class="tag wait"><i></i>Belum ada jadwal</span>`;
      html = `<div class="meta">Tambahkan sesi di menu Jadwal &amp; kehadiran.</div>`;
    } else if (upcoming.length) {
      tag = `<span class="tag wait"><i></i>${upcoming[0] === list[0] ? "Belum dimulai" : "Jeda"}</span>`;
      html = `<div class="title">Belum ada acara</div><div class="meta">Acara berikutnya mulai ${whenNext(upcoming[0], t).toLowerCase()}.</div>`;
    } else {
      tag = `<span class="tag wait"><i></i>Selesai</span>`;
      html = `<div class="title">Semua acara selesai</div><div class="meta">Terima kasih!</div>`;
    }
    if ($("#now").innerHTML !== html) $("#now").innerHTML = html;
    if ($("#nowTag").innerHTML !== tag) $("#nowTag").innerHTML = tag;
    const nx = upcoming[0];
    const nhtml = nx ? `<div class="title">${esc(nx.title)}</div>
      <div class="meta">${whenNext(nx, t)}${nx.location ? " · " + esc(nx.location) : ""}</div>
      ${nx.speaker || nx.topic ? `<div class="meta">${esc([nx.speaker, nx.topic].filter(Boolean).join(" · "))}</div>` : ""}`
      : `<div class="meta">Tidak ada lagi acara.</div>`;
    if ($("#next").innerHTML !== nhtml) $("#next").innerHTML = nhtml;
  }
  setInterval(renderNow, 15000);

  // ---------- data ----------
  // Link khusus TV: /wallboard.html#k=KUNCI. Kunci disimpan di TV ini lalu dihapus dari alamat (tidak ikut terkirim ke server lewat URL).
  let key = "";
  try {
    const m = /[#&]k=([A-Za-z0-9_-]{20,})/.exec(location.hash);
    if (m) { key = m[1]; localStorage.setItem("rpk-wall-key", key); history.replaceState(null, "", location.pathname); }
    else key = localStorage.getItem("rpk-wall-key") || "";
  } catch (_) {}
  async function load() {
    try {
      const r = await fetch("/api/wallboard", { cache: "no-store", credentials: "same-origin", headers: key ? { "X-Wallboard-Key": key } : {} });
      if (r.status === 401 || r.status === 403) {
        if (key) { try { localStorage.removeItem("rpk-wall-key"); } catch (_) {} key = ""; }
        location.replace("/admin/login.html?next=" + encodeURIComponent("/wallboard.html")); return;
      }
      if (!r.ok) throw new Error("HTTP " + r.status);
      D = await r.json(); render(); $("#offline").hidden = true;
    } catch (_) { $("#offline").hidden = false; }
  }
  function render() {
    $("#evName").textContent = D.event.name || "PPD Antiokhia";
    $("#evSub").textContent = [D.event.dates_label, D.event.location].filter(Boolean).join(" · ");
    setNum($("#kPeserta"), D.participants); setNum($("#kGereja"), D.churches); setNum($("#kVisit"), D.visitors);

    const max = Math.max(1, ...D.top_churches.map((t) => t.n));
    $("#rank").innerHTML = D.top_churches.length ? D.top_churches.map((t, i) => `<li><span class="no">${i + 1}</span><span class="nm">${esc(t.church)}</span>
      <span class="n">${fmt(t.n)}</span><span class="bar"><i style="width:${(t.n / max) * 100}%"></i></span></li>`).join("") : `<li class="empty">Belum ada pendaftaran</li>`;

    $("#feed").innerHTML = D.recent.length ? D.recent.map((r) => `<li${lastIds && !lastIds.includes(r.id) ? ' class="new"' : ""}><span class="c">${esc(r.church)}</span>
      <span class="m">${fmt(r.n)} peserta · <span data-ago="${esc(r.created_at)}">${ago(r.created_at)}</span></span></li>`).join("") : `<li class="empty">Belum ada pendaftaran</li>`;
    lastIds = D.recent.map((r) => r.id);
    renderNow(); fit();
  }
  // Tampilkan hanya yang muat di layar
  function fit() {
    const rank = $("#rank"); [...rank.children].forEach((li) => (li.hidden = false));
    for (let i = rank.children.length - 1; i > 0 && rank.scrollHeight > rank.clientHeight + 1; i--) rank.children[i].hidden = true;
    const feed = $("#feed"), items = [...feed.children]; items.forEach((li) => (li.hidden = false));
    const per = Math.max(2, Math.floor(feed.clientWidth / Math.max(220, innerWidth / 6.5)));
    items.forEach((li, i) => (li.hidden = i >= per));
  }
  window.addEventListener("resize", () => D && fit());
  load(); setInterval(load, 20000);
  setInterval(() => document.querySelectorAll("[data-ago]").forEach((el) => (el.textContent = ago(el.dataset.ago))), 30000);

  // ---------- layar penuh, layar tetap menyala, kursor tersembunyi ----------
  $("#fsBtn").onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});
  document.addEventListener("fullscreenchange", () => { $("#fsBtn").hidden = !!document.fullscreenElement; });
  const keepAwake = async () => { try { if ("wakeLock" in navigator && !document.hidden) await navigator.wakeLock.request("screen"); } catch (_) {} };
  keepAwake(); document.addEventListener("visibilitychange", keepAwake);
  let idle; document.addEventListener("mousemove", () => { document.body.classList.remove("cursorless"); clearTimeout(idle); idle = setTimeout(() => document.body.classList.add("cursorless"), 3000); });
})();
