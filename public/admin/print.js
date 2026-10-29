// Halaman cetak ID card (dipisah dari HTML supaya bisa memakai Content-Security-Policy ketat)
(async function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const res = await fetch("/api/admin/print" + location.search, { credentials: "same-origin" });
  if (res.status === 401) { location.href = "/admin/login.html?next=" + encodeURIComponent(location.pathname + location.search); return; }
  const d = await res.json();
  const list = d.participants || [];
  document.getElementById("info").textContent = `${list.length} kartu · ${Math.ceil(list.length / 4)} halaman A4. Atur printer: tanpa skala (100%), warna.`;
  if (!list.length) { document.getElementById("sheet").outerHTML = `<p class="empty">Tidak ada peserta lunas untuk dicetak.</p>`; return; }
  document.getElementById("sheet").innerHTML = list.map((p) => `
    <div class="card${p.role === "gembala" ? " gold" : ""}">
      <div class="hole"></div>
      <div class="band">${p.role === "gembala" ? "Gembala sidang" : "Peserta"}</div>
      <div class="mid"><img src="/api/qr/${encodeURIComponent(p.qr_token)}.svg" alt=""><div class="nm">${esc(p.name)}</div><div class="ch">${esc(p.church)}</div><div class="code">${esc(p.code)}</div></div>
      <div class="evt"><img src="/assets/logo.png" alt=""><span class="nm2">${esc(d.event_name)}</span><span>${esc(d.dates_label)}</span></div>
    </div>`).join("");
  const imgs = [...document.images];
  await Promise.all(imgs.map((i) => i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; })));
  const btn = document.getElementById("printBtn"); btn.disabled = false; btn.onclick = () => window.print();
})();
