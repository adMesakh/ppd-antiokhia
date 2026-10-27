// Meja panitia (dashboard admin). Satu file, tanpa framework, supaya mudah diubah.
(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const rupiah = (n) => "Rp" + Math.round(n || 0).toLocaleString("id-ID");
  const fmtTime = (iso) => iso ? new Date(iso).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
  const ROLE = { gembala: "Gembala sidang", peserta: "Peserta" };
  const GENDER = { L: "Laki-laki", P: "Perempuan" };
  const STATUS = { menunggu: "Menunggu", lunas: "Lunas", batal: "Batal" };
  const KIND = { checkin: "Check-in", seminar: "Seminar" };
  const view = $("#view");
  let me = null;
  let cache = { churches: null, sessions: null };

  // ---------- API ----------
  async function api(method, url, body) {
    const res = await fetch(url, {
      method, credentials: "same-origin",
      headers: { "X-RPK": "1", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (res.status === 401) { showLogin(); throw new Error("Sesi berakhir. Silakan login lagi."); }
    if (!res.ok) { const e = new Error(data?.error || "Terjadi kesalahan."); e.status = res.status; throw e; }
    return data;
  }
  const GET = (u) => api("GET", u), POST = (u, b) => api("POST", u, b ?? {}), PUT = (u, b) => api("PUT", u, b), PATCH = (u, b) => api("PATCH", u, b), DEL = (u) => api("DELETE", u);

  function toast(msg, isErr) {
    const t = $("#toast"); t.textContent = msg; t.className = "toast" + (isErr ? " err" : ""); t.hidden = false;
    clearTimeout(t._t); t._t = setTimeout(() => (t.hidden = true), isErr ? 5000 : 2600);
  }
  const fail = (e) => toast(e.message || "Terjadi kesalahan.", true);

  // ---------- Dialog ----------
  const dlg = $("#dlg");
  function openDialog(html, { narrow } = {}) {
    $("#dlgBody").innerHTML = `<div class="dlg-inner">${html}</div>`;
    dlg.className = "dlg" + (narrow ? " narrow" : "");
    if (!dlg.open) dlg.showModal();
    return $("#dlgBody");
  }
  function closeDialog() { if (dlg.open) dlg.close(); }
  dlg.addEventListener("click", (e) => { if (e.target === dlg || e.target.closest("[data-close]")) closeDialog(); });
  function confirmBox(title, text, okLabel = "Ya, lanjutkan", danger = true) {
    return new Promise((resolve) => {
      const body = openDialog(`<div class="dlg-head"><h2>${esc(title)}</h2></div><p>${esc(text)}</p>
        <div class="dlg-foot"><button class="btn" data-no>Batal</button><button class="btn ${danger ? "danger" : "primary"}" data-yes>${esc(okLabel)}</button></div>`, { narrow: true });
      const done = (v) => { dlg.removeEventListener("close", onClose); closeDialog(); resolve(v); };
      const onClose = () => resolve(false);
      dlg.addEventListener("close", onClose, { once: true });
      $("[data-yes]", body).onclick = () => done(true);
      $("[data-no]", body).onclick = () => done(false);
    });
  }

  // ---------- Sesi login (halaman login terpisah: /admin/login.html) ----------
  function showLogin() {
    const next = location.pathname + location.hash;
    location.replace("/admin/login.html?next=" + encodeURIComponent(next));
  }
  $("#logoutBtn").onclick = async () => { try { await fetch("/api/auth/logout", { method: "POST" }); } catch (_) {} location.replace("/admin/login.html?keluar=1"); };

  async function boot() {
    try { const r = await fetch("/api/auth/me"); if (!r.ok) return showLogin(); me = (await r.json()).user; if (me.role !== "admin") return showLogin(); start(); }
    catch (_) { showLogin(); }
  }
  function start() {
    $("#app").hidden = false;
    $("#whoami").textContent = me.name;
    route();
  }

  // ---------- Router ----------
  const VIEWS = {};
  window.addEventListener("hashchange", route);
  async function route() {
    const [name, arg] = (location.hash.slice(1) || "ringkasan").split("/");
    const fn = VIEWS[name] || VIEWS.ringkasan;
    $$(".side a").forEach((a) => a.classList.toggle("on", a.dataset.nav === (VIEWS[name] ? name : "ringkasan")));
    view.onclick = null; view.onchange = null; // lepaskan handler dari halaman sebelumnya
    view.innerHTML = `<p class="muted">Memuat…</p>`;
    try { await fn(arg); } catch (e) { if (e.status !== 401) view.innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
    refreshBadge();
  }
  async function refreshBadge() {
    try { const s = await GET("/api/admin/summary"); const n = s.registrations.waiting; const b = $("#navWaiting"); b.textContent = n; b.hidden = !n; } catch (_) {}
  }
  async function churches(force) { if (!cache.churches || force) cache.churches = await GET("/api/admin/churches"); return cache.churches; }
  async function sessions(force) { if (!cache.sessions || force) cache.sessions = await GET("/api/admin/sessions"); return cache.sessions; }
  const churchOptions = (list, sel, blank = "Pilih gereja") => `<option value="">${blank}</option>` + list.map((c) => `<option value="${c.id}"${String(sel) === String(c.id) ? " selected" : ""}>${esc(c.name)}${c.city ? " · " + esc(c.city) : ""}</option>`).join("");

  // =====================================================================
  // RINGKASAN
  // =====================================================================
  VIEWS.ringkasan = async () => {
    const s = await GET("/api/admin/summary");
    view.innerHTML = `
      <div class="head"><div><h1>Ringkasan</h1><p class="muted">Kondisi pendaftaran dan kehadiran saat ini.</p></div>
        <div class="head-actions"><a class="btn" href="#pendaftaran">Buka pendaftaran</a><a class="btn primary" href="/admin/print.html" target="_blank">Cetak semua ID card</a></div></div>
      <div class="tiles">
        <a class="tile ${s.registrations.waiting ? "alert" : ""}" href="#pendaftaran" style="text-decoration:none"><b>${s.registrations.waiting}</b><span>pendaftaran menunggu bayar</span><small>${s.participants.waiting} peserta · ${rupiah(s.money.outstanding)}</small></a>
        <div class="tile"><b>${s.participants.paid}</b><span>peserta lunas</span><small>${s.registrations.paid} pendaftaran</small></div>
        <div class="tile"><b>${s.churches.paid}<span style="font-size:1.2rem;color:var(--muted)"> / ${s.churches.total}</span></b><span>gereja sudah lunas</span></div>
        <div class="tile"><b>${s.participants.pastors}</b><span>gembala sidang</span></div>
        <div class="tile"><b>${s.participants.male} · ${s.participants.female}</b><span>laki-laki · perempuan</span></div>
        <div class="tile"><b style="font-size:1.6rem">${rupiah(s.money.received)}</b><span>uang diterima</span></div>
        <div class="tile"><b>${s.attendance.scans}</b><span>scan kehadiran masuk</span><small>${s.attendance.people} orang · terakhir ${fmtTime(s.attendance.last)}</small></div>
      </div>
      <div class="card"><div class="card-head"><h3>Pendaftaran terbaru</h3><a class="btn sm" href="#pendaftaran">Lihat semua</a></div>
        ${s.recent.length ? `<div class="table-wrap"><table><thead><tr><th>Kode</th><th>Gereja</th><th>Peserta</th><th>Masuk</th><th>Status</th></tr></thead><tbody>
        ${s.recent.map((r) => `<tr><td class="mono">${esc(r.code)}</td><td>${esc(r.church)}</td><td class="num">${r.n}</td><td>${fmtTime(r.created_at)}</td><td><span class="pill ${r.status}">${STATUS[r.status]}</span></td></tr>`).join("")}
        </tbody></table></div>` : `<p class="empty">Belum ada pendaftaran. Pastikan daftar gereja sudah diisi di menu Gereja.</p>`}
      </div>`;
  };

  // =====================================================================
  // PENDAFTARAN
  // =====================================================================
  let regFilter = "menunggu", regQuery = "";
  VIEWS.pendaftaran = async (arg) => {
    view.innerHTML = `
      <div class="head"><div><h1>Pendaftaran</h1><p class="muted">Tandai lunas setelah uang tunai diterima. QR peserta langsung terbit.</p></div>
        <div class="head-actions"><button class="btn primary" id="newReg">+ Pendaftaran oleh admin</button></div></div>
      <div class="toolbar">
        <div class="seg" id="regSeg">${["menunggu", "lunas", "batal", ""].map((s) => `<button data-s="${s}" class="${regFilter === s ? "on" : ""}">${s ? STATUS[s] : "Semua"}</button>`).join("")}</div>
        <input type="search" id="regQ" placeholder="Cari kode, gereja, koordinator, WA" value="${esc(regQuery)}">
      </div>
      <div id="regTable"></div>`;
    $("#regSeg").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; regFilter = b.dataset.s; $$("#regSeg button").forEach((x) => x.classList.toggle("on", x === b)); loadRegs(); };
    let t; $("#regQ").oninput = (e) => { clearTimeout(t); t = setTimeout(() => { regQuery = e.target.value; loadRegs(); }, 250); };
    $("#newReg").onclick = () => regForm();
    await loadRegs();
    if (arg) openReg(Number(arg));
  };
  async function loadRegs() {
    const q = new URLSearchParams(); if (regFilter) q.set("status", regFilter); if (regQuery) q.set("q", regQuery);
    const list = await GET("/api/admin/registrations?" + q);
    $("#regTable").innerHTML = list.length ? `<div class="table-wrap"><table><thead><tr><th>Kode</th><th>Gereja</th><th>Koordinator</th><th>Peserta</th><th>Tagihan</th><th>Masuk</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map((r) => `<tr>
        <td class="mono">${esc(r.code)}${r.source === "admin" ? `<span class="sub">oleh admin</span>` : ""}</td>
        <td>${esc(r.church)}<span class="sub">${esc(r.city)}</span></td>
        <td>${esc(r.coordinator)}<span class="sub mono">${esc(r.phone)}</span></td>
        <td class="num">${r.n}${r.pastors ? `<span class="sub">${r.pastors} gembala</span>` : ""}</td>
        <td class="num">${r.fee_per_person ? rupiah(r.n * r.fee_per_person) : "—"}</td>
        <td>${fmtTime(r.created_at)}</td>
        <td><span class="pill ${r.status}">${STATUS[r.status]}</span>${r.confirmed_by_name ? `<span class="sub">oleh ${esc(r.confirmed_by_name)}</span>` : ""}</td>
        <td class="actions">${r.status === "menunggu" ? `<button class="btn tapeb sm" data-pay="${r.id}" data-code="${esc(r.code)}" data-total="${r.n * r.fee_per_person}">Tandai lunas</button> ` : ""}<button class="btn sm" data-open="${r.id}">Detail</button></td>
      </tr>`).join("")}</tbody></table></div>`
      : `<div class="card empty">Tidak ada pendaftaran${regFilter ? " dengan status " + STATUS[regFilter].toLowerCase() : ""}.</div>`;
    $("#regTable").onclick = async (e) => {
      const pay = e.target.closest("[data-pay]"), open = e.target.closest("[data-open]");
      if (pay) {
        const total = Number(pay.dataset.total);
        if (!(await confirmBox("Tandai lunas?", `Pendaftaran ${pay.dataset.code}${total ? ` senilai ${rupiah(total)}` : ""} akan ditandai lunas dan QR peserta terbit.`, "Tandai lunas", false))) return;
        try { await PATCH(`/api/admin/registrations/${pay.dataset.pay}/status`, { status: "lunas" }); toast("Ditandai lunas"); loadRegs(); refreshBadge(); } catch (x) { fail(x); }
      }
      if (open) openReg(Number(open.dataset.open));
    };
  }

  async function openReg(id) {
    const r = await GET(`/api/admin/registrations/${id}`);
    const total = r.participants.length * r.fee_per_person;
    const body = openDialog(`
      <div class="dlg-head"><div style="display:grid;gap:6px"><span class="muted">Pendaftaran</span><h2 class="mono" style="font-family:var(--mono);font-size:1.4rem">${esc(r.code)}</h2></div>
        <div style="display:flex;gap:8px;align-items:center"><span class="pill ${r.status}">${STATUS[r.status]}</span><button class="btn ghost sm" data-close aria-label="Tutup">✕</button></div></div>
      <dl class="kv">
        <dt>Gereja</dt><dd>${esc(r.church.name)}${r.church.city ? ", " + esc(r.church.city) : ""}</dd>
        <dt>Koordinator</dt><dd>${esc(r.coordinator)} · <span class="mono">${esc(r.phone)}</span></dd>
        <dt>Tagihan</dt><dd>${r.participants.length} × ${rupiah(r.fee_per_person)} = <b>${rupiah(total)}</b></dd>
        <dt>Masuk</dt><dd>${fmtTime(r.created_at)}${r.confirmed_at ? ` · lunas ${fmtTime(r.confirmed_at)}` : ""}</dd>
        <dt>Tautan status</dt><dd><a href="${esc(r.status_url)}" target="_blank" rel="noopener">${esc(location.origin + r.status_url)}</a></dd>
        ${r.note ? `<dt>Catatan</dt><dd>${esc(r.note)}</dd>` : ""}
      </dl>
      <div class="table-wrap"><table><thead><tr><th>#</th><th>Nama</th><th>Status</th><th>Jenis kelamin</th><th>Scan</th><th></th></tr></thead><tbody>
        ${r.participants.map((p) => `<tr><td class="num">${p.seq}</td><td>${esc(p.name)}<span class="sub mono">${esc(p.code)}</span></td><td><span class="role ${p.role}">${ROLE[p.role]}</span></td><td>${GENDER[p.gender] || "-"}</td><td class="num">${p.scans}</td>
          <td class="actions"><button class="btn sm" data-edit-p="${p.id}">Ubah</button> <button class="btn sm danger" data-del-p="${p.id}" ${p.scans ? "disabled title='Sudah punya data kehadiran'" : ""}>Hapus</button></td></tr>`).join("")}
      </tbody></table></div>
      <div><button class="btn sm" data-add-p>+ Tambah peserta</button></div>
      <div class="dlg-foot">
        <button class="btn danger" data-delete-reg>Hapus pendaftaran</button>
        <button class="btn" data-edit-reg>Ubah data koordinator</button>
        ${r.status !== "batal" ? `<button class="btn" data-status="batal">Batalkan</button>` : ""}
        ${r.status !== "menunggu" ? `<button class="btn" data-status="menunggu">Kembalikan ke menunggu</button>` : ""}
        ${r.status === "lunas" ? `<a class="btn" href="/admin/print.html?registration_id=${r.id}" target="_blank">Cetak ID card</a>` : ""}
        ${r.status !== "lunas" ? `<button class="btn primary" data-status="lunas">Tandai lunas</button>` : ""}
      </div>`);
    const reload = () => { openReg(id); if (location.hash.startsWith("#pendaftaran")) loadRegs(); refreshBadge(); };
    body.onclick = async (e) => {
      const st = e.target.closest("[data-status]");
      try {
        if (st) {
          const s = st.dataset.status;
          if (s === "batal" && !(await confirmBox("Batalkan pendaftaran?", "Peserta di pendaftaran ini tidak akan bisa di-scan.", "Batalkan"))) return openReg(id);
          await PATCH(`/api/admin/registrations/${id}/status`, { status: s }); toast(`Status: ${STATUS[s]}`); reload();
        } else if (e.target.closest("[data-edit-p]")) {
          const p = r.participants.find((x) => x.id === Number(e.target.closest("[data-edit-p]").dataset.editP));
          participantForm(p, async (v) => { await PUT(`/api/admin/participants/${p.id}`, v); toast("Peserta diperbarui"); reload(); }, () => openReg(id));
        } else if (e.target.closest("[data-del-p]")) {
          const pid = e.target.closest("[data-del-p]").dataset.delP;
          if (!(await confirmBox("Hapus peserta?", "Data peserta ini akan dihapus permanen.", "Hapus"))) return openReg(id);
          await DEL(`/api/admin/participants/${pid}`); toast("Peserta dihapus"); reload();
        } else if (e.target.closest("[data-add-p]")) {
          participantForm(null, async (v) => { await POST(`/api/admin/registrations/${id}/participants`, v); toast("Peserta ditambahkan"); reload(); }, () => openReg(id));
        } else if (e.target.closest("[data-edit-reg]")) {
          const b2 = openDialog(`<div class="dlg-head"><h2>Ubah data koordinator</h2></div>
            <form id="f" class="form-grid">
              <label>Nama koordinator<input name="coordinator" value="${esc(r.coordinator)}"></label>
              <label>Nomor WhatsApp<input name="phone" value="${esc(r.phone)}"></label>
              <label>Biaya per peserta (Rp)<input name="fee_per_person" type="number" min="0" step="1000" value="${r.fee_per_person}"></label>
              <label class="span2">Catatan admin<input name="note" value="${esc(r.note)}"></label>
              <div class="dlg-foot span2" style="grid-column:1/-1"><button type="button" class="btn" data-back>Kembali</button><button class="btn primary">Simpan</button></div></form>`, { narrow: false });
          $("[data-back]", b2).onclick = () => openReg(id);
          $("#f", b2).onsubmit = async (ev) => { ev.preventDefault(); try { await PUT(`/api/admin/registrations/${id}`, Object.fromEntries(new FormData(ev.target))); toast("Tersimpan"); reload(); } catch (x) { fail(x); } };
        } else if (e.target.closest("[data-delete-reg]")) {
          if (!(await confirmBox("Hapus pendaftaran?", "Pendaftaran dan semua pesertanya dihapus permanen. Untuk pendaftaran yang batal bayar, lebih baik pakai Batalkan.", "Hapus permanen"))) return openReg(id);
          await DEL(`/api/admin/registrations/${id}`); toast("Pendaftaran dihapus"); closeDialog(); if (location.hash.startsWith("#pendaftaran")) loadRegs(); refreshBadge();
        }
      } catch (x) { fail(x); }
    };
  }

  function participantRowHtml(p = {}, i = 0) {
    return `<div class="prow" data-row>
      <input name="name" placeholder="Nama lengkap" value="${esc(p.name || "")}" aria-label="Nama peserta ${i + 1}">
      <select name="role" aria-label="Status"><option value="peserta"${p.role !== "gembala" ? " selected" : ""}>Peserta</option><option value="gembala"${p.role === "gembala" ? " selected" : ""}>Gembala sidang</option></select>
      <select name="gender" aria-label="Jenis kelamin"><option value="" disabled hidden${p.gender ? "" : " selected"}>Jenis kelamin</option><option value="L"${p.gender === "L" ? " selected" : ""}>Laki-laki</option><option value="P"${p.gender === "P" ? " selected" : ""}>Perempuan</option></select>
      <button type="button" class="btn ghost sm" data-rm aria-label="Hapus baris">✕</button></div>`;
  }
  const readRow = (row) => ({ name: $("[name=name]", row).value, role: $("[name=role]", row).value, gender: $("[name=gender]", row).value });

  function participantForm(p, onSave, onBack) {
    const body = openDialog(`<div class="dlg-head"><h2>${p ? "Ubah peserta" : "Tambah peserta"}</h2></div>
      <form id="pf" style="display:grid;gap:12px">${participantRowHtml(p || {})}
      <div class="dlg-foot"><button type="button" class="btn" data-back>Kembali</button><button class="btn primary">Simpan</button></div></form>`);
    $("[data-rm]", body).hidden = true;
    $("[data-back]", body).onclick = onBack;
    $("#pf", body).onsubmit = async (e) => { e.preventDefault(); try { await onSave(readRow($("[data-row]", body))); } catch (x) { fail(x); } };
  }

  async function regForm() {
    const list = await churches();
    const fee = (await GET("/api/admin/settings")).fee_per_person;
    const body = openDialog(`<div class="dlg-head"><div><h2>Pendaftaran oleh admin</h2><p class="muted">Untuk gereja yang mendaftar lewat telepon atau datang langsung.</p></div><button class="btn ghost sm" data-close>✕</button></div>
      <form id="rf" style="display:grid;gap:14px">
        <div class="form-grid">
          <label>Gereja<select name="church_id" required>${churchOptions(list)}</select></label>
          <label>Koordinator<input name="coordinator" placeholder="Opsional"></label>
          <label>Nomor WhatsApp<input name="phone" placeholder="Opsional"></label>
          <label>Biaya per peserta (Rp)<input name="fee_per_person" type="number" min="0" step="1000" value="${fee}"></label>
        </div>
        <div style="display:grid;gap:8px" id="rows">${participantRowHtml({}, 0)}</div>
        <div><button type="button" class="btn sm" id="addRow">+ Baris peserta</button></div>
        <label class="check"><input type="checkbox" name="lunas" checked> Langsung tandai lunas (uang sudah diterima)</label>
        <div class="dlg-foot"><button type="button" class="btn" data-close>Batal</button><button class="btn primary">Simpan pendaftaran</button></div>
      </form>`);
    $("#addRow", body).onclick = () => { $("#rows", body).insertAdjacentHTML("beforeend", participantRowHtml({}, $$("[data-row]", body).length)); $$("[data-row] [name=name]", body).pop().focus(); };
    $("#rows", body).onclick = (e) => { if (e.target.closest("[data-rm]") && $$("[data-row]", body).length > 1) e.target.closest("[data-row]").remove(); };
    $("#rf", body).onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const participants = $$("[data-row]", body).map(readRow).filter((p) => p.name.trim());
      try {
        const r = await POST("/api/admin/registrations", { church_id: Number(f.get("church_id")), coordinator: f.get("coordinator"), phone: f.get("phone"), fee_per_person: Number(f.get("fee_per_person")), status: f.get("lunas") ? "lunas" : "menunggu", participants });
        toast(`Tersimpan: ${r.code}`); closeDialog(); if (location.hash.startsWith("#pendaftaran")) loadRegs(); refreshBadge();
      } catch (x) { fail(x); }
    };
  }

  // =====================================================================
  // PESERTA & QR
  // =====================================================================
  let pState = { q: "", church: "", status: "lunas" };
  VIEWS.peserta = async () => {
    const list = await churches();
    view.innerHTML = `
      <div class="head"><div><h1>Peserta &amp; QR</h1><p class="muted">QR hanya berlaku untuk peserta yang pendaftarannya lunas.</p></div>
        <div class="head-actions"><a class="btn" href="/api/admin/export/participants.csv">Unduh CSV</a><button class="btn primary" id="printSel">Cetak ID card</button></div></div>
      <div class="toolbar">
        <input type="search" id="pQ" placeholder="Cari nama atau kode" value="${esc(pState.q)}">
        <select id="pChurch">${churchOptions(list, pState.church, "Semua gereja")}</select>
        <select id="pStatus"><option value="lunas"${pState.status === "lunas" ? " selected" : ""}>Lunas</option><option value="menunggu"${pState.status === "menunggu" ? " selected" : ""}>Menunggu</option><option value=""${!pState.status ? " selected" : ""}>Semua status</option></select>
        <span class="muted" id="pCount"></span>
      </div>
      <div id="pTable"></div>`;
    let t;
    $("#pQ").oninput = (e) => { clearTimeout(t); t = setTimeout(() => { pState.q = e.target.value; loadP(); }, 250); };
    $("#pChurch").onchange = (e) => { pState.church = e.target.value; loadP(); };
    $("#pStatus").onchange = (e) => { pState.status = e.target.value; loadP(); };
    $("#printSel").onclick = () => {
      const ids = $$("[data-sel]:checked").map((c) => c.value);
      const q = new URLSearchParams();
      if (ids.length) q.set("ids", ids.join(",")); else if (pState.church) q.set("church_id", pState.church);
      window.open("/admin/print.html?" + q, "_blank");
    };
    await loadP();
  };
  async function loadP() {
    const q = new URLSearchParams(); if (pState.q) q.set("q", pState.q); if (pState.church) q.set("church_id", pState.church); if (pState.status) q.set("status", pState.status);
    const list = await GET("/api/admin/participants?" + q);
    $("#pCount").textContent = `${list.length} peserta`;
    $("#printSel").textContent = "Cetak ID card";
    $("#pTable").innerHTML = list.length ? `<div class="table-wrap"><table><thead><tr><th><input type="checkbox" id="selAll" aria-label="Pilih semua"></th><th>Nama</th><th>Status</th><th>Gereja</th><th>Jenis kelamin</th><th>Pendaftaran</th><th>Scan</th><th></th></tr></thead><tbody>
      ${list.map((p) => `<tr><td>${p.status === "lunas" ? `<input type="checkbox" data-sel value="${p.id}" aria-label="Pilih ${esc(p.name)}">` : ""}</td>
        <td>${esc(p.name)}<span class="sub mono">${esc(p.code)}</span></td><td><span class="role ${p.role}">${ROLE[p.role]}</span></td><td>${esc(p.church)}</td>
        <td>${GENDER[p.gender] || "-"}</td><td><a href="#pendaftaran/${p.registration_id}" class="mono">${esc(p.registration_code)}</a> <span class="pill ${p.status}">${STATUS[p.status]}</span></td><td class="num">${p.scans}</td>
        <td class="actions">${p.status === "lunas" ? `<button class="btn sm" data-qr="${p.id}">Lihat QR</button>` : `<span class="muted">QR belum terbit</span>`}</td></tr>`).join("")}
      </tbody></table></div>` : `<div class="card empty">Tidak ada peserta yang cocok.</div>`;
    const sel = $("#selAll");
    if (sel) sel.onchange = () => { $$("[data-sel]").forEach((c) => (c.checked = sel.checked)); updSel(); };
    $("#pTable").onchange = (e) => { if (e.target.matches("[data-sel]")) updSel(); };
    function updSel() { const n = $$("[data-sel]:checked").length; $("#printSel").textContent = n ? `Cetak ${n} ID card` : "Cetak ID card"; }
    $("#pTable").onclick = (e) => {
      const b = e.target.closest("[data-qr]"); if (!b) return;
      const p = list.find((x) => x.id === Number(b.dataset.qr));
      showQr(p);
    };
  }
  function showQr(p) {
    const body = openDialog(`<div class="dlg-head"><h2>QR peserta</h2><button class="btn ghost sm" data-close>✕</button></div>
      <div class="qrbig"><img src="/api/qr/${encodeURIComponent(p.qr_token)}.svg?v=${Date.now()}" alt="QR ${esc(p.name)}"><b style="font-size:1.1rem">${esc(p.name)}</b><span class="muted">${esc(p.church)} · ${ROLE[p.role]}</span><span class="mono">${esc(p.code)}</span></div>
      <p class="muted">Jika ID card hilang, terbitkan QR baru. QR lama langsung tidak berlaku setelah scanner mengunduh ulang data.</p>
      <div class="dlg-foot"><button class="btn danger" data-reissue>Terbitkan QR baru</button><a class="btn" href="/admin/print.html?ids=${p.id}" target="_blank">Cetak ID card</a><button class="btn primary" data-close>Selesai</button></div>`, { narrow: true });
    $("[data-reissue]", body).onclick = async () => {
      if (!(await confirmBox("Terbitkan QR baru?", "QR lama tidak akan dikenali lagi. Cetak ulang ID card peserta ini.", "Terbitkan"))) return showQr(p);
      try { await POST(`/api/admin/participants/${p.id}/reissue`); toast("QR baru terbit"); closeDialog(); loadP(); } catch (x) { fail(x); }
    };
  }

  // =====================================================================
  // GEREJA
  // =====================================================================
  VIEWS.gereja = async () => {
    const list = await churches(true);
    view.innerHTML = `
      <div class="head"><div><h1>Gereja</h1><p class="muted">Daftar ini muncul sebagai pilihan di formulir pendaftaran. ${list.length} gereja.</p></div></div>
      <div class="grid2">
        <form class="card" id="cOne"><h3>Tambah satu gereja</h3>
          <div class="form-grid"><label>Nama gereja<input name="name" placeholder="mis. GKII Jemaat Sungai Raya" required></label><label>Kabupaten / kota<input name="city" placeholder="mis. Kubu Raya"></label></div>
          <div><button class="btn primary">Tambah</button></div></form>
        <form class="card" id="cBulk"><h3>Tempel banyak sekaligus</h3>
          <label>Satu gereja per baris, format <span class="mono">Nama, Kota</span><textarea name="bulk" placeholder="GKII Jemaat Sungai Raya, Kubu Raya&#10;GPdI Siloam, Pontianak"></textarea><span class="hint">Bisa disalin langsung dari Excel (kolom nama dan kota). Nama yang sudah ada dilewati.</span></label>
          <div><button class="btn primary">Tambahkan semua</button></div></form>
      </div>
      ${list.length ? `<div class="table-wrap"><table><thead><tr><th>Gereja</th><th>Kota</th><th>Pendaftaran</th><th>Peserta lunas</th><th></th></tr></thead><tbody>
      ${list.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.city)}</td><td class="num">${c.registrations}</td><td class="num">${c.paid_participants}</td>
        <td class="actions"><button class="btn sm" data-edit="${c.id}">Ubah</button> <button class="btn sm danger" data-del="${c.id}" ${c.registrations ? "disabled title='Sudah punya pendaftaran'" : ""}>Hapus</button></td></tr>`).join("")}
      </tbody></table></div>` : `<div class="card empty">Belum ada gereja. Tambahkan di atas supaya formulir pendaftaran bisa dipakai.</div>`}`;
    $("#cOne").onsubmit = async (e) => { e.preventDefault(); try { const r = await POST("/api/admin/churches", Object.fromEntries(new FormData(e.target))); toast(r.added ? "Gereja ditambahkan" : "Nama sudah ada"); VIEWS.gereja(); } catch (x) { fail(x); } };
    $("#cBulk").onsubmit = async (e) => { e.preventDefault(); try { const r = await POST("/api/admin/churches", { bulk: new FormData(e.target).get("bulk") }); toast(`${r.added} ditambahkan, ${r.skipped} dilewati`); VIEWS.gereja(); } catch (x) { fail(x); } };
    view.onclick = async (e) => {
      const ed = e.target.closest("[data-edit]"), del = e.target.closest("[data-del]");
      if (ed) {
        const c = list.find((x) => x.id === Number(ed.dataset.edit));
        const body = openDialog(`<div class="dlg-head"><h2>Ubah gereja</h2></div><form id="f" class="form-grid"><label>Nama<input name="name" value="${esc(c.name)}"></label><label>Kota<input name="city" value="${esc(c.city)}"></label>
          <div class="dlg-foot" style="grid-column:1/-1"><button type="button" class="btn" data-close>Batal</button><button class="btn primary">Simpan</button></div></form>`, { narrow: true });
        $("#f", body).onsubmit = async (ev) => { ev.preventDefault(); try { await PUT(`/api/admin/churches/${c.id}`, Object.fromEntries(new FormData(ev.target))); toast("Tersimpan"); closeDialog(); VIEWS.gereja(); } catch (x) { fail(x); } };
      }
      if (del && !del.disabled) {
        if (!(await confirmBox("Hapus gereja?", "Gereja ini akan hilang dari pilihan formulir.", "Hapus"))) return;
        try { await DEL(`/api/admin/churches/${del.dataset.del}`); toast("Dihapus"); VIEWS.gereja(); } catch (x) { fail(x); }
      }
    };
  };

  // =====================================================================
  // JADWAL
  // =====================================================================
  VIEWS.jadwal = async () => {
    const list = await sessions(true);
    const days = [...new Set(list.map((s) => s.day))].sort((a, b) => a - b);
    view.innerHTML = `
      <div class="head"><div><h1>Jadwal sesi</h1><p class="muted">Sesi di sini yang dipilih petugas scanner. Jenis <b>Seminar</b> dihitung untuk nominasi gereja paling aktif; <b>Check-in</b> untuk registrasi ulang dan kehadiran umum.</p></div>
        <div class="head-actions"><button class="btn primary" id="newS">+ Sesi baru</button></div></div>
      ${days.length ? days.map((d) => `<div class="daygroup"><h3>Hari ${d}</h3><div class="table-wrap"><table><thead><tr><th>Jam</th><th>Sesi</th><th>Jenis</th><th>Lokasi</th><th>Pembicara</th><th>Scan</th><th></th></tr></thead><tbody>
        ${list.filter((s) => s.day === d).map((s) => `<tr><td class="num">${esc(s.starts_at || "—")}${s.ends_at ? "–" + esc(s.ends_at) : ""}</td><td><b>${esc(s.title)}</b></td><td><span class="pill ${s.kind}">${KIND[s.kind]}</span></td><td>${esc(s.location)}</td><td>${esc(s.speaker)}</td><td class="num">${s.scans}</td>
          <td class="actions"><button class="btn sm" data-edit="${s.id}">Ubah</button> <button class="btn sm danger" data-del="${s.id}">Hapus</button></td></tr>`).join("")}
        </tbody></table></div></div>`).join("") : `<div class="card empty">Belum ada sesi. Tambahkan minimal satu sesi Check-in (registrasi ulang) dan sesi-sesi Seminar.</div>`}
      <p class="muted">Setiap kali jadwal berubah, petugas scanner perlu menekan <b>Unduh ulang data</b> saat ada koneksi.</p>`;
    $("#newS").onclick = () => sessionForm();
    view.onclick = async (e) => {
      const ed = e.target.closest("[data-edit]"), del = e.target.closest("[data-del]");
      if (ed) sessionForm(list.find((s) => s.id === Number(ed.dataset.edit)));
      if (del) {
        const s = list.find((x) => x.id === Number(del.dataset.del));
        if (!(await confirmBox("Hapus sesi?", s.scans ? `Sesi ini sudah punya ${s.scans} data scan yang ikut terhapus.` : "Sesi ini akan dihapus.", "Hapus"))) return;
        try { await DEL(`/api/admin/sessions/${s.id}?force=1`); toast("Sesi dihapus"); VIEWS.jadwal(); } catch (x) { fail(x); }
      }
    };
  };
  function sessionForm(s) {
    const body = openDialog(`<div class="dlg-head"><h2>${s ? "Ubah sesi" : "Sesi baru"}</h2><button class="btn ghost sm" data-close>✕</button></div>
      <form id="sf" class="form-grid">
        <label class="span2">Judul sesi<input name="title" required value="${esc(s?.title || "")}" placeholder="mis. Seminar 1: Identitas di dalam Kristus"></label>
        <label>Jenis<select name="kind"><option value="seminar"${s?.kind !== "checkin" ? " selected" : ""}>Seminar (dihitung nominasi)</option><option value="checkin"${s?.kind === "checkin" ? " selected" : ""}>Check-in / registrasi ulang</option></select></label>
        <label>Hari ke-<input name="day" type="number" min="1" max="14" required value="${s?.day || 1}"></label>
        <label>Mulai<input name="starts_at" type="time" value="${esc(s?.starts_at || "")}"></label>
        <label>Selesai<input name="ends_at" type="time" value="${esc(s?.ends_at || "")}"></label>
        <label>Lokasi<input name="location" value="${esc(s?.location || "")}" placeholder="mis. Aula utama"></label>
        <label>Pembicara<input name="speaker" value="${esc(s?.speaker || "")}"></label>
        <div class="dlg-foot" style="grid-column:1/-1"><button type="button" class="btn" data-close>Batal</button><button class="btn primary">Simpan</button></div>
      </form>`);
    $("#sf", body).onsubmit = async (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(e.target)); v.day = Number(v.day);
      try { s ? await PUT(`/api/admin/sessions/${s.id}`, v) : await POST("/api/admin/sessions", v); toast("Tersimpan"); closeDialog(); VIEWS.jadwal(); } catch (x) { fail(x); }
    };
  }

  // =====================================================================
  // KEHADIRAN
  // =====================================================================
  let aState = { session: "", church: "" };
  VIEWS.kehadiran = async () => {
    const [ss, cs] = await Promise.all([sessions(true), churches()]);
    view.innerHTML = `
      <div class="head"><div><h1>Kehadiran</h1><p class="muted">Data masuk setelah HP scanner tersinkron. Hapus baris yang salah scan.</p></div>
        <div class="head-actions"><a class="btn" href="/api/admin/export/attendance.csv">Unduh CSV</a><button class="btn primary" id="addA">+ Catat manual</button></div></div>
      <div class="toolbar">
        <select id="aS"><option value="">Semua sesi</option>${ss.map((s) => `<option value="${s.id}"${String(aState.session) === String(s.id) ? " selected" : ""}>Hari ${s.day} · ${esc(s.title)}</option>`).join("")}</select>
        <select id="aC">${churchOptions(cs, aState.church, "Semua gereja")}</select>
        <span class="muted" id="aCount"></span>
      </div>
      <div id="aTable"></div>`;
    $("#aS").onchange = (e) => { aState.session = e.target.value; loadA(); };
    $("#aC").onchange = (e) => { aState.church = e.target.value; loadA(); };
    $("#addA").onclick = () => manualAttend(ss);
    await loadA();
  };
  async function loadA() {
    const q = new URLSearchParams(); if (aState.session) q.set("session_id", aState.session); if (aState.church) q.set("church_id", aState.church);
    const list = await GET("/api/admin/attendance?" + q);
    $("#aCount").textContent = `${list.length} scan`;
    const M = { qr: "QR", manual: "Cari nama", kode: "Ketik kode", admin: "Admin" };
    $("#aTable").innerHTML = list.length ? `<div class="table-wrap"><table><thead><tr><th>Waktu scan</th><th>Peserta</th><th>Gereja</th><th>Sesi</th><th>Cara</th><th>Petugas</th><th>Masuk server</th><th></th></tr></thead><tbody>
      ${list.map((a) => `<tr><td>${fmtTime(a.scanned_at)}</td><td>${esc(a.name)}<span class="sub mono">${esc(a.code)}</span></td><td>${esc(a.church)}</td><td>${esc(a.session)} <span class="pill ${a.kind}">${KIND[a.kind]}</span></td>
        <td>${M[a.method] || a.method}</td><td>${esc(a.scanner || "")}<span class="sub">${esc(a.device_id)}</span></td><td>${fmtTime(a.received_at)}</td><td class="actions"><button class="btn sm danger" data-del="${a.id}">Hapus</button></td></tr>`).join("")}
      </tbody></table></div>` : `<div class="card empty">Belum ada data kehadiran${aState.session || aState.church ? " untuk filter ini" : ""}.</div>`;
    $("#aTable").onclick = async (e) => {
      const d = e.target.closest("[data-del]"); if (!d) return;
      if (!(await confirmBox("Hapus data scan?", "Gunakan ini untuk scan yang salah sesi atau salah orang.", "Hapus"))) return;
      try { await DEL(`/api/admin/attendance/${d.dataset.del}`); toast("Dihapus"); loadA(); } catch (x) { fail(x); }
    };
  }
  async function manualAttend(ss) {
    const body = openDialog(`<div class="dlg-head"><h2>Catat kehadiran manual</h2><button class="btn ghost sm" data-close>✕</button></div>
      <form id="mf" style="display:grid;gap:12px">
        <label>Sesi<select name="session_id" required>${ss.map((s) => `<option value="${s.id}">Hari ${s.day} · ${esc(s.title)}</option>`).join("")}</select></label>
        <label>Cari peserta<input id="mq" placeholder="Ketik nama atau kode" autocomplete="off"></label>
        <div id="mres" style="display:grid;gap:6px;max-height:260px;overflow:auto"></div>
      </form>`, { narrow: true });
    let t;
    $("#mq", body).oninput = (e) => {
      clearTimeout(t); t = setTimeout(async () => {
        const q = e.target.value.trim(); if (q.length < 2) { $("#mres", body).innerHTML = ""; return; }
        const list = await GET("/api/admin/participants?status=lunas&q=" + encodeURIComponent(q));
        $("#mres", body).innerHTML = list.slice(0, 30).map((p) => `<button type="button" class="btn" style="justify-content:space-between" data-p="${p.id}"><span>${esc(p.name)}</span><span class="muted">${esc(p.church)}</span></button>`).join("") || `<p class="muted">Tidak ditemukan.</p>`;
      }, 200);
    };
    $("#mres", body).onclick = async (e) => {
      const b = e.target.closest("[data-p]"); if (!b) return;
      try {
        const r = await POST("/api/admin/attendance", { participant_id: Number(b.dataset.p), session_id: Number($("[name=session_id]", body).value) });
        toast(r.added ? "Kehadiran dicatat" : "Sudah tercatat sebelumnya"); b.disabled = true; if (location.hash === "#kehadiran") loadA();
      } catch (x) { fail(x); }
    };
  }

  // =====================================================================
  // HASIL & LOMBA
  // =====================================================================
  VIEWS.hasil = async () => {
    const [rk, contests, settings, cs] = await Promise.all([GET("/api/admin/rankings"), GET("/api/admin/contests"), GET("/api/admin/settings"), churches()]);
    const rows = (list, val) => list.length ? `<div class="table-wrap"><table><thead><tr><th>#</th><th>Gereja</th><th>Nilai</th><th>Peserta lunas</th></tr></thead><tbody>
      ${list.slice(0, 10).map((r, i) => `<tr><td class="num"><b>${i + 1}</b></td><td>${esc(r.church)}<span class="sub">${esc(r.city)}</span></td><td class="num"><b>${val(r)}</b></td><td class="num">${r.confirmed}</td></tr>`).join("")}</tbody></table></div>`
      : `<p class="empty">Belum ada data kehadiran.</p>`;
    view.innerHTML = `
      <div class="head"><div><h1>Hasil &amp; lomba</h1><p class="muted">Nominasi dihitung otomatis dari data scan. Publikasikan setelah semua HP scanner tersinkron.</p></div>
        <div class="head-actions"><a class="btn" href="/api/admin/export/rankings.csv">Unduh CSV</a></div></div>
      <div class="card" style="border-color:${settings.results_published ? "#9FD3B2" : "var(--line)"}">
        <div class="card-head"><div><h3>Publikasi di website</h3><p class="muted">${settings.results_published ? "Hasil sedang tampil di website publik." : "Hasil belum tampil. Pengunjung melihat papan skor terkunci."}</p></div>
          <label class="switch"><input type="checkbox" id="pub"${settings.results_published ? " checked" : ""}> Tampilkan hasil</label></div>
        <form id="minF" class="toolbar"><label style="display:flex;gap:8px;align-items:center;font-weight:500">Minimal peserta lunas agar ikut nominasi "paling aktif" <input name="min" type="number" min="1" style="width:80px" value="${rk.min_participants}"></label><button class="btn sm">Simpan</button></form>
      </div>
      <div class="grid2">
        <div class="card"><h3>Gereja dengan peserta terbanyak</h3><p class="muted">Jumlah peserta yang tercatat hadir minimal sekali.</p>${rows(rk.most_participants, (r) => `${r.present} orang`)}</div>
        <div class="card"><h3>Gereja paling aktif seminar</h3><p class="muted">Total scan seminar ÷ peserta lunas, dari ${rk.seminar_count} sesi seminar.</p>${rows(rk.most_active, (r) => `${String(r.seminar_per_person).replace(".", ",")} sesi · ${r.seminar_rate}%`)}</div>
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Pemenang lomba</h3><p class="muted">Tampil di website bersama nominasi saat hasil dipublikasikan.</p></div></div>
        <form id="ctF" class="form-grid">
          <label>Nama lomba<input name="contest" list="ctList" required placeholder="mis. Lomba paduan suara"><datalist id="ctList">${[...new Set(contests.map((c) => c.contest))].map((c) => `<option value="${esc(c)}">`).join("")}</datalist></label>
          <label>Peringkat<input name="rank" type="number" min="1" max="20" value="1" required></label>
          <label>Pemenang (tim / nama)<input name="winner" required></label>
          <label>Gereja (opsional)<select name="church_id">${churchOptions(cs, "", "—")}</select></label>
          <div style="align-self:end"><button class="btn primary">Tambah pemenang</button></div>
        </form>
        ${contests.length ? `<div class="table-wrap"><table><thead><tr><th>Lomba</th><th>Peringkat</th><th>Pemenang</th><th>Gereja</th><th></th></tr></thead><tbody>
          ${contests.map((c) => `<tr><td>${esc(c.contest)}</td><td class="num">${c.rank}</td><td>${esc(c.winner)}</td><td>${esc(c.church || "")}</td><td class="actions"><button class="btn sm danger" data-del="${c.id}">Hapus</button></td></tr>`).join("")}
        </tbody></table></div>` : `<p class="muted">Belum ada pemenang lomba.</p>`}
      </div>`;
    $("#pub").onchange = async (e) => {
      try { await PUT("/api/admin/settings", { results_published: e.target.checked }); toast(e.target.checked ? "Hasil tampil di website" : "Hasil disembunyikan"); VIEWS.hasil(); } catch (x) { fail(x); }
    };
    $("#minF").onsubmit = async (e) => { e.preventDefault(); try { await PUT("/api/admin/settings", { min_participants_for_activity: Number(new FormData(e.target).get("min")) }); toast("Tersimpan"); VIEWS.hasil(); } catch (x) { fail(x); } };
    $("#ctF").onsubmit = async (e) => {
      e.preventDefault(); const v = Object.fromEntries(new FormData(e.target)); v.rank = Number(v.rank); v.church_id = v.church_id ? Number(v.church_id) : null;
      try { await POST("/api/admin/contests", v); toast("Pemenang ditambahkan"); VIEWS.hasil(); } catch (x) { fail(x); }
    };
    view.onclick = async (e) => {
      const d = e.target.closest("[data-del]"); if (!d) return;
      try { await DEL(`/api/admin/contests/${d.dataset.del}`); toast("Dihapus"); VIEWS.hasil(); } catch (x) { fail(x); }
    };
  };

  // =====================================================================
  // GALERI
  // =====================================================================
  VIEWS.galeri = async () => {
    const list = await GET("/api/admin/photos");
    view.innerHTML = `
      <div class="head"><div><h1>Galeri foto</h1><p class="muted">Foto tampil di website bagian Dokumentasi. Foto otomatis diperkecil sebelum diunggah supaya hemat kuota.</p></div></div>
      <label class="drop" id="drop"><b>Pilih atau seret foto ke sini</b><span>JPG, PNG, atau WebP. Bisa banyak sekaligus.</span><input type="file" id="files" accept="image/jpeg,image/png,image/webp" multiple style="max-width:260px"></label>
      <div id="upStatus" class="muted"></div>
      ${list.length ? `<div class="photos">${list.map((p) => `<div class="photo"><img src="${esc(p.url)}" alt="${esc(p.caption)}" loading="lazy">
        <div class="meta"><input value="${esc(p.caption)}" placeholder="Keterangan" data-cap="${p.id}" aria-label="Keterangan foto"><button class="btn sm danger" data-del="${p.id}" aria-label="Hapus foto">✕</button></div></div>`).join("")}</div>`
        : `<div class="card empty">Belum ada foto.</div>`}`;
    const drop = $("#drop");
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
    drop.ondragleave = () => drop.classList.remove("over");
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); upload([...e.dataTransfer.files]); };
    $("#files").onchange = (e) => upload([...e.target.files]);
    view.onchange = async (e) => { const c = e.target.closest("[data-cap]"); if (!c) return; try { await PUT(`/api/admin/photos/${c.dataset.cap}`, { caption: c.value }); toast("Keterangan disimpan"); } catch (x) { fail(x); } };
    view.onclick = async (e) => {
      const d = e.target.closest("[data-del]"); if (!d) return;
      if (!(await confirmBox("Hapus foto?", "Foto akan hilang dari website.", "Hapus"))) return;
      try { await DEL(`/api/admin/photos/${d.dataset.del}`); toast("Foto dihapus"); VIEWS.galeri(); } catch (x) { fail(x); }
    };
  };
  async function shrink(file, max = 1800) {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
    const c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d").drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(img.src);
    // Batas unggah server 4,5 MB: turunkan kualitas sampai foto di bawah ±3 MB
    let q = 0.82, data = c.toDataURL("image/jpeg", q);
    while (data.length > 3_000_000 && q > 0.4) { q -= 0.1; data = c.toDataURL("image/jpeg", q); }
    return { data, width: w, height: h };
  }
  async function upload(files) {
    const st = $("#upStatus"); let ok = 0;
    for (const [i, f] of files.entries()) {
      st.textContent = `Mengunggah ${i + 1} dari ${files.length}…`;
      try { const s = await shrink(f); await POST("/api/admin/photos", { ...s, caption: "" }); ok++; } catch (x) { toast(`${f.name}: ${x.message || "gagal"}`, true); }
    }
    toast(`${ok} foto diunggah`); VIEWS.galeri();
  }

  // =====================================================================
  // KONTEN WEBSITE
  // =====================================================================
  const toLocal = (iso) => { const d = new Date(iso); if (Number.isNaN(d.getTime())) return ""; return new Date(d.getTime() + 7 * 36e5).toISOString().slice(0, 16); };
  const fromLocal = (v) => (v ? v + ":00+07:00" : "");
  VIEWS.konten = async () => {
    const [s, lineup] = await Promise.all([GET("/api/admin/settings"), GET("/api/admin/lineup")]);
    const TIER = { utama: "Pembicara utama", pembicara: "Pembicara", tamu: "Bintang tamu" };
    view.innerHTML = `
      <div class="head"><div><h1>Konten website</h1><p class="muted">Semua yang tampil di halaman depan. Waktu memakai WIB.</p></div><div class="head-actions"><a class="btn" href="/" target="_blank">Lihat website</a></div></div>
      <form class="card" id="setF">
        <div class="card-head"><h3>Acara</h3><label class="switch"><input type="checkbox" name="registration_open"${s.registration_open ? " checked" : ""}> Pendaftaran dibuka</label></div>
        <div class="form-grid">
          <label>Nama acara<input name="event_name" value="${esc(s.event_name)}"></label>
          <label>Judul baris 1 (LED)<input name="title_line1" value="${esc(s.title_line1)}"></label>
          <label>Judul baris 2 (LED, redup)<input name="title_line2" value="${esc(s.title_line2)}"></label>
          <label class="span2">Tagline<input name="tagline" value="${esc(s.tagline)}"></label>
          <label>Mulai (WIB)<input name="start_at" type="datetime-local" value="${toLocal(s.start_at)}"><span class="hint">Dipakai untuk hitung mundur</span></label>
          <label>Selesai (WIB)<input name="end_at" type="datetime-local" value="${toLocal(s.end_at)}"></label>
          <label>Tanggal yang ditampilkan<input name="dates_label" value="${esc(s.dates_label)}" placeholder="mis. 6–9 Juli 2027"></label>
          <label>Lokasi<input name="location" value="${esc(s.location)}"></label>
          <label>Perkiraan gereja<input name="est_churches" type="number" min="0" value="${s.est_churches}"></label>
          <label>Perkiraan peserta<input name="est_participants" type="number" min="0" value="${s.est_participants}"><span class="hint">Diganti jumlah peserta lunas bila sudah ada</span></label>
          <label>Biaya per peserta (Rp)<input name="fee_per_person" type="number" min="0" step="1000" value="${s.fee_per_person}"><span class="hint">Berlaku untuk pendaftaran baru</span></label>
          <label>Kontak panitia<input name="contact" value="${esc(s.contact)}" placeholder="mis. Kak Rina · 0812…"></label>
          <label class="span2">Catatan pembayaran<input name="payment_note" value="${esc(s.payment_note)}"></label>
          <label>Awalan kode pendaftaran<input name="code_prefix" value="${esc(s.code_prefix)}" maxlength="8"></label>
          <label class="span2">Tautan Spotify / playlist<input name="spotify_url" value="${esc(s.spotify_url)}"></label>
        </div>
        <div><button class="btn primary">Simpan konten</button></div>
      </form>
      <div class="card" id="musicCard">
        <div class="card-head"><div><h3>Lagu latar</h3><p class="muted">Diputar di halaman depan. Pakai lagu yang panitia punya izin pemakaiannya.</p></div></div>
        ${s.music_url ? `<div class="music-now"><div><b>${esc(s.music_title || "Lagu latar")}</b><span class="muted">Sedang dipakai di website</span></div><audio controls preload="none" src="${esc(s.music_url)}"></audio><button type="button" class="btn sm danger" id="musicDel">Hapus lagu</button></div>`
          : `<p class="muted">Belum ada lagu. Website memutar pad worship bawaan.</p>`}
        <form id="musicF" class="form-grid">
          <label>Judul yang ditampilkan<input name="title" value="${esc(s.music_title)}" placeholder="mis. Sukacita Melimpah · NDC Worship" maxlength="120"></label>
          <label>File MP3<input type="file" name="file" accept="audio/mpeg,.mp3" required><span class="hint">File di atas 4 MB otomatis dikecilkan dulu di laptop ini.</span></label>
          <div style="align-self:end"><button class="btn primary" id="musicBtn">Unggah lagu</button></div>
        </form>
        <div id="musicStatus" class="muted" role="status"></div>
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Lineup</h3><p class="muted">Tampil sebagai poster festival. Urutan kecil tampil lebih dulu.</p></div></div>
        <form id="luF" class="form-grid">
          <label>Nama<input name="name" required></label>
          <label>Peran<select name="tier"><option value="utama">Pembicara utama</option><option value="pembicara">Pembicara</option><option value="tamu">Bintang tamu</option></select></label>
          <label>Keterangan (opsional)<input name="note" placeholder="mis. Gembala GBI Pontianak"></label>
          <label>Urutan<input name="sort" type="number" value="0"></label>
          <label>Foto (opsional)<input type="file" name="photo" accept="image/jpeg,image/png,image/webp"></label>
          <div style="align-self:end"><button class="btn primary">Tambah</button></div>
        </form>
        ${lineup.length ? `<div class="table-wrap"><table><thead><tr><th>Foto</th><th>Nama</th><th>Peran</th><th>Keterangan</th><th>Urutan</th><th></th></tr></thead><tbody>
          ${lineup.map((l) => `<tr><td>${l.photo_url ? `<img class="lu-thumb" src="${esc(l.photo_url)}" alt="">` : `<span class="lu-thumb empty" aria-hidden="true">${esc(l.name.trim()[0] || "?")}</span>`}</td>
            <td><b>${esc(l.name)}</b></td><td>${TIER[l.tier]}</td><td>${esc(l.note)}</td><td class="num">${l.sort}</td>
            <td class="actions"><label class="btn sm">${l.photo_url ? "Ganti foto" : "Unggah foto"}<input type="file" accept="image/jpeg,image/png,image/webp" data-lu-photo="${l.id}" hidden></label>
              ${l.photo_url ? `<button class="btn sm" data-lu-nophoto="${l.id}">Hapus foto</button>` : ""}
              <button class="btn sm danger" data-del-lu="${l.id}">Hapus</button></td></tr>`).join("")}
        </tbody></table></div>` : `<p class="muted">Belum ada nama. Website menampilkan "Lineup diumumkan segera".</p>`}
      </div>`;
    $("#setF").onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target); const v = Object.fromEntries(f);
      v.registration_open = f.get("registration_open") === "on";
      v.start_at = fromLocal(v.start_at); v.end_at = fromLocal(v.end_at);
      if (!v.start_at) delete v.start_at; if (!v.end_at) delete v.end_at;
      try { await PUT("/api/admin/settings", v); toast("Konten disimpan"); } catch (x) { fail(x); }
    };
    $("#luF").onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target), photo = f.get("photo");
      const v = { name: f.get("name"), tier: f.get("tier"), note: f.get("note"), sort: Number(f.get("sort")) };
      try {
        const r = await POST("/api/admin/lineup", v);
        if (photo && photo.size) await POST(`/api/admin/lineup/${r.id}/photo`, await shrink(photo, 900));
        toast("Ditambahkan"); VIEWS.konten();
      } catch (x) { fail(x); }
    };
    $("#musicF").onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target), file = f.get("file"), st = $("#musicStatus"), btn = $("#musicBtn");
      if (!file || !file.size) return;
      btn.disabled = true;
      try {
        const blob = await fitMusic(file, (m) => (st.textContent = m));
        st.textContent = "Mengunggah lagu…";
        const res = await fetch("/api/admin/music?title=" + encodeURIComponent(f.get("title") || ""), { method: "POST", credentials: "same-origin", headers: { "X-RPK": "1", "Content-Type": "audio/mpeg" }, body: blob });
        const data = await res.json().catch(() => null);
        if (res.status === 401) { showLogin(); return; }
        if (!res.ok) throw new Error(data?.error || "Gagal mengunggah lagu.");
        toast("Lagu latar dipasang"); VIEWS.konten();
      } catch (x) { st.textContent = ""; fail(x); } finally { btn.disabled = false; }
    };
    if ($("#musicDel")) $("#musicDel").onclick = async () => {
      if (!(await confirmBox("Hapus lagu latar?", "Website kembali memutar pad worship bawaan.", "Hapus"))) return;
      try { await DEL("/api/admin/music"); toast("Lagu dihapus"); VIEWS.konten(); } catch (x) { fail(x); }
    };
    view.onchange = async (e) => {
      const inp = e.target.closest("[data-lu-photo]"); if (!inp || !inp.files[0]) return;
      try { toast("Mengunggah foto…"); await POST(`/api/admin/lineup/${inp.dataset.luPhoto}/photo`, await shrink(inp.files[0], 900)); toast("Foto disimpan"); VIEWS.konten(); } catch (x) { fail(x); }
    };
    view.onclick = async (e) => {
      const np = e.target.closest("[data-lu-nophoto]");
      if (np) { try { await DEL(`/api/admin/lineup/${np.dataset.luNophoto}/photo`); toast("Foto dihapus"); VIEWS.konten(); } catch (x) { fail(x); } return; }
      const d = e.target.closest("[data-del-lu]"); if (!d) return;
      if (!(await confirmBox("Hapus dari lineup?", "Nama dan fotonya hilang dari website.", "Hapus"))) return;
      try { await DEL(`/api/admin/lineup/${d.dataset.delLu}`); toast("Dihapus"); VIEWS.konten(); } catch (x) { fail(x); }
    };
  };

  // Lagu di atas ±4 MB dikodekan ulang menjadi MP3 yang lebih kecil (lamejs, LGPL) supaya muat di batas unggah Vercel.
  const MUSIC_MAX = 4_200_000;
  function loadLame() {
    if (window.lamejs) return Promise.resolve();
    return new Promise((res, rej) => { const sc = document.createElement("script"); sc.src = "/vendor/lame/lame.min.js"; sc.onload = res; sc.onerror = () => rej(new Error("Gagal memuat pengubah MP3.")); document.head.appendChild(sc); });
  }
  async function fitMusic(file, say) {
    if (file.size <= MUSIC_MAX) return file;
    say("Membaca lagu…");
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    let audio;
    try { audio = await ctx.decodeAudioData(await file.arrayBuffer()); } catch (_) { throw new Error("File lagu tidak bisa dibaca. Pastikan formatnya MP3."); } finally { ctx.close && ctx.close(); }
    await loadLame();
    const rate = [44100, 48000, 32000].includes(audio.sampleRate) ? audio.sampleRate : 44100;
    const target = Math.floor((MUSIC_MAX * 8) / audio.duration / 1000);
    const kbps = [128, 112, 96, 80, 64, 56, 48, 40, 32].find((k) => k <= target);
    if (!kbps) throw new Error("Lagu terlalu panjang. Potong lagu menjadi kurang dari 15 menit.");
    const chans = Math.min(2, audio.numberOfChannels);
    const toI16 = (f32) => { const o = new Int16Array(f32.length); for (let i = 0; i < f32.length; i++) { const x = Math.max(-1, Math.min(1, f32[i])); o[i] = x < 0 ? x * 0x8000 : x * 0x7fff; } return o; };
    // sampleRate audio dari decodeAudioData mengikuti AudioContext; resample sederhana bila perlu
    let L = audio.getChannelData(0), R = chans > 1 ? audio.getChannelData(1) : null;
    if (audio.sampleRate !== rate) {
      const off = new OfflineAudioContext(chans, Math.ceil(audio.duration * rate), rate);
      const src = off.createBufferSource(); src.buffer = audio; src.connect(off.destination); src.start();
      const r = await off.startRendering(); L = r.getChannelData(0); R = chans > 1 ? r.getChannelData(1) : null;
    }
    const l16 = toI16(L), r16 = R ? toI16(R) : null;
    const enc = new lamejs.Mp3Encoder(chans, rate, kbps);
    const out = []; const BLOCK = 1152 * 20;
    for (let i = 0; i < l16.length; i += BLOCK) {
      const chunk = r16 ? enc.encodeBuffer(l16.subarray(i, i + BLOCK), r16.subarray(i, i + BLOCK)) : enc.encodeBuffer(l16.subarray(i, i + BLOCK));
      if (chunk.length) out.push(new Uint8Array(chunk));
      if (i % (BLOCK * 40) === 0) { say(`Mengecilkan lagu… ${Math.round((i / l16.length) * 100)}%`); await new Promise((r) => setTimeout(r)); }
    }
    const end = enc.flush(); if (end.length) out.push(new Uint8Array(end));
    const blob = new Blob(out, { type: "audio/mpeg" });
    if (blob.size > MUSIC_MAX + 150_000) throw new Error("Lagu masih terlalu besar setelah dikecilkan.");
    return blob;
  }

  // =====================================================================
  // AKUN
  // =====================================================================
  VIEWS.akun = async () => {
    const users = await GET("/api/admin/users");
    view.innerHTML = `
      <div class="head"><div><h1>Akun &amp; scanner</h1><p class="muted">Buat satu akun per petugas scanner. Petugas membuka <a href="/scan/" target="_blank">${esc(location.origin)}/scan/</a> di HP Android lalu login.</p></div></div>
      <form class="card" id="uF"><h3>Akun baru</h3>
        <div class="form-grid">
          <label>Username<input name="username" required pattern="[a-z0-9._-]{3,40}" placeholder="mis. scan-pintu1"><span class="hint">Huruf kecil, angka, titik, strip</span></label>
          <label>Nama petugas<input name="name"></label>
          <label>Peran<select name="role"><option value="scanner">Scanner</option><option value="admin">Admin</option></select></label>
          <label>Password<input name="password" type="text" minlength="8" required value="${genPass()}"><span class="hint">Catat dan berikan ke petugas</span></label>
        </div>
        <div><button class="btn primary">Buat akun</button></div></form>
      <div class="table-wrap"><table><thead><tr><th>Username</th><th>Nama</th><th>Peran</th><th>Status</th><th>Sesi aktif</th><th>Scan</th><th></th></tr></thead><tbody>
        ${users.map((u) => `<tr><td class="mono">${esc(u.username)}</td><td>${esc(u.name)}${u.id === me.id ? ` <span class="muted">(kamu)</span>` : ""}</td><td>${u.role === "admin" ? "Admin" : "Scanner"}</td>
          <td>${u.active ? `<span class="pill lunas">Aktif</span>` : `<span class="pill batal">Nonaktif</span>`}</td><td class="num">${u.sessions}</td><td class="num">${u.scans}</td>
          <td class="actions"><button class="btn sm" data-pw="${u.id}">Ganti password</button> ${u.id !== me.id ? `<button class="btn sm ${u.active ? "danger" : ""}" data-toggle="${u.id}" data-active="${u.active}">${u.active ? "Nonaktifkan" : "Aktifkan"}</button>` : ""}</td></tr>`).join("")}
      </tbody></table></div>`;
    $("#uF").onsubmit = async (e) => { e.preventDefault(); try { await POST("/api/admin/users", Object.fromEntries(new FormData(e.target))); toast("Akun dibuat"); VIEWS.akun(); } catch (x) { fail(x); } };
    view.onclick = async (e) => {
      const pw = e.target.closest("[data-pw]"), tg = e.target.closest("[data-toggle]");
      if (pw) {
        const body = openDialog(`<div class="dlg-head"><h2>Ganti password</h2></div><form id="f" style="display:grid;gap:12px"><label>Password baru<input name="password" minlength="8" required value="${genPass()}"></label>
          <p class="muted">Semua HP yang login dengan akun ini akan diminta login ulang.</p>
          <div class="dlg-foot"><button type="button" class="btn" data-close>Batal</button><button class="btn primary">Simpan</button></div></form>`, { narrow: true });
        $("#f", body).onsubmit = async (ev) => { ev.preventDefault(); try { await PUT(`/api/admin/users/${pw.dataset.pw}`, { password: new FormData(ev.target).get("password") }); toast("Password diganti"); closeDialog(); VIEWS.akun(); } catch (x) { fail(x); } };
      }
      if (tg) {
        const active = tg.dataset.active === "1";
        if (active && !(await confirmBox("Nonaktifkan akun?", "HP yang memakai akun ini tidak bisa sinkron lagi. Scan yang belum tersinkron di HP tersebut tetap tersimpan di HP.", "Nonaktifkan"))) return;
        try { await PUT(`/api/admin/users/${tg.dataset.toggle}`, { active: !active }); toast("Tersimpan"); VIEWS.akun(); } catch (x) { fail(x); }
      }
    };
  };
  function genPass() { const a = "abcdefghjkmnpqrstuvwxyz23456789"; let s = ""; const r = crypto.getRandomValues(new Uint8Array(10)); for (const b of r) s += a[b % a.length]; return s; }

  boot();
})();
