// Latar cahaya panggung yang tidak fokus (bokeh), digambar browser. Dipakai bila foto belum ada atau gagal dimuat.
// Hasilnya selalu sama untuk seed yang sama.
(function () {
  const THEMES = {
    ember: ["#1A0A04", "#5A1D08", "#F07A2A", "#FFD08A"],
    violet: ["#0B0618", "#2A1250", "#B44CF0", "#FFB6F2"],
    teal: ["#03110F", "#0B3B3A", "#2FD3B5", "#C9FFF2"],
    gold: ["#140C02", "#4A3008", "#F2B233", "#FFF1C2"],
    rose: ["#160509", "#4E1020", "#F2546E", "#FFD1D8"],
  };
  function rng(seed) {
    let a = seed >>> 0;
    return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function paint(canvas) {
    const seed = Number(canvas.dataset.seed || 1);
    const [deep, mid, light, spark] = THEMES[canvas.dataset.theme] || THEMES.ember;
    const r = rng(seed);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, canvas.clientWidth), h = Math.max(1, canvas.clientHeight);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const g = canvas.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bg = g.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, deep); bg.addColorStop(0.55, mid); bg.addColorStop(1, deep);
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = "lighter";
    const blur = (px) => { try { g.filter = px ? `blur(${px}px)` : "none"; } catch (_) {} };
    const S = Math.max(w, h);
    // cahaya panggung yang tidak fokus: bola cahaya besar dan lembut
    const orbs = 3 + Math.floor(r() * 2);
    for (let i = 0; i < orbs; i++) {
      const x = w * (0.15 + r() * 0.7), y = h * (0.15 + r() * 0.5), rad = S * (0.25 + r() * 0.3);
      const og = g.createRadialGradient(x, y, 0, x, y, rad);
      const c = i % 2 ? spark : light;
      og.addColorStop(0, c + "B0"); og.addColorStop(0.4, c + "40"); og.addColorStop(1, "transparent");
      g.fillStyle = og; g.fillRect(0, 0, w, h);
    }
    // berkas cahaya tipis dan buram
    blur(Math.max(8, S / 40));
    for (let i = 0; i < 3; i++) {
      const x = w * (0.2 + r() * 0.6), spread = w * (0.1 + r() * 0.12), tilt = (r() - 0.5) * w * 0.5;
      const lg = g.createLinearGradient(x, 0, x + tilt, h);
      lg.addColorStop(0, light + "38"); lg.addColorStop(1, "transparent");
      g.fillStyle = lg;
      g.beginPath(); g.moveTo(x - 4, -10); g.lineTo(x + 4, -10); g.lineTo(x + tilt + spread, h); g.lineTo(x + tilt - spread, h); g.closePath(); g.fill();
    }
    // bokeh: lingkaran cahaya buram
    blur(2);
    const n = 10 + Math.floor(r() * 10);
    for (let i = 0; i < n; i++) {
      const x = r() * w, y = r() * h * 0.85, rad = S * (0.012 + r() * 0.05);
      g.fillStyle = (r() < 0.5 ? spark : light) + (r() < 0.5 ? "22" : "40");
      g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
    }
    blur(0);
    g.globalCompositeOperation = "source-over";
    // gelapkan atas dan bawah supaya teks di atasnya tetap terbaca
    const v = g.createLinearGradient(0, 0, 0, h);
    v.addColorStop(0, "rgba(0,0,0,.35)"); v.addColorStop(0.35, "rgba(0,0,0,0)"); v.addColorStop(0.7, "rgba(0,0,0,.15)"); v.addColorStop(1, "rgba(0,0,0,.6)");
    g.fillStyle = v; g.fillRect(0, 0, w, h);
  }
  const ro = "ResizeObserver" in window ? new ResizeObserver((es) => es.forEach((e) => paint(e.target))) : null;
  window.StageArt = {
    attach(root) {
      (root || document).querySelectorAll("canvas[data-art]").forEach((c) => {
        if (c.dataset.bound) return; c.dataset.bound = "1";
        paint(c); if (ro) ro.observe(c);
      });
    },
  };
})();
