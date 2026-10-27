// Penyimpanan lokal scanner (IndexedDB) + logika sinkronisasi.
// File ini dipakai halaman aplikasi DAN service worker (sinkron di latar belakang), jadi tidak boleh menyentuh DOM.
(function (root) {
  const DB_NAME = "rpk-scan";
  const VERSION = 1;
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore("kv");
        const p = db.createObjectStore("participants", { keyPath: "id" });
        p.createIndex("qr", "qr", { unique: true });
        p.createIndex("code", "code", { unique: true });
        db.createObjectStore("sessions", { keyPath: "id" });
        db.createObjectStore("churches", { keyPath: "id" });
        const s = db.createObjectStore("scans", { keyPath: "local_id" });
        s.createIndex("synced", "synced");
        s.createIndex("session_id", "session_id");
        db.createObjectStore("known", { keyPath: "key" }); // gabungan scan lokal + data server, untuk deteksi "sudah tercatat"
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }

  const wrap = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
  async function tx(stores, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(stores, mode);
      let out;
      Promise.resolve(fn(t)).then((v) => { out = v; }, reject);
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error("Transaksi dibatalkan"));
    });
  }

  const S = {
    open,
    get: (store, key) => tx([store], "readonly", (t) => wrap(t.objectStore(store).get(key))),
    put: (store, val, key) => tx([store], "readwrite", (t) => wrap(key === undefined ? t.objectStore(store).put(val) : t.objectStore(store).put(val, key))),
    del: (store, key) => tx([store], "readwrite", (t) => wrap(t.objectStore(store).delete(key))),
    all: (store) => tx([store], "readonly", (t) => wrap(t.objectStore(store).getAll())),
    count: (store) => tx([store], "readonly", (t) => wrap(t.objectStore(store).count())),
    byIndex: (store, index, val) => tx([store], "readonly", (t) => wrap(t.objectStore(store).index(index).get(val))),
    allByIndex: (store, index, val) => tx([store], "readonly", (t) => wrap(t.objectStore(store).index(index).getAll(val))),
    kv: (key) => S.get("kv", key),
    setKv: (key, val) => S.put("kv", val, key),
  };

  S.keyOf = (p, s) => `${p}_${s}`;

  // Simpan dataset dari server menggantikan yang lama. Scan lokal TIDAK ikut terhapus.
  S.saveDataset = async function (d) {
    const scans = await S.all("scans");
    await tx(["participants", "sessions", "churches", "known", "kv"], "readwrite", (t) => {
      for (const n of ["participants", "sessions", "churches", "known"]) t.objectStore(n).clear();
      const P = t.objectStore("participants"), SS = t.objectStore("sessions"), C = t.objectStore("churches"), K = t.objectStore("known");
      d.participants.forEach((p) => P.put(p));
      d.sessions.forEach((s) => SS.put(s));
      d.churches.forEach((c) => C.put(c));
      d.attendance.forEach((a) => K.put({ key: S.keyOf(a.p, a.s), p: a.p, s: a.s, t: a.t, src: "server" }));
      scans.filter((x) => x.synced !== 2).forEach((x) => K.put({ key: S.keyOf(x.participant_id, x.session_id), p: x.participant_id, s: x.session_id, t: x.scanned_at, src: "local" }));
      t.objectStore("kv").put({ at: d.generated_at, event_name: d.event_name, participants: d.participants.length, sessions: d.sessions.length }, "dataset");
      t.objectStore("kv").put(d.generated_at, "pulled_at");
    });
  };

  // Catat satu kehadiran. Mengembalikan {status:"ok"|"dup", time}
  S.record = async function (participantId, sessionId, method) {
    const deviceId = (await S.kv("device_id")) || "hp";
    const key = S.keyOf(participantId, sessionId);
    return tx(["known", "scans"], "readwrite", async (t) => {
      const K = t.objectStore("known");
      const existing = await wrap(K.get(key));
      if (existing) return { status: "dup", time: existing.t };
      const now = new Date().toISOString();
      const local_id = `${deviceId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      t.objectStore("scans").put({ local_id, participant_id: participantId, session_id: sessionId, scanned_at: now, method, synced: 0 });
      K.put({ key, p: participantId, s: sessionId, t: now, src: "local" });
      return { status: "ok", time: now };
    });
  };

  S.pendingCount = () => tx(["scans"], "readonly", (t) => wrap(t.objectStore("scans").index("synced").count(0)));

  // Cek koneksi yang sebenarnya: WiFi berbayar yang belum login akan mengembalikan halaman login, bukan JSON server ini.
  S.probe = async function () {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return "offline";
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      const res = await fetch("/api/ping?ts=" + Date.now(), { cache: "no-store", signal: ctrl.signal, redirect: "manual" });
      clearTimeout(timer);
      if (res.type === "opaqueredirect" || !res.ok) return "captive";
      const j = await res.json().catch(() => null);
      return j && j.app === "rpk" ? "online" : "captive";
    } catch (_) {
      return "offline";
    }
  };

  async function authed(url, opts = {}) {
    const auth = await S.kv("auth");
    if (!auth || !auth.token) { const e = new Error("Belum login"); e.code = "auth"; throw e; }
    const res = await fetch(url, { ...opts, cache: "no-store", headers: { ...(opts.headers || {}), Authorization: "Bearer " + auth.token, ...(opts.body ? { "Content-Type": "application/json" } : {}) } });
    if (res.status === 401) { const e = new Error("Sesi login berakhir. Login ulang untuk sinkron. Scan tetap aman di HP."); e.code = "auth"; throw e; }
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("application/json")) { const e = new Error("Koneksi dialihkan. WiFi mungkin perlu login."); e.code = "captive"; throw e; }
    const data = await res.json();
    if (!res.ok) { const e = new Error(data.error || "Server menolak permintaan."); e.code = "server"; throw e; }
    return data;
  }
  S.authed = authed;

  S.downloadDataset = async function () {
    const d = await authed("/api/scanner/dataset");
    await S.saveDataset(d);
    return d;
  };

  let syncing = null;
  S.syncNow = function () {
    if (syncing) return syncing;
    syncing = (async () => {
      const state = await S.probe();
      if (state !== "online") { const e = new Error(state === "captive" ? "WiFi perlu login atau server tidak terjangkau." : "Tidak ada koneksi."); e.code = state; throw e; }
      const deviceId = (await S.kv("device_id")) || "hp";
      let sent = 0, dup = 0, rejected = 0;
      const pending = await S.allByIndex("scans", "synced", 0);
      for (let i = 0; i < pending.length; i += 400) {
        const batch = pending.slice(i, i + 400);
        const r = await authed("/api/scanner/sync", { method: "POST", body: JSON.stringify({ device_id: deviceId, records: batch.map(({ local_id, participant_id, session_id, scanned_at, method }) => ({ local_id, participant_id, session_id, scanned_at, method })) }) });
        const acc = new Set(r.accepted), dupMap = new Map(r.duplicates.map((x) => [x.local_id, x.scanned_at])), rej = new Map(r.rejected.map((x) => [x.local_id, x.reason]));
        await tx(["scans"], "readwrite", (t) => {
          const st = t.objectStore("scans");
          for (const s of batch) {
            if (acc.has(s.local_id)) { s.synced = 1; sent++; }
            else if (dupMap.has(s.local_id)) { s.synced = 1; s.note = "Sudah tercatat oleh HP lain"; dup++; }
            else if (rej.has(s.local_id)) { s.synced = 2; s.note = rej.get(s.local_id); rejected++; }
            else continue;
            st.put(s);
          }
        });
      }
      // Ambil scan dari HP lain supaya deteksi "sudah tercatat" makin akurat
      const since = await S.kv("pulled_at");
      const pull = await authed("/api/scanner/attendance" + (since ? "?since=" + encodeURIComponent(since) : ""));
      await tx(["known", "kv"], "readwrite", (t) => {
        const K = t.objectStore("known");
        pull.rows.forEach((a) => K.put({ key: S.keyOf(a.p, a.s), p: a.p, s: a.s, t: a.t, src: "server" }));
        t.objectStore("kv").put(pull.server_time, "pulled_at");
        t.objectStore("kv").put(new Date().toISOString(), "last_sync");
      });
      return { sent, dup, rejected, pulled: pull.rows.length };
    })();
    syncing.finally(() => { syncing = null; }).catch(() => {});
    return syncing;
  };

  root.RPKStore = S;
})(typeof self !== "undefined" ? self : window);
