(function () {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const rupiah = (n) => "Rp" + Math.round(n).toLocaleString("id-ID");
  const pad = (n) => String(n).padStart(2, "0");
  const ROLE = { gembala: "Gembala sidang", peserta: "Peserta" };
  const THEMES = ["ember", "violet", "teal", "gold", "rose"];
  const icon = (id, size) => `<svg${size ? ` width="${size}" height="${size}"` : ""} aria-hidden="true"><use href="#i-${id}"/></svg>`;
  // Tanggal acara dihitung dalam WIB, apa pun zona waktu pengunjung
  const wib = (iso, addDays = 0) => { const d = new Date(new Date(iso).getTime() + 7 * 36e5 + addDays * 864e5); return Number.isNaN(d.getTime()) ? null : d; };
  const DAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

  let S = {}, churches = [], sessions = [], dayFilter = "all";
  const PH = window.RPKPhotos;
  // Foto hero dan kredit fotografer
  if (PH) {
    document.querySelectorAll("img[data-photo]").forEach((im) => {
      const p = PH.P[im.dataset.photo]; if (!p) return;
      im.onerror = () => im.remove();
      im.src = PH.url(p, 900);
    });
    const cr = document.getElementById("photoCredits"); if (cr) cr.innerHTML = PH.credits();
  }

  function toast(t) { const el = $("#toast"); if (!el) return; el.textContent = t; el.hidden = false; clearTimeout(el._t); el._t = setTimeout(() => (el.hidden = true), 2600); }

  // ---------- Data acara ----------
  fetch("/api/public", { cache: "no-cache" }).then((r) => r.json()).then(render).catch(() => {
    $("#sessionCards").innerHTML = `<div class="empty">Gagal memuat data acara. Muat ulang halaman.</div>`;
  });

  function render(data) {
    S = data.settings; churches = data.churches; sessions = data.sessions;
    document.title = S.event_name || document.title;
    $("#tagline").textContent = S.tagline;
    $("#title1").textContent = S.title_line1;
    $("#title2").textContent = S.title_line2;
    $("#datesLabel").textContent = S.dates_label || "Tanggal menyusul";
    $("#locationLabel").textContent = S.location || "Kalimantan Barat";
    $("#footName").textContent = S.event_name;
    $("#footContact").textContent = S.contact ? "Kontak panitia: " + S.contact : "";
    $("#feeLine").textContent = (S.fee_per_person ? rupiah(S.fee_per_person) + " per peserta" : "Biaya menyusul") + " · bayar tunai ke panitia";
    $("#cChurches").textContent = (S.est_churches || 40) + "+";
    const confirmed = data.stats.participants || 0;
    if (confirmed > 0) { $("#cPeople").textContent = confirmed; $("#cPeopleLabel").textContent = "peserta terkonfirmasi"; }
    else $("#cPeople").textContent = S.est_participants ? "±" + S.est_participants : "—";
    const start = new Date(S.start_at), end = new Date(S.end_at);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) $("#cDays").textContent = Math.max(1, Math.round((end - start) / 864e5) + 1);
    $("#cSeminars").textContent = sessions.filter((s) => s.kind === "seminar").length || "—";
    const d0 = wib(S.start_at);
    if (d0) $("#dateBig").innerHTML = `${DAYS[d0.getUTCDay()]}.<br>${d0.getUTCDate()} ${MONTHS[d0.getUTCMonth()]}`;
    if (S.spotify_url) $("#spotifyLink").href = S.spotify_url; else $("#spotifyLink").hidden = true;
    if (window.RPKMusic) window.RPKMusic.configure({ url: S.music_url, label: S.music_url ? "Musik retreat" : "Pad worship · musik latar retreat" });

    renderStrip(data.photos);
    renderLineup(data.lineup);
    renderTabs();
    renderSessions();
    renderResults(data.results);
    renderGallery(data.photos);
    if (!S.registration_open) { $("#feeLine").textContent = "Pendaftaran sedang ditutup. Hubungi panitia untuk informasi."; }
    tick(); setInterval(tick, 1000);
    if (window.StageArt) window.StageArt.attach();
  }

  // ---------- Hitung mundur ----------
  function tick() {
    const now = Date.now(), st = new Date(S.start_at).getTime(), en = new Date(S.end_at).getTime();
    const live = $("#liveMsg");
    if (now >= en) { $("#countdownBox").hidden = true; live.hidden = false; live.textContent = "Acara sudah selesai. Terima kasih untuk semua gereja yang hadir."; return; }
    if (now >= st) { $("#countdownBox").hidden = true; live.hidden = false; live.textContent = "Sedang berlangsung. Sampai jumpa di lokasi."; return; }
    const d = st - now;
    $("#cdD").textContent = Math.floor(d / 864e5);
    $("#cdH").textContent = pad(Math.floor(d / 36e5) % 24);
    $("#cdM").textContent = pad(Math.floor(d / 6e4) % 60);
    $("#cdS").textContent = pad(Math.floor(d / 1e3) % 60);
  }

  // ---------- Foto hero: pakai galeri bila sudah ada 3 foto ----------
  function renderStrip(photos) {
    if (!photos || photos.length < 3) return;
    $("#strip").innerHTML = photos.slice(0, 3).map((p) => `<div class="shot"><img src="${esc(p.url)}" alt=""></div>`).join("");
  }

  // ---------- Lineup ----------
  const TIER = { utama: "Pembicara utama", pembicara: "Pembicara", tamu: "Bintang tamu" };
  function renderLineup(list) {
    if (!list.length) return;
    $("#stage").innerHTML = list.map((p, i) => `
      <article class="scard">
        <canvas data-art data-seed="${101 + i * 17}" data-theme="${THEMES[(i + 2) % THEMES.length]}"></canvas>${PH ? PH.img(PH.lineup[i % PH.lineup.length], 800) : ""}
        <div>
          <div class="tags"><span class="tag${p.tier === "utama" ? " hot" : ""}">${TIER[p.tier]}</span>${p.note ? `<span class="tag">${esc(p.note)}</span>` : ""}</div>
          <h3>${esc(p.name)}</h3>
          <p>${p.tier === "tamu" ? "Ikut mengisi malam ibadah bersama seluruh peserta." : "Membawakan sesi selama retreat. Lihat jadwalnya di atas."}</p>
        </div>
        <span></span>
        <div class="acts">
          <a class="big-btn btn" href="#jadwal" aria-label="Lihat jadwal">${icon("cal")}</a>
          <button type="button" class="icon-btn" data-share="${esc(p.name)}" aria-label="Bagikan">${icon("share")}</button>
        </div>
      </article>`).join("");
    $("#stage").onclick = async (e) => {
      const b = e.target.closest("[data-share]"); if (!b) return;
      const text = `${b.dataset.share} di ${S.event_name}. Daftar: ${location.origin}/#daftar`;
      try {
        if (navigator.share) await navigator.share({ title: S.event_name, text });
        else { await navigator.clipboard.writeText(text); toast("Tautan disalin"); }
      } catch (_) {}
    };
  }

  // ---------- Jadwal sebagai kartu sesi ----------
  function renderTabs() {
    const days = [...new Set(sessions.map((s) => s.day))].sort((a, b) => a - b);
    const tabs = [["all", "Semua"], ...days.map((d) => [String(d), `Hari ${d}`]), ...(sessions.some((s) => s.kind === "checkin") ? [["checkin", "Registrasi"]] : [])];
    $("#dayTabs").innerHTML = tabs.map(([k, t]) => `<button type="button" role="tab" data-k="${k}" aria-selected="${k === dayFilter}">${t}</button>`).join("");
    $("#dayTabs").onclick = (e) => {
      const b = e.target.closest("[data-k]"); if (!b) return;
      dayFilter = b.dataset.k;
      [...$("#dayTabs").children].forEach((x) => x.setAttribute("aria-selected", String(x === b)));
      renderSessions();
    };
  }
  let qt;
  $("#sessQ").addEventListener("input", () => { clearTimeout(qt); qt = setTimeout(renderSessions, 120); });
  function renderSessions() {
    const q = $("#sessQ").value.trim().toLowerCase();
    const list = sessions.filter((s) =>
      (dayFilter === "all" || (dayFilter === "checkin" ? s.kind === "checkin" : String(s.day) === dayFilter)) &&
      (!q || [s.title, s.speaker, s.location].some((x) => String(x || "").toLowerCase().includes(q))));
    const box = $("#sessionCards");
    if (!sessions.length) { box.innerHTML = `<div class="empty">Jadwal sesi diumumkan segera.</div>`; return; }
    if (!list.length) { box.innerHTML = `<div class="empty">Tidak ada sesi yang cocok.</div>`; return; }
    box.innerHTML = list.map((s) => {
      const d = wib(S.start_at, s.day - 1);
      return `<article class="ecard">
        <canvas data-art data-seed="${s.id * 31 + 5}" data-theme="${THEMES[s.id % THEMES.length]}"></canvas>${PH ? PH.img(PH.sessions[(s.id - 1) % PH.sessions.length], 900) : ""}
        <div class="row">
          <span class="kind">${icon("ticket")}${s.kind === "checkin" ? "Registrasi ulang" : "Seminar"} · Hari ${s.day}</span>
          ${s.starts_at ? `<span class="time"><b>${esc(s.starts_at)}</b><small>WIB${s.ends_at ? " · s.d. " + esc(s.ends_at) : ""}</small></span>` : ""}
        </div>
        <h3>${esc(s.title)}${s.speaker ? `<br><small style="font-size:.8em;font-weight:500;opacity:.85">${esc(s.speaker)}</small>` : ""}</h3>
        <div class="foot">${s.location ? `<span class="place">${icon("loc")}<span>${esc(s.location)}</span></span>` : ""}</div>
        ${d ? `<span class="dot-date"><b>${d.getUTCDate()}</b><small>${MONTHS[d.getUTCMonth()]}</small></span>` : ""}
      </article>`;
    }).join("");
    if (window.StageArt) window.StageArt.attach(box);
  }

  // ---------- Skor ----------
  function renderResults(res) {
    const card = (title, formula, body) => `<div class="award"><h3>${title}</h3><p class="formula">${formula}</p>${body}</div>`;
    const locked = `<div class="locked">${icon("lock")}<b>Belum dibuka</b><span>Diumumkan setelah semua data kehadiran tersinkron.</span></div>`;
    const list = (rows, val) => rows.length
      ? `<ol class="rank">${rows.map((r, i) => `<li><span class="pos">${i + 1}</span><span>${esc(r.church)}</span><span class="val">${esc(val(r))}</span></li>`).join("")}</ol>`
      : `<div class="locked"><span>Belum ada data.</span></div>`;
    if (!res) {
      $("#awardGrid").innerHTML =
        card("Gereja dengan peserta terbanyak", "Jumlah peserta yang tercatat hadir di lokasi.", locked) +
        card("Gereja paling aktif seminar", "Rata-rata sesi seminar yang dihadiri per peserta, supaya gereja kecil punya peluang yang sama.", locked);
      return;
    }
    $("#scoreTitle").innerHTML = "Papan skor <b>akhir</b>";
    $("#scoreLede").textContent = "Hasil dihitung dari scan kehadiran selama acara dan sudah diverifikasi panitia.";
    $("#awardGrid").innerHTML =
      card("Gereja dengan peserta terbanyak", "Jumlah peserta yang tercatat hadir di lokasi.", list(res.most_participants, (r) => `${r.present} orang`)) +
      card("Gereja paling aktif seminar", `Rata-rata sesi seminar per peserta, dari ${res.seminar_count} sesi.`, list(res.most_active, (r) => `${String(r.seminar_per_person).replace(".", ",")} sesi`));
    const groups = {};
    for (const c of res.contests) (groups[c.contest] ||= []).push(c);
    $("#contests").innerHTML = Object.entries(groups).map(([name, rows]) => `<div class="contest"><h3>${esc(name)}</h3><ol>${rows.map((r) =>
      `<li><b>${r.rank}</b><div>${esc(r.winner)}${r.church && r.church !== r.winner ? `<small>${esc(r.church)}</small>` : ""}</div></li>`).join("")}</ol></div>`).join("");
  }

  // ---------- Galeri ----------
  function renderGallery(photos) {
    if (!photos.length) return;
    $("#galeri").hidden = false;
    $("#gallery").innerHTML = photos.map((p) => `<figure><img src="${esc(p.url)}" alt="${esc(p.caption || "Dokumentasi retreat")}" loading="lazy"${p.width && p.height ? ` width="${p.width}" height="${p.height}"` : ""}>${p.caption ? `<figcaption>${esc(p.caption)}</figcaption>` : ""}</figure>`).join("");
  }

})();
