// Musik latar. Browser memblokir suara sebelum pengunjung berinteraksi, jadi musik mulai pada sentuhan/tombol pertama.
// Tanpa file musik: memainkan pad worship orisinal yang dibangkitkan browser (bebas hak cipta).
// Dengan file musik (diatur admin, wajib berlisensi): memutar file tersebut berulang.
(function () {
  const $ = (s) => document.querySelector(s);
  const btn = $("#muteBtn"), icon = $("#muteIcon"), state = $("#npState"), title = $("#npTitle");
  if (!btn) return;
  const bars = [...document.querySelectorAll("#vu i")];
  const PLAY = "M8 5v14l11-7z", PAUSE = "M7 5h4v14H7zM13 5h4v14h-4z";
  let muted = false;
  try { muted = localStorage.getItem("rpk-muted") === "1"; } catch (_) {}
  let playing = false, engine = null;

  // --- Mesin pad (WebAudio) ---
  function padEngine() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    const ctx = new AC();
    const master = ctx.createGain(); master.gain.value = 0.9;
    const filter = ctx.createBiquadFilter(); filter.type = "lowpass"; filter.frequency.value = 1100; filter.Q.value = 0.4;
    const delay = ctx.createDelay(); delay.delayTime.value = 0.42;
    const fb = ctx.createGain(); fb.gain.value = 0.38;
    const analyser = ctx.createAnalyser(); analyser.fftSize = 512;
    filter.connect(master); filter.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(master);
    master.connect(analyser); analyser.connect(ctx.destination);
    const CHORDS = [[48, 55, 64, 67, 72], [43, 50, 59, 62, 67], [45, 52, 60, 64, 69], [41, 48, 57, 60, 65]]; // C G Am F
    const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
    let step = 0, timer = null;
    function chord() {
      const t = ctx.currentTime, notes = CHORDS[step++ % CHORDS.length];
      notes.forEach((m, n) => {
        [[0, "triangle", 0.028], [-8, "sawtooth", 0.007], [8, "sawtooth", 0.007]].forEach(([det, type, peak]) => {
          const o = ctx.createOscillator(), g = ctx.createGain();
          o.type = type; o.frequency.value = hz(m); o.detune.value = det;
          const p = n === 0 ? peak * 1.3 : peak;
          g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(p, t + 1.8);
          g.gain.setValueAtTime(p, t + 4.2); g.gain.linearRampToValueAtTime(0, t + 7.5);
          o.connect(g); g.connect(filter); o.start(t); o.stop(t + 7.6);
        });
      });
    }
    return {
      start() { ctx.resume(); if (!timer) { chord(); timer = setInterval(chord, 4800); } },
      stop() { clearInterval(timer); timer = null; ctx.suspend(); },
      level() {
        const d = new Uint8Array(analyser.fftSize); analyser.getByteTimeDomainData(d);
        let s = 0; for (const v of d) { const x = (v - 128) / 128; s += x * x; }
        return Math.min(10, Math.round(Math.sqrt(s / d.length) * 70));
      },
    };
  }

  // --- Mesin file audio ---
  function fileEngine(url) {
    const a = new Audio(url); a.loop = true; a.preload = "none"; a.volume = 0.7;
    let phase = 0;
    return {
      start() { return a.play(); },
      stop() { a.pause(); },
      level() { phase += 0.3; return a.paused ? 0 : Math.round(4 + 3 * Math.abs(Math.sin(phase)) + Math.random() * 2); },
    };
  }

  let musicUrl = "";
  function meter() {
    if (!playing || !engine) { bars.forEach((b) => (b.className = "")); return; }
    const lvl = engine.level();
    bars.forEach((b, i) => { b.className = i < lvl ? "on" + (i >= 8 ? " peak" : i >= 6 ? " hot" : "") : ""; });
    requestAnimationFrame(meter);
  }
  function ui() {
    icon.setAttribute("d", playing ? PAUSE : PLAY);
    btn.setAttribute("aria-pressed", String(playing));
    btn.setAttribute("aria-label", playing ? "Hentikan musik latar" : "Putar musik latar");
    state.textContent = playing ? "Sedang diputar" : muted ? "Dihentikan" : "Mulai saat kamu menyentuh halaman";
  }
  function start() {
    if (!engine) engine = musicUrl ? fileEngine(musicUrl) : padEngine();
    if (!engine) return;
    const p = engine.start();
    playing = true; ui(); meter();
    if (p && p.catch) p.catch(() => { playing = false; ui(); });
  }
  function stop() { if (engine) engine.stop(); playing = false; ui(); }

  btn.addEventListener("click", () => {
    if (playing) { stop(); muted = true; } else { muted = false; start(); }
    try { localStorage.setItem("rpk-muted", muted ? "1" : "0"); } catch (_) {}
  });
  function firstTouch(e) {
    if (e.target && e.target.closest && e.target.closest("#muteBtn")) return;
    ["pointerdown", "keydown", "touchstart"].forEach((t) => document.removeEventListener(t, firstTouch, true));
    if (!muted && !playing) start();
  }
  ["pointerdown", "keydown", "touchstart"].forEach((t) => document.addEventListener(t, firstTouch, true));
  ui();

  window.RPKMusic = {
    configure({ url, label }) {
      if (url && !engine) musicUrl = url;
      if (label) title.textContent = label;
    },
  };
})();
