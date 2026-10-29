// Halaman masuk panitia (dipisah dari HTML supaya bisa memakai Content-Security-Policy ketat)
document.addEventListener("error", (e) => { const t = e.target; if (t && t.tagName === "IMG" && t.hasAttribute("data-rm")) t.remove(); }, true);
(function () {
  const $ = (s) => document.querySelector(s);
  const params = new URLSearchParams(location.search);
  // Hanya izinkan kembali ke halaman di dalam /admin/ supaya tautan login tidak bisa dipakai mengalihkan ke situs lain
  let next = params.get("next") || "/admin/";
  if (!/^\/admin\/(?!login)/.test(next) && next !== "/wallboard.html") next = "/admin/";
  if (params.get("keluar") === "1") $("#outMsg").hidden = false;
  if (window.StageArt) window.StageArt.attach();

  fetch("/api/auth/me").then((r) => (r.ok ? r.json() : null)).then((d) => { if (d && d.user && d.user.role === "admin") location.replace(next); }).catch(() => {});
  setTimeout(() => $("#lgUser").focus(), 50);

  $("#showPw").onclick = () => {
    const inp = $("#lgPass"), show = inp.type === "password";
    inp.type = show ? "text" : "password";
    $("#showPw").textContent = show ? "Sembunyikan" : "Lihat";
    $("#showPw").setAttribute("aria-pressed", String(show));
  };

  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#lgErr"), btn = $("#lgBtn");
    err.hidden = true;
    if (!$("#lgUser").value.trim() || !$("#lgPass").value) { err.textContent = "Isi username dan password."; err.hidden = false; return; }
    btn.disabled = true; btn.textContent = "Memeriksa…";
    try {
      const res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: $("#lgUser").value.trim(), password: $("#lgPass").value }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      location.replace(next);
    } catch (x) {
      err.textContent = x.message === "Failed to fetch" ? "Tidak bisa menghubungi server. Cek koneksi internet." : x.message;
      err.hidden = false; btn.disabled = false; btn.textContent = "Masuk ke meja panitia";
    }
  });
})();
