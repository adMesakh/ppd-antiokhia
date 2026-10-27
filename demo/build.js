// Merakit demo satu file: dashboard admin + scanner asli, dijalankan di atas server tiruan (mock.js).
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const LOGO = "data:image/png;base64," + fs.readFileSync(path.join(__dirname, "logo-160.png")).toString("base64");
const rd = (p) => fs.readFileSync(path.join(root, p), "utf8").split("/assets/logo.png").join(LOGO);
const body = (html) => html.split(/<body[^>]*>/)[1].split("</body>")[0].replace(/<script[\s\S]*?<\/script>/g, "");
const must = (s, a, b) => { if (!s.includes(a)) throw new Error("Patch tidak ketemu: " + a); return s.split(a).join(b); };

// ----- admin -----
let adminJs = rd("public/admin/admin.js");
adminJs = must(adminJs, 'window.addEventListener("hashchange", route);', "__H.on(route);");
adminJs = adminJs.replace(/location\.hash/g, "__H.hash");
adminJs = adminJs.replace(/location\.origin/g, '"https://retreat.contoh.id"');
adminJs = must(adminJs, 'window.open("/admin/print.html?" + q, "_blank");', 'parent.RPKDemo.print("?" + q);');
adminJs = must(adminJs, 'location.replace("/admin/login.html?keluar=1");', 'parent.RPKDemo.link("/admin/login.html");');
const adminShim = `
window.fetch = (u, o) => parent.RPKDemo.fetch(u, o || {}, "admin");
window.__H = { hash: "#ringkasan", fns: [], on(f) { this.fns.push(f); }, set(h) { this.hash = h; this.fns.forEach((f) => f()); }, refresh() { this.fns.forEach((f) => f()); } };
document.addEventListener("click", (e) => {
  const a = e.target.closest && e.target.closest("a[href]"); if (!a) return;
  const h = a.getAttribute("href"); e.preventDefault();
  if (h.startsWith("#")) __H.set(h); else parent.RPKDemo.link(h);
}, true);
const fixQr = (root) => (root.querySelectorAll ? root.querySelectorAll('img[src^="/api/qr/"]') : []).forEach((img) => {
  const m = /\\/api\\/qr\\/([^.]+)\\.svg/.exec(img.getAttribute("src")); if (m) img.src = parent.RPKDemo.qr(decodeURIComponent(m[1]));
});
new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType === 1) { if (n.matches && n.matches('img[src^="/api/qr/"]')) fixQr(n.parentNode); fixQr(n); } }))).observe(document.documentElement, { childList: true, subtree: true });
`;
const adminDoc = `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@800;900&family=Instrument+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@500&display=swap">
<style>${rd("public/admin/admin.css")}</style><script>${adminShim}</script></head><body>${body(rd("public/admin/index.html"))}<script>${adminJs}</script></body></html>`;

// ----- scanner -----
let scanHtml = body(rd("public/scan/index.html"));
scanHtml = must(scanHtml, '<input id="lgUser" autocomplete="username" autocapitalize="none">', '<input id="lgUser" autocomplete="username" autocapitalize="none" value="scan-pintu1">');
scanHtml = must(scanHtml, '<input id="lgPass" type="password" autocomplete="current-password">', '<input id="lgPass" type="password" autocomplete="current-password" value="pintu12345">');
scanHtml = must(scanHtml, '<div class="note err" id="lgErr" hidden></div>', '<p class="muted small">Akun demo sudah terisi: scan-pintu1 / pintu12345</p><div class="note err" id="lgErr" hidden></div>');
let scanCss = rd("public/scan/scan.css").replace("url(/scan/icon-192.png)", "url(" + LOGO + ") center/cover,#FFF");
const scanShim = `
window.fetch = (u, o) => parent.RPKDemo.fetch(u, o || {}, "scan");
try { Object.defineProperty(navigator, "onLine", { get: () => parent.RPKDemo.net !== "offline", configurable: true }); } catch (_) {}
try { if (!navigator.mediaDevices) Object.defineProperty(navigator, "mediaDevices", { value: {}, configurable: true }); navigator.mediaDevices.getUserMedia = () => parent.RPKDemo.camera(); } catch (_) {}
`;
const scanDoc = `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${scanCss}</style><script>${scanShim}</script></head><body>${scanHtml}
<script src="https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js"></script>
<script>${rd("public/scan/store.js")}</script><script>${must(rd("public/scan/app.js"), 'if ("serviceWorker" in navigator) {', "if (false) {")}</script></body></html>`;

const lit = (s) => JSON.stringify(s).replace(/<\//g, "<\\/").replace(/<!--/g, "<\\!--");
let shell = rd("demo/shell.html");
shell = must(shell, "/*MOCK*/", rd("demo/mock.js").replace(/<\//g, "<\\/"));
shell = must(shell, '/*ADMIN_DOC*/""', lit(adminDoc));
shell = must(shell, '/*SCAN_DOC*/""', lit(scanDoc));
const out = path.join(__dirname, "demo-panitia-scanner.html");
fs.writeFileSync(out, shell);
console.log("OK", out, Math.round(shell.length / 1024) + " KB");
