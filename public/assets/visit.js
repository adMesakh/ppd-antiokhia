// Penghitung pengunjung website (untuk wallboard panitia). Hanya ID acak per perangkat; tanpa nama, IP, atau cookie pelacak.
(function () {
  try {
    let vid = localStorage.getItem("rpk-vid");
    if (!vid) { vid = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 20); localStorage.setItem("rpk-vid", vid); }
    const body = JSON.stringify({ vid, path: location.pathname });
    const blob = new Blob([body], { type: "application/json" });
    if (!(navigator.sendBeacon && navigator.sendBeacon("/api/visit", blob))) fetch("/api/visit", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
  } catch (_) {}
})();
