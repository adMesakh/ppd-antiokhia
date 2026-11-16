(function () {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const rupiah = (n) => "Rp" + Math.round(n).toLocaleString("id-ID");
  const ROLE = { gembala: "Gembala sidang", peserta: "Peserta" };
  const params = new URLSearchParams(location.search);
  const token = params.get("t");
  const isNew = params.get("baru") === "1";

  if (!token) { $("#head").textContent = "Tautan tidak lengkap"; $("#box").innerHTML = `<p class="lede">Buka halaman ini dari tautan status pendaftaran, atau cek status di <a href="/daftar.html#cek-status">halaman cek status</a>.</p>`; return; }

  async function load() {
    try {
      const res = await fetch("/api/status/" + encodeURIComponent(token), { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      render(d);
    } catch (e) {
      $("#head").textContent = "Tidak ditemukan";
      $("#box").innerHTML = `<p class="lede">${esc(e.message === "Failed to fetch" ? "Tidak ada koneksi internet. Coba lagi nanti." : e.message)}</p>`;
    }
  }

  function render(d) {
    const st = d.status;
    $("#head").textContent = st === "lunas" ? "Pass siap dicetak" : st === "batal" ? "Pendaftaran dibatalkan" : "Menunggu pembayaran";
    const pill = st === "lunas" ? `<span class="pill ok">Lunas</span>` : st === "batal" ? `<span class="pill no">Dibatalkan</span>` : `<span class="pill wait">Menunggu pembayaran</span>`;
    const link = location.origin + "/status.html?t=" + encodeURIComponent(token);
    $("#box").className = "";
    $("#box").innerHTML = `
      ${isNew && st === "menunggu" ? `<div class="thanks"><h2>Terima kasih, pendaftaran terkirim!</h2><p>Selesaikan pembayaran di bawah supaya pass peserta bisa terbit.</p></div>` : ""}
      ${st === "menunggu" ? payCard(d) : ""}
      <div class="panel">
        <div class="status-head">
          <div style="display:grid;gap:6px"><span class="eyebrow">Kode pendaftaran</span><span class="code">${esc(d.code)}</span></div>
          ${pill}
        </div>
        <dl class="kv">
          <dt>Gereja</dt><dd>${esc(d.church)}${d.city ? ", " + esc(d.city) : ""}</dd>
          <dt>Pendaftar</dt><dd>${esc(d.coordinator)} · ${esc(d.phone)}</dd>
          <dt>Peserta</dt><dd>${d.participants.length} orang${d.total ? " · total " + rupiah(d.total) : ""}</dd>
        </dl>
        ${st === "menunggu" ? `<p class="fine">Halaman ini berubah otomatis setelah panitia mengonfirmasi pembayaran.</p>` : ""}
        ${st === "lunas" ? `<p class="fine">Pembayaran sudah dikonfirmasi. Pass di bawah ini akan dicetak panitia dan dibagikan saat registrasi ulang. Peserta tidak perlu membawa HP.</p>` : ""}
        <div style="display:grid;gap:6px">
          <span class="eyebrow">Tautan status (simpan atau kirim ke grup gereja)</span>
          <div class="copyrow"><input id="lnk" readonly value="${esc(link)}" aria-label="Tautan status"><button type="button" class="btn-ghost btn-small" id="copyBtn">Salin</button></div>
        </div>
      </div>
      ${st === "lunas"
        ? `<div class="badges">${d.participants.map((p) => `
            <div class="pass${p.role === "gembala" ? " gold" : ""}">
              <div class="slot"></div><div class="band">${esc(ROLE[p.role])}</div>
              <div class="body"><div class="qr"><img src="/api/qr/${encodeURIComponent(p.qr)}.svg" alt="QR ${esc(p.name)}" width="112" height="112"></div>
              <div class="nm">${esc(p.name)}</div><div class="ch">${esc(d.church)}</div><div class="id">${esc(p.code)}</div></div>
              <div class="evt"><img src="/assets/logo.png" alt="">PPD Antiokhia</div>
            </div>`).join("")}</div>`
        : `<div class="panel"><h3>Daftar peserta</h3><ol class="plist">${d.participants.map((p) => `<li>${esc(p.name)} <span class="fine">· ${esc(ROLE[p.role])} · ${p.gender === "P" ? "Perempuan" : "Laki-laki"}</span></li>`).join("")}</ol>
           <p class="fine">Ada data yang salah? Hubungi panitia dengan menyebutkan nomor WhatsApp-mu.</p></div>`}`;
    document.querySelectorAll("[data-copy]").forEach((b) => (b.onclick = async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy); const t = b.textContent; b.textContent = "Tersalin"; setTimeout(() => (b.textContent = t), 1500); } catch (_) {}
    }));
    $("#copyBtn").onclick = async () => {
      const inp = $("#lnk");
      try { await navigator.clipboard.writeText(inp.value); $("#copyBtn").textContent = "Tersalin"; }
      catch (_) { inp.select(); }
    };
    if (st === "menunggu" && !window.__poll) window.__poll = setInterval(load, 30000);
    if (st !== "menunggu" && window.__poll) { clearInterval(window.__poll); window.__poll = null; }
    try {
      const list = JSON.parse(localStorage.getItem("rpk-regs") || "[]").filter((x) => x.token !== token);
      list.unshift({ code: d.code, token, church: d.church });
      localStorage.setItem("rpk-regs", JSON.stringify(list.slice(0, 10)));
    } catch (_) {}
  }
  // Kartu pembayaran: total transfer, rekening panitia, dan tombol kirim bukti ke WhatsApp panitia
  function payCard(d) {
    const P = d.payment || {}, digits = String(P.bank_account || "").replace(/[^0-9]/g, "");
    const wa = P.whatsapp ? `https://wa.me/${P.whatsapp}?text=${encodeURIComponent(
      `Halo panitia PPD Antiokhia, saya sudah transfer uang pendaftaran.\n\nKode: ${d.code}\nGereja: ${d.church}\nPeserta: ${d.participants.length} orang\nTotal: ${rupiah(d.total)}\n\nBerikut bukti transfernya.`)}` : "";
    return `<div class="panel paycard">
      <div class="pay-total"><span class="eyebrow">Total yang perlu ditransfer</span><b>${rupiah(d.total)}</b>
        <span class="fine">${d.participants.length} peserta × ${rupiah(d.fee_per_person)}</span>
        ${d.total ? `<button type="button" class="btn-ghost btn-small" data-copy="${d.total}">Salin jumlah</button>` : ""}</div>
      ${P.bank_account ? `<dl class="kv pay-bank">
          <dt>Bank</dt><dd>${esc(P.bank_name || "-")}</dd>
          <dt>No. rekening</dt><dd class="acc"><span>${esc(P.bank_account)}</span><button type="button" class="btn-ghost btn-small" data-copy="${esc(digits)}">Salin</button></dd>
          <dt>Atas nama</dt><dd>${esc(P.bank_holder || "-")}</dd>
        </dl>` : ""}
      <ol class="pay-steps">
        <li>${P.bank_account ? "Transfer sesuai total ke rekening di atas." : esc(d.payment_note)}</li>
        <li>Kirim bukti transfer ke WhatsApp panitia.</li>
        <li>Panitia mengonfirmasi, lalu pass peserta muncul di halaman ini.</li>
      </ol>
      ${wa ? `<a class="btn btn-sun wa-btn" href="${esc(wa)}" target="_blank" rel="noopener">Kirim bukti ke WhatsApp panitia</a>` : ""}
    </div>`;
  }
  load();
})();
