// Pratinjau landing page satu file (data contoh, tanpa server) untuk dilihat sebagai artifact.
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const LOGO = "data:image/png;base64," + fs.readFileSync(path.join(__dirname, "logo-160.png")).toString("base64");
const rd = (p) => fs.readFileSync(path.join(root, p), "utf8").split("/assets/logo.png").join(LOGO);
const bodyOf = (f) => rd(f).split(/<body[^>]*>/)[1].split("</body>")[0].replace(/<script[\s\S]*?<\/script>/g, "");
const landingBody = bodyOf("public/index.html");
const daftarBody = bodyOf("public/daftar.html").replace(/<svg width="0" height="0"[\s\S]*?<\/svg>/, "");
const body = `<div id="pageLanding">${landingBody}</div><div id="pageDaftar" hidden>${daftarBody}</div>`;

const shim = `
(function () {
  const now = new Date();
  const data = {
    settings: { event_name: "PPD Antiokhia 2027", title_line1: "PPD Antiokhia", title_line2: "Satu tubuh, satu suara", tagline: "Retreat pemuda antar gereja · Kalimantan Barat",
      start_at: "2027-07-06T08:00:00+07:00", end_at: "2027-07-09T17:00:00+07:00", dates_label: "6–9 Juli 2027", location: "Kalimantan Barat",
      est_churches: 40, est_participants: 600, fee_per_person: 150000, payment_note: "Bayar tunai ke bendahara panitia. Sebutkan kode pendaftaran saat membayar.",
      contact: "Panitia · 0812-0000-0000", registration_open: true, results_published: false, music_url: "", spotify_url: "https://open.spotify.com/search/NDC%20Worship" },
    churches: [["GBI Rock Singkawang","Singkawang"],["Gereja Bethel Sintang","Sintang"],["GKE Imanuel","Ketapang"],["GKII Jemaat Sanggau","Sanggau"],["GKII Jemaat Sungai Raya","Kubu Raya"],["GPdI Siloam","Pontianak"],["GPIB Maranatha","Pontianak"],["HKBP Pontianak","Pontianak"]].map(([name, city], i) => ({ id: i + 1, name, city })),
    lineup: [{ id: 1, name: "Pembicara utama (contoh)", tier: "utama", note: "Hari 1 dan 2" }, { id: 2, name: "Pembicara seminar (contoh)", tier: "pembicara", note: "Seminar 3" }, { id: 3, name: "Bintang tamu (contoh)", tier: "tamu", note: "Malam penutupan" }],
    sessions: [
      { id: 1, title: "Registrasi ulang", kind: "checkin", day: 1, starts_at: "08:00", ends_at: "10:00", location: "Pintu utama", speaker: "" },
      { id: 2, title: "Seminar 1: Identitas di dalam Kristus", kind: "seminar", day: 1, starts_at: "10:30", ends_at: "12:00", location: "Aula utama", speaker: "" },
      { id: 3, title: "Seminar 2: Panggilan generasi", kind: "seminar", day: 1, starts_at: "15:00", ends_at: "16:30", location: "Aula utama", speaker: "" },
      { id: 4, title: "Seminar 3: Relasi yang sehat", kind: "seminar", day: 2, starts_at: "09:00", ends_at: "10:30", location: "Aula utama", speaker: "" },
      { id: 5, title: "Seminar 4: Melayani di kampung halaman", kind: "seminar", day: 3, starts_at: "09:00", ends_at: "10:30", location: "Aula utama", speaker: "" }],
    photos: [], stats: { churches: 0, participants: 0 }, results: null,
  };
  const json = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: { "Content-Type": "application/json" } });
  window.fetch = async (u, o) => {
    const url = new URL(String(u), "https://contoh.local");
    if (url.pathname === "/api/public") return json(data);
    if (url.pathname === "/api/registrations") {
      const b = JSON.parse((o && o.body) || "{}");
      const c = data.churches.find((x) => x.id === b.church_id);
      return json({ code: "PPD27-" + Math.random().toString(36).slice(2, 7).toUpperCase(), status_token: "contoh", status: "menunggu", church: c ? c.name : "", participants: (b.participants || []).length }, 201);
    }
    if (url.pathname === "/api/status/lookup") return json({ error: "Ini pratinjau dengan data contoh, jadi belum ada pendaftaran yang bisa dicek." }, 404);
    return json({ error: "Tidak tersedia di pratinjau" }, 404);
  };
  function show(page, hash) {
    const daftar = page === "daftar";
    document.getElementById("pageDaftar").hidden = !daftar;
    document.getElementById("pageLanding").hidden = daftar;
    document.body.classList.toggle("no-player", daftar);
    const pl = document.querySelector(".player"); if (pl) pl.hidden = daftar;
    const el = hash && document.getElementById(hash.slice(1));
    requestAnimationFrame(() => { if (el && !el.closest("[hidden]")) el.scrollIntoView(); else window.scrollTo(0, 0); });
  }
  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("a[href]"); if (!a) return;
    const h = a.getAttribute("href");
    if (h.startsWith("/daftar.html")) { e.preventDefault(); show("daftar", h.slice(12)); }
    else if (h === "/" || h.startsWith("/#")) { e.preventDefault(); show("landing", h.slice(1)); }
  }, true);
  window.RPKPreview = { go(url) {
    const t = document.getElementById("toast");
    t.textContent = "Pendaftaran contoh terkirim. Di versi asli, halaman status dan pass peserta terbuka di sini.";
    t.hidden = false; clearTimeout(t._t); t._t = setTimeout(() => (t.hidden = true), 4200);
    const btn = document.getElementById("submitBtn"); btn.disabled = false; btn.textContent = "Kirim pendaftaran";
  } };
})();`;

const fonts = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap">';
const out = `<title>PPD Antiokhia</title>
<meta name="claude:viewport-fit-sides" content="cover">
${fonts}
<style>${rd("public/assets/site.css")}</style>
${body}
<script>${shim}</script>
<script>${rd("public/assets/photos.js")}</script>
<script>${rd("public/assets/stage-art.js")}</script>
<script>${rd("public/assets/music.js")}</script>
<script>${rd("public/assets/landing.js")}</script>
<script>${rd("public/assets/daftar.js")}</script>
`;
const file = path.join(__dirname, "landing-preview.html");
fs.writeFileSync(file, out);
console.log("OK", file, Math.round(out.length / 1024) + " KB");
