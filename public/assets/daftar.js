// Halaman pendaftaran rombongan dan cek status (terpisah dari landing page).
(function () {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const rupiah = (n) => "Rp" + Math.round(n).toLocaleString("id-ID");
  const go = (url) => (window.RPKPreview ? window.RPKPreview.go(url) : (location.href = url));
  let S = {}, churches = [];

  function readSaved() { try { return JSON.parse(localStorage.getItem("rpk-regs") || "[]"); } catch (_) { return []; } }
  function saveReg(r) {
    try { const list = readSaved().filter((x) => x.token !== r.token); list.unshift(r); localStorage.setItem("rpk-regs", JSON.stringify(list.slice(0, 10))); } catch (_) {}
  }

  fetch("/api/public", { cache: "no-cache" }).then((r) => r.json()).then((data) => {
    S = data.settings; churches = data.churches;
    document.title = "Daftar · " + (S.event_name || "PPD Antiokhia");
    $("#ppEvent").textContent = S.event_name;
    $("#feeText").textContent = S.fee_per_person ? rupiah(S.fee_per_person) : "Menyusul";
    $("#payNote").textContent = S.payment_note;
    if (S.contact) { $("#contact").hidden = false; $("#contact").textContent = "Kontak panitia: " + S.contact; }
    renderChurches();
    updateSum();
    if (!S.registration_open) { $("#regForm").hidden = true; $("#regClosed").hidden = false; }
  }).catch(() => {
    $("#church").innerHTML = `<option value="">Gagal memuat. Muat ulang halaman.</option>`;
  });

  // ---------- Formulir ----------
  function renderChurches() {
    const sel = $("#church");
    sel.innerHTML = churches.length
      ? `<option value="">Pilih gereja asal</option>` + churches.map((c) => `<option value="${c.id}">${esc(c.name)}${c.city ? " · " + esc(c.city) : ""}</option>`).join("")
      : `<option value="">Daftar gereja belum diisi panitia</option>`;
  }

  let rows = [], rid = 0;
  const newRow = () => ({ k: ++rid, name: "", role: "peserta", gender: "", age: "" });
  function renderRows() {
    $("#plist").innerHTML = rows.map((r, i) => `
      <div class="prow" data-k="${r.k}">
        <span class="n">${i + 1}</span>
        <input aria-label="Nama peserta ${i + 1}" id="pn${r.k}" value="${esc(r.name)}" placeholder="Nama lengkap" data-f="name" autocomplete="off">
        <button type="button" class="del" aria-label="Hapus peserta ${i + 1}" data-del="${r.k}"${rows.length === 1 ? " disabled" : ""}>×</button>
        <div class="meta">
          <div class="radios" role="radiogroup" aria-label="Status peserta ${i + 1}">
            <label><input type="radio" name="ps${r.k}" value="gembala" data-f="role"${r.role === "gembala" ? " checked" : ""}>Gembala sidang</label>
            <label><input type="radio" name="ps${r.k}" value="peserta" data-f="role"${r.role === "peserta" ? " checked" : ""}>Peserta</label>
          </div>
          <select aria-label="Jenis kelamin peserta ${i + 1}" data-f="gender">
            <option value="">Jenis kelamin</option>
            <option value="L"${r.gender === "L" ? " selected" : ""}>Laki-laki</option>
            <option value="P"${r.gender === "P" ? " selected" : ""}>Perempuan</option>
          </select>
          <input class="a" aria-label="Usia peserta ${i + 1}" inputmode="numeric" maxlength="2" value="${esc(r.age)}" placeholder="Usia" data-f="age">
        </div>
      </div>`).join("");
    updateSum();
  }
  function updateSum() {
    const n = rows.filter((r) => r.name.trim()).length;
    $("#sumCount").textContent = n + " peserta";
    $("#sumFee").textContent = S.fee_per_person ? rupiah(n * S.fee_per_person) : "Biaya menyusul";
    const first = rows.find((r) => r.name.trim()) || rows[0];
    const gold = first && first.role === "gembala";
    $("#passPreview").classList.toggle("gold", !!gold);
    $("#ppRole").textContent = gold ? "Gembala sidang" : "Peserta";
    $("#ppName").textContent = (first && first.name.trim()) || "Nama peserta";
    const c = churches.find((x) => String(x.id) === $("#church").value);
    $("#ppChurch").textContent = c ? c.name : "Gereja asal";
  }
  function onRowInput(e) {
    const row = e.target.closest(".prow"); if (!row) return;
    const r = rows.find((x) => x.k === +row.dataset.k), f = e.target.dataset.f;
    if (r && f) { r[f] = e.target.value; updateSum(); }
  }
  $("#plist").addEventListener("input", onRowInput);
  $("#plist").addEventListener("change", onRowInput);
  $("#plist").addEventListener("click", (e) => {
    const k = e.target.dataset.del; if (!k) return;
    rows = rows.filter((r) => r.k !== +k); renderRows();
  });
  $("#church").addEventListener("change", updateSum);
  $("#addP").onclick = () => { rows.push(newRow()); renderRows(); const el = document.getElementById("pn" + rows[rows.length - 1].k); el && el.focus(); };
  rows = [newRow(), newRow(), newRow()];
  renderRows();

  $("#regForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#formErr"); err.hidden = true;
    const filled = rows.filter((r) => r.name.trim());
    const problems = [];
    if (!$("#church").value) problems.push("gereja asal");
    if ($("#coord").value.trim().length < 2) problems.push("nama koordinator");
    if (!/^(\+62|62|0)8\d{7,12}$/.test($("#phone").value.replace(/[\s-]/g, ""))) problems.push("nomor WhatsApp yang valid (mulai 08…)");
    if (!filled.length) problems.push("minimal satu peserta");
    if (filled.some((r) => !r.gender || !/^\d{1,2}$/.test(String(r.age).trim()))) problems.push("jenis kelamin dan usia setiap peserta");
    if (filled.some((r) => +r.age < 18) && !$("#consent").checked) problems.push("persetujuan izin orang tua untuk peserta di bawah 18 tahun");
    if (problems.length) { err.textContent = "Lengkapi dulu: " + problems.join(", ") + "."; err.hidden = false; return; }
    const btn = $("#submitBtn"); btn.disabled = true; btn.textContent = "Mengirim…";
    try {
      const res = await fetch("/api/registrations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          church_id: Number($("#church").value), coordinator: $("#coord").value, phone: $("#phone").value, consent: $("#consent").checked,
          participants: filled.map((r) => ({ name: r.name, role: r.role, gender: r.gender, age: Number(r.age) })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Pendaftaran gagal terkirim.");
      saveReg({ code: data.code, token: data.status_token, church: data.church });
      go("/status.html?t=" + encodeURIComponent(data.status_token) + "&baru=1");
    } catch (x) {
      err.textContent = x.message === "Failed to fetch" ? "Tidak ada koneksi. Cek internet lalu coba lagi." : x.message;
      err.hidden = false; btn.disabled = false; btn.textContent = "Kirim pendaftaran";
    }
  });

  // ---------- Cek status ----------
  const saved = readSaved();
  if (saved.length) {
    const box = $("#myRegs"); box.hidden = false;
    box.innerHTML = "Pendaftaran dari perangkat ini: " + saved.map((r) => `<a href="/status.html?t=${encodeURIComponent(r.token)}">${esc(r.code)}${r.church ? " · " + esc(r.church) : ""}</a>`).join(", ");
  }
  $("#lookupForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#lkErr"); err.hidden = true;
    try {
      const res = await fetch("/api/status/lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: $("#lkCode").value, phone: $("#lkPhone").value }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      go("/status.html?t=" + encodeURIComponent(data.status_token));
    } catch (x) { err.textContent = x.message === "Failed to fetch" ? "Tidak ada koneksi." : x.message; err.hidden = false; }
  });
})();
