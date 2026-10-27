// Server tiruan untuk demo: meniru API asli (server/index.js) di dalam browser, data disimpan di localStorage.
(function () {
  const KEY = "rpk-demo-v1";
  const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const rnd = (n) => { let s = ""; const b = crypto.getRandomValues(new Uint8Array(n)); for (const x of b) s += ALPHA[x % ALPHA.length]; return s; };
  const now = () => new Date().toISOString();
  let D;

  const DEFAULT_SETTINGS = {
    event_name: "PPD Antiokhia 2027", title_line1: "PPD Antiokhia", title_line2: "Satu tubuh, satu suara",
    tagline: "Retreat pemuda antar gereja · Kalimantan Barat", start_at: "2027-07-06T08:00:00+07:00", end_at: "2027-07-09T17:00:00+07:00",
    dates_label: "6–9 Juli 2027", location: "Kalimantan Barat", est_churches: 40, est_participants: 600, fee_per_person: 150000,
    payment_note: "Bayar tunai ke bendahara panitia. Sebutkan kode pendaftaran saat membayar.", contact: "Panitia · 0812-0000-0000",
    registration_open: true, results_published: false, min_participants_for_activity: 5, music_url: "",
    spotify_url: "https://open.spotify.com/search/NDC%20Worship", code_prefix: "PPD27",
  };

  function seed() {
    const d = { seq: {}, settings: { ...DEFAULT_SETTINGS }, users: [], tokens: {}, churches: [], lineup: [], registrations: [], participants: [], sessions: [], attendance: [], contests: [], photos: [] };
    const id = (t) => (d.seq[t] = (d.seq[t] || 0) + 1);
    d.users.push({ id: id("users"), username: "admin", name: "Admin utama", role: "admin", password: "admin", active: 1 });
    d.users.push({ id: id("users"), username: "scan-pintu1", name: "Petugas Pintu 1", role: "scanner", password: "pintu12345", active: 1 });
    d.users.push({ id: id("users"), username: "scan-pintu2", name: "Petugas Pintu 2", role: "scanner", password: "pintu12345", active: 1 });
    [["GKII Jemaat Sungai Raya", "Kubu Raya"], ["GPdI Siloam", "Pontianak"], ["GBI Rock Singkawang", "Singkawang"], ["GKE Imanuel", "Ketapang"],
      ["HKBP Pontianak", "Pontianak"], ["GPIB Maranatha", "Pontianak"], ["GKII Jemaat Sanggau", "Sanggau"], ["Gereja Bethel Sintang", "Sintang"]]
      .forEach(([name, city]) => d.churches.push({ id: id("churches"), name, city, created_at: now() }));
    d.lineup.push({ id: id("lineup"), name: "Pembicara utama (contoh)", tier: "utama", note: "", sort: 0 });
    d.lineup.push({ id: id("lineup"), name: "Pembicara 2 (contoh)", tier: "pembicara", note: "", sort: 0 });
    d.lineup.push({ id: id("lineup"), name: "Bintang tamu (contoh)", tier: "tamu", note: "", sort: 0 });
    [["Registrasi ulang", "checkin", 1, "08:00", "10:00", "Pintu utama"], ["Seminar 1: Identitas di dalam Kristus", "seminar", 1, "10:30", "12:00", "Aula"],
      ["Seminar 2: Panggilan generasi", "seminar", 1, "15:00", "16:30", "Aula"], ["Seminar 3: Relasi yang sehat", "seminar", 2, "09:00", "10:30", "Aula"],
      ["Seminar 4: Melayani di kampung halaman", "seminar", 3, "09:00", "10:30", "Aula"]]
      .forEach(([title, kind, day, s, e, loc]) => d.sessions.push({ id: id("sessions"), title, kind, day, starts_at: s, ends_at: e, location: loc, speaker: "", created_at: now() }));
    const first = ["Yohanes", "Maria", "Kevin", "Grace", "Daniel", "Ester", "Samuel", "Natalia", "Yosua", "Debora", "Andreas", "Priskila", "Timotius", "Lidia", "Stefanus", "Rut", "Markus", "Agnes", "Filipus", "Kezia", "Rafael", "Sarah", "Gideon", "Febiola", "Jonathan", "Theresia", "Petrus", "Anastasia", "Bernard", "Clara", "Imanuel", "Vania", "Elia", "Yuliana", "Krisna", "Monika", "Aldo", "Melati", "Reinhard", "Yemima", "Jefri", "Olivia", "Ruben", "Tabita"];
    const last = ["Saputra", "Wijaya", "Simanjuntak", "Lumban Gaol", "Pratama", "Siregar", "Tamba", "Ginting", "Hutapea", "Nainggolan", "Kristanto", "Setiawan", "Hendrawan", "Lase", "Manurung"];
    let ni = 0;
    const person = () => { const f = first[ni % first.length], l = last[(ni * 7) % last.length]; ni++; return `${f} ${l}`; };
    const regs = [[1, 9, "lunas"], [2, 6, "lunas"], [3, 5, "lunas"], [4, 4, "menunggu"], [5, 7, "lunas"], [7, 3, "menunggu"], [8, 2, "batal"]];
    const coords = ["Andre", "Rina", "Sinta", "Daniel", "Hotma", "Yakobus", "Lusi"];
    regs.forEach(([churchId, n, status], i) => {
      const code = `PPD27-${rnd(5)}`;
      const created = new Date(Date.now() - (20 - i * 2) * 864e5).toISOString();
      const reg = { id: id("registrations"), code, status_token: rnd(20), church_id: churchId, coordinator: coords[i], phone: `08125${String(1000000 + i * 1371).slice(1)}`, consent: 1, fee_per_person: 150000, status, source: "online", note: "", created_at: created, confirmed_at: status === "lunas" ? created : null, confirmed_by: status === "lunas" ? 1 : null };
      d.registrations.push(reg);
      for (let k = 0; k < n; k++) {
        const pastor = k === 0;
        d.participants.push({ id: id("participants"), registration_id: reg.id, church_id: churchId, seq: k + 1, code: `${code}-${String(k + 1).padStart(3, "0")}`, qr_token: "R" + rnd(11),
          name: pastor ? "Pdt. " + person() : person(), role: pastor ? "gembala" : "peserta", gender: k % 2 ? "P" : "L", age: pastor ? 38 + i : 15 + ((k * 3 + i) % 12), created_at: created });
      }
    });
    // Sebagian peserta sudah check-in lewat HP lain (Petugas Pintu 2) dan sudah tersinkron
    const lunasIds = new Set(d.registrations.filter((r) => r.status === "lunas").map((r) => r.id));
    d.participants.filter((p) => lunasIds.has(p.registration_id) && (p.church_id === 1 || p.church_id === 5)).slice(0, 12).forEach((p, i) => {
      const t = new Date(Date.now() - (40 - i) * 60e3).toISOString();
      d.attendance.push({ id: id("attendance"), participant_id: p.id, session_id: 1, scanned_at: t, method: "qr", device_id: "hp-pintu2", user_id: 3, received_at: t });
    });
    return d;
  }

  function load() { try { const s = localStorage.getItem(KEY); if (s) { D = JSON.parse(s); D.photos = D.photos || []; return; } } catch (_) {} D = seed(); }
  function save() { try { localStorage.setItem(KEY, JSON.stringify({ ...D, photos: [] })); } catch (_) {} }
  load();
  const nid = (t) => (D.seq[t] = (D.seq[t] || 0) + 1);

  // ---------- helper ----------
  const E = (status, msg) => { const e = new Error(msg); e.status = status; return e; };
  const clean = (v, max = 120) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const phoneNorm = (v) => { let d = String(v ?? "").replace(/[^\d+]/g, ""); if (d.startsWith("+62")) d = "0" + d.slice(3); else if (d.startsWith("62")) d = "0" + d.slice(2); return /^08\d{7,12}$/.test(d) ? d : null; };
  const church = (id) => D.churches.find((c) => c.id === id);
  const reg = (id) => D.registrations.find((r) => r.id === id);
  const user = (id) => D.users.find((u) => u.id === id);
  const sess = (id) => D.sessions.find((s) => s.id === id);
  const partsOf = (rid) => D.participants.filter((p) => p.registration_id === rid).sort((a, b) => a.seq - b.seq);
  const isLunasP = (p) => reg(p.registration_id)?.status === "lunas";
  const scansOf = (pid) => D.attendance.filter((a) => a.participant_id === pid).length;
  const tierOrd = { utama: 0, pembicara: 1, tamu: 2 };
  const byName = (a, b) => a.name.localeCompare(b.name, "id", { sensitivity: "base" });
  const sortSessions = (a, b) => a.day - b.day || String(a.starts_at).localeCompare(String(b.starts_at)) || a.id - b.id;
  const newQr = () => { let t; do { t = "R" + rnd(11); } while (D.participants.some((p) => p.qr_token === t)); return t; };
  function validParticipant(p) {
    const name = clean(p?.name, 80), age = Number(p?.age);
    if (name.length < 2 || !["gembala", "peserta"].includes(p?.role) || !["L", "P"].includes(p?.gender) || !Number.isInteger(age) || age < 5 || age > 99) return null;
    return { name, role: p.role, gender: p.gender, age };
  }
  function addParticipant(r, seq, v) {
    D.participants.push({ id: nid("participants"), registration_id: r.id, church_id: r.church_id, seq, code: `${r.code}-${String(seq).padStart(3, "0")}`, qr_token: newQr(), ...v, created_at: now() });
  }

  function rankings() {
    const minP = Math.max(1, Number(D.settings.min_participants_for_activity) || 1);
    const seminarIds = new Set(D.sessions.filter((s) => s.kind === "seminar").map((s) => s.id));
    const all = D.churches.map((c) => {
      const ps = D.participants.filter((p) => p.church_id === c.id && isLunasP(p));
      const pids = new Set(ps.map((p) => p.id));
      const att = D.attendance.filter((a) => pids.has(a.participant_id));
      const present = new Set(att.map((a) => a.participant_id)).size;
      const sem = att.filter((a) => seminarIds.has(a.session_id)).length;
      const per = ps.length ? sem / ps.length : 0;
      return { church_id: c.id, church: c.name, city: c.city, confirmed: ps.length, present, seminar_scans: sem, seminar_per_person: Math.round(per * 100) / 100,
        seminar_rate: seminarIds.size ? Math.round((per / seminarIds.size) * 1000) / 10 : 0, eligible_activity: ps.length >= minP };
    });
    return {
      seminar_count: seminarIds.size, min_participants: minP, all,
      most_participants: all.filter((r) => r.present > 0).sort((a, b) => b.present - a.present || b.confirmed - a.confirmed),
      most_active: all.filter((r) => r.eligible_activity && r.seminar_scans > 0).sort((a, b) => b.seminar_per_person - a.seminar_per_person || b.confirmed - a.confirmed),
    };
  }
  const contestsView = () => D.contests.map((c) => ({ ...c, church: church(c.church_id)?.name || null })).sort((a, b) => a.contest.localeCompare(b.contest) || a.rank - b.rank);

  function createReg({ church_id, coordinator, phone, participants, status, fee, note, source, userId }) {
    let code; do { code = `${D.settings.code_prefix || "RP"}-${rnd(5)}`; } while (D.registrations.some((r) => r.code === code));
    const r = { id: nid("registrations"), code, status_token: rnd(20), church_id, coordinator, phone, consent: 1, fee_per_person: fee, status, source, note: note || "", created_at: now(), confirmed_at: status === "lunas" ? now() : null, confirmed_by: status === "lunas" ? userId : null };
    D.registrations.push(r);
    participants.forEach((p, i) => addParticipant(r, i + 1, p));
    return r;
  }

  // ---------- rute ----------
  const R = [];
  const on = (m, re, fn) => R.push([m, re, fn]);

  on("GET", /^\/api\/ping$/, () => ({ ok: true, app: "rpk", time: now() }));
  on("GET", /^\/api\/auth\/me$/, (m, q, b, ctx) => ctx.who === "admin" ? { user: { id: 1, username: "admin", name: "Admin utama", role: "admin" } } : (() => { throw E(401, "Belum login."); })());
  on("POST", /^\/api\/auth\/logout$/, (m, q, b, ctx) => { if (ctx.token) delete D.tokens[ctx.token]; return { ok: true }; });
  on("POST", /^\/api\/auth\/login$/, (m, q, b) => {
    const u = D.users.find((x) => x.username.toLowerCase() === clean(b.username).toLowerCase());
    if (!u || !u.active || u.password !== String(b.password || "")) throw E(401, "Username atau password salah.");
    if (b.mode !== "scanner" && u.role !== "admin") throw E(403, "Akun ini hanya untuk scanner.");
    const token = "demo-" + rnd(16);
    D.tokens[token] = { user_id: u.id, label: clean(b.device, 60) };
    log(`${u.name} login di ${clean(b.device, 30) || "HP"}`);
    return { token, expires: new Date(Date.now() + 45 * 864e5).toISOString(), user: { id: u.id, username: u.username, name: u.name, role: u.role } };
  });

  // admin
  on("GET", /^\/api\/admin\/summary$/, () => {
    const ps = D.participants.map((p) => ({ p, r: reg(p.registration_id) }));
    const cnt = (f) => ps.filter(f).length;
    const att = D.attendance;
    return {
      registrations: { waiting: D.registrations.filter((r) => r.status === "menunggu").length, paid: D.registrations.filter((r) => r.status === "lunas").length, cancelled: D.registrations.filter((r) => r.status === "batal").length },
      participants: { waiting: cnt((x) => x.r.status === "menunggu"), paid: cnt((x) => x.r.status === "lunas"), pastors: cnt((x) => x.r.status === "lunas" && x.p.role === "gembala"),
        male: cnt((x) => x.r.status === "lunas" && x.p.gender === "L"), female: cnt((x) => x.r.status === "lunas" && x.p.gender === "P"), minors: cnt((x) => x.r.status === "lunas" && x.p.age < 18) },
      money: { received: ps.filter((x) => x.r.status === "lunas").reduce((s, x) => s + x.r.fee_per_person, 0), outstanding: ps.filter((x) => x.r.status === "menunggu").reduce((s, x) => s + x.r.fee_per_person, 0) },
      churches: { total: D.churches.length, paid: new Set(D.registrations.filter((r) => r.status === "lunas").map((r) => r.church_id)).size },
      attendance: { scans: att.length, people: new Set(att.map((a) => a.participant_id)).size, last: att.map((a) => a.received_at).sort().pop() || null },
      recent: [...D.registrations].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 8).map((r) => ({ id: r.id, code: r.code, status: r.status, created_at: r.created_at, church: church(r.church_id).name, n: partsOf(r.id).length })),
    };
  });
  on("GET", /^\/api\/admin\/settings$/, () => D.settings);
  on("PUT", /^\/api\/admin\/settings$/, (m, q, b) => {
    for (const k of Object.keys(DEFAULT_SETTINGS)) if (k in b) {
      const def = DEFAULT_SETTINGS[k];
      D.settings[k] = typeof def === "number" ? Math.max(0, Math.round(Number(b[k]) || 0)) : typeof def === "boolean" ? !!b[k] : clean(b[k], 400);
    }
    return D.settings;
  });

  on("GET", /^\/api\/admin\/churches$/, () => [...D.churches].sort(byName).map((c) => ({ ...c,
    registrations: D.registrations.filter((r) => r.church_id === c.id && r.status !== "batal").length,
    paid_participants: D.participants.filter((p) => p.church_id === c.id && isLunasP(p)).length })));
  on("POST", /^\/api\/admin\/churches$/, (m, q, b) => {
    const items = typeof b.bulk === "string" ? b.bulk.split(/\r?\n/).map((l) => l.split(/[;,\t]/).map((x) => clean(x))).filter((x) => x[0]).map(([name, city]) => ({ name, city: city || "" })) : [{ name: clean(b.name), city: clean(b.city, 80) }];
    if (!items.length || !items[0].name) throw E(400, "Isi nama gereja.");
    let added = 0;
    for (const it of items) if (!D.churches.some((c) => c.name.toLowerCase() === it.name.toLowerCase())) { D.churches.push({ id: nid("churches"), ...it, created_at: now() }); added++; }
    return { added, skipped: items.length - added };
  });
  on("PUT", /^\/api\/admin\/churches\/(\d+)$/, (m, q, b) => {
    const c = church(+m[1]); if (!c) throw E(404, "Gereja tidak ditemukan.");
    const name = clean(b.name); if (!name) throw E(400, "Nama gereja tidak boleh kosong.");
    if (D.churches.some((x) => x.id !== c.id && x.name.toLowerCase() === name.toLowerCase())) throw E(400, "Nama gereja sudah ada.");
    c.name = name; c.city = clean(b.city, 80); return { ok: true };
  });
  on("DELETE", /^\/api\/admin\/churches\/(\d+)$/, (m) => {
    if (D.registrations.some((r) => r.church_id === +m[1])) throw E(400, "Gereja ini sudah punya pendaftaran, jadi tidak bisa dihapus.");
    D.churches = D.churches.filter((c) => c.id !== +m[1]); return { ok: true };
  });

  on("GET", /^\/api\/admin\/lineup$/, () => [...D.lineup].sort((a, b) => tierOrd[a.tier] - tierOrd[b.tier] || a.sort - b.sort || a.id - b.id));
  on("POST", /^\/api\/admin\/lineup$/, (m, q, b) => {
    const name = clean(b.name, 80); if (!name || !tierOrd.hasOwnProperty(b.tier)) throw E(400, "Isi nama dan pilih peran.");
    D.lineup.push({ id: nid("lineup"), name, tier: b.tier, note: clean(b.note), sort: Number(b.sort) || 0 }); return { ok: true };
  });
  on("DELETE", /^\/api\/admin\/lineup\/(\d+)$/, (m) => { D.lineup = D.lineup.filter((l) => l.id !== +m[1]); return { ok: true }; });

  const ST_ORD = { menunggu: 0, lunas: 1, batal: 2 };
  on("GET", /^\/api\/admin\/registrations$/, (m, q) => {
    const s = q.get("status"), term = (q.get("q") || "").toLowerCase();
    return D.registrations.filter((r) => (!s || r.status === s) && (!term || [r.code, r.coordinator, r.phone, church(r.church_id).name].some((x) => x.toLowerCase().includes(term))))
      .sort((a, b) => ST_ORD[a.status] - ST_ORD[b.status] || b.created_at.localeCompare(a.created_at))
      .map((r) => { const ps = partsOf(r.id); const c = church(r.church_id); return { ...r, church: c.name, city: c.city, confirmed_by_name: user(r.confirmed_by)?.name || null, n: ps.length, pastors: ps.filter((p) => p.role === "gembala").length }; });
  });
  on("GET", /^\/api\/admin\/registrations\/(\d+)$/, (m) => {
    const r = reg(+m[1]); if (!r) throw E(404, "Pendaftaran tidak ditemukan.");
    return { ...r, church: church(r.church_id), participants: partsOf(r.id).map((p) => ({ ...p, scans: scansOf(p.id) })), status_url: `/status.html?t=${r.status_token}` };
  });
  on("POST", /^\/api\/admin\/registrations$/, (m, q, b, ctx) => {
    const c = church(Number(b.church_id)); if (!c) throw E(400, "Pilih gereja.");
    const phone = b.phone ? phoneNorm(b.phone) : "-"; if (!phone) throw E(400, "Nomor WhatsApp tidak valid.");
    const ps = [];
    for (const [i, p] of (b.participants || []).entries()) { const v = validParticipant(p); if (!v) throw E(400, `Data peserta nomor ${i + 1} belum lengkap.`); ps.push(v); }
    if (!ps.length) throw E(400, "Tambahkan minimal satu peserta.");
    const r = createReg({ church_id: c.id, coordinator: clean(b.coordinator, 80) || "Didaftarkan admin", phone, participants: ps, status: b.status === "lunas" ? "lunas" : "menunggu", fee: Math.max(0, Math.round(Number(b.fee_per_person) || 0)), note: clean(b.note, 300), source: "admin", userId: 1 });
    return { id: r.id, code: r.code, status: r.status };
  });
  on("PUT", /^\/api\/admin\/registrations\/(\d+)$/, (m, q, b) => {
    const r = reg(+m[1]); if (!r) throw E(404, "Pendaftaran tidak ditemukan.");
    const phone = b.phone !== undefined ? (phoneNorm(b.phone) || (b.phone === "-" ? "-" : null)) : r.phone; if (!phone) throw E(400, "Nomor WhatsApp tidak valid.");
    r.coordinator = clean(b.coordinator ?? r.coordinator, 80); r.phone = phone; r.note = clean(b.note ?? r.note, 300);
    if (b.fee_per_person !== undefined) r.fee_per_person = Math.max(0, Math.round(Number(b.fee_per_person) || 0));
    return { ok: true };
  });
  on("PATCH", /^\/api\/admin\/registrations\/(\d+)\/status$/, (m, q, b) => {
    const r = reg(+m[1]); if (!r) throw E(404, "Pendaftaran tidak ditemukan.");
    if (!ST_ORD.hasOwnProperty(b.status)) throw E(400, "Status tidak dikenal.");
    r.status = b.status; r.confirmed_at = b.status === "lunas" ? now() : null; r.confirmed_by = b.status === "lunas" ? 1 : null;
    if (b.status === "lunas") log(`Admin menandai ${r.code} lunas · QR ${partsOf(r.id).length} peserta terbit`);
    return { ok: true };
  });
  on("DELETE", /^\/api\/admin\/registrations\/(\d+)$/, (m) => {
    const ps = partsOf(+m[1]);
    if (ps.some((p) => scansOf(p.id))) throw E(400, "Peserta di pendaftaran ini sudah punya data kehadiran. Ubah statusnya menjadi Batal saja.");
    D.participants = D.participants.filter((p) => p.registration_id !== +m[1]); D.registrations = D.registrations.filter((r) => r.id !== +m[1]); return { ok: true };
  });

  on("GET", /^\/api\/admin\/participants$/, (m, q) => {
    const st = q.get("status"), cid = Number(q.get("church_id")) || null, term = (q.get("q") || "").toLowerCase();
    return D.participants.map((p) => ({ p, r: reg(p.registration_id), c: church(p.church_id) }))
      .filter(({ p, r }) => (!st || r.status === st) && (!cid || p.church_id === cid) && (!term || p.name.toLowerCase().includes(term) || p.code.toLowerCase().includes(term)))
      .sort((a, b) => a.c.name.localeCompare(b.c.name) || byName(a.p, b.p))
      .map(({ p, r, c }) => ({ id: p.id, code: p.code, qr_token: p.qr_token, name: p.name, role: p.role, gender: p.gender, age: p.age, registration_id: r.id, registration_code: r.code, status: r.status, church_id: c.id, church: c.name, scans: scansOf(p.id) }));
  });
  on("POST", /^\/api\/admin\/registrations\/(\d+)\/participants$/, (m, q, b) => {
    const r = reg(+m[1]); if (!r) throw E(404, "Pendaftaran tidak ditemukan.");
    const v = validParticipant(b); if (!v) throw E(400, "Lengkapi nama, status, jenis kelamin, dan usia.");
    addParticipant(r, Math.max(0, ...partsOf(r.id).map((p) => p.seq)) + 1, v); return { ok: true };
  });
  on("PUT", /^\/api\/admin\/participants\/(\d+)$/, (m, q, b) => {
    const p = D.participants.find((x) => x.id === +m[1]); if (!p) throw E(404, "Peserta tidak ditemukan.");
    const v = validParticipant(b); if (!v) throw E(400, "Lengkapi nama, status, jenis kelamin, dan usia.");
    Object.assign(p, v); return { ok: true };
  });
  on("DELETE", /^\/api\/admin\/participants\/(\d+)$/, (m) => {
    if (scansOf(+m[1])) throw E(400, "Peserta ini sudah punya data kehadiran, jadi tidak bisa dihapus.");
    D.participants = D.participants.filter((p) => p.id !== +m[1]); return { ok: true };
  });
  on("POST", /^\/api\/admin\/participants\/(\d+)\/reissue$/, (m) => {
    const p = D.participants.find((x) => x.id === +m[1]); if (!p) throw E(404, "Peserta tidak ditemukan.");
    p.qr_token = newQr(); log(`QR baru terbit untuk ${p.name}. QR lama tidak berlaku setelah HP mengunduh ulang data`); return { ok: true };
  });
  on("GET", /^\/api\/admin\/print$/, (m, q) => {
    const cid = Number(q.get("church_id")) || null, rid = Number(q.get("registration_id")) || null;
    const ids = q.get("ids") ? new Set(q.get("ids").split(",").map(Number)) : null;
    return { event_name: D.settings.event_name, dates_label: D.settings.dates_label,
      participants: D.participants.filter((p) => isLunasP(p) && (!cid || p.church_id === cid) && (!rid || p.registration_id === rid) && (!ids || ids.has(p.id)))
        .map((p) => ({ code: p.code, qr_token: p.qr_token, name: p.name, role: p.role, church: church(p.church_id).name }))
        .sort((a, b) => a.church.localeCompare(b.church) || a.role.localeCompare(b.role) || a.name.localeCompare(b.name)) };
  });

  function sessionBody(b) {
    const title = clean(b.title), day = Number(b.day), t = (v) => /^\d{2}:\d{2}$/.test(String(v || "")) ? String(v) : "";
    if (!title || !["checkin", "seminar"].includes(b.kind) || !Number.isInteger(day) || day < 1 || day > 14) throw E(400, "Isi judul, jenis, dan hari ke-berapa.");
    return { title, kind: b.kind, day, starts_at: t(b.starts_at), ends_at: t(b.ends_at), location: clean(b.location, 80), speaker: clean(b.speaker, 80) };
  }
  on("GET", /^\/api\/admin\/sessions$/, () => [...D.sessions].sort(sortSessions).map((s) => ({ ...s, scans: D.attendance.filter((a) => a.session_id === s.id).length })));
  on("POST", /^\/api\/admin\/sessions$/, (m, q, b) => { D.sessions.push({ id: nid("sessions"), ...sessionBody(b), created_at: now() }); return { ok: true }; });
  on("PUT", /^\/api\/admin\/sessions\/(\d+)$/, (m, q, b) => { const s = sess(+m[1]); if (s) Object.assign(s, sessionBody(b)); return { ok: true }; });
  on("DELETE", /^\/api\/admin\/sessions\/(\d+)$/, (m) => { D.attendance = D.attendance.filter((a) => a.session_id !== +m[1]); D.sessions = D.sessions.filter((s) => s.id !== +m[1]); return { ok: true }; });

  on("GET", /^\/api\/admin\/attendance$/, (m, q) => {
    const sid = Number(q.get("session_id")) || null, cid = Number(q.get("church_id")) || null;
    return D.attendance.map((a) => ({ a, p: D.participants.find((p) => p.id === a.participant_id), s: sess(a.session_id) }))
      .filter(({ a, p, s }) => p && s && (!sid || a.session_id === sid) && (!cid || p.church_id === cid))
      .sort((x, y) => y.a.scanned_at.localeCompare(x.a.scanned_at))
      .map(({ a, p, s }) => ({ id: a.id, scanned_at: a.scanned_at, received_at: a.received_at, method: a.method, device_id: a.device_id, code: p.code, name: p.name, role: p.role, church: church(p.church_id).name, session: s.title, kind: s.kind, scanner: user(a.user_id)?.name || "" }));
  });
  on("POST", /^\/api\/admin\/attendance$/, (m, q, b) => {
    const pid = Number(b.participant_id), sid = Number(b.session_id);
    if (D.attendance.some((a) => a.participant_id === pid && a.session_id === sid)) return { added: 0 };
    D.attendance.push({ id: nid("attendance"), participant_id: pid, session_id: sid, scanned_at: now(), method: "admin", device_id: "admin-web", user_id: 1, received_at: now() });
    return { added: 1 };
  });
  on("DELETE", /^\/api\/admin\/attendance\/(\d+)$/, (m) => { D.attendance = D.attendance.filter((a) => a.id !== +m[1]); return { ok: true }; });

  on("GET", /^\/api\/admin\/rankings$/, () => rankings());
  on("GET", /^\/api\/admin\/contests$/, () => contestsView());
  on("POST", /^\/api\/admin\/contests$/, (m, q, b) => {
    const contest = clean(b.contest, 80), winner = clean(b.winner), rank = Number(b.rank);
    if (!contest || !winner || !Number.isInteger(rank) || rank < 1) throw E(400, "Isi nama lomba, peringkat, dan pemenang.");
    D.contests.push({ id: nid("contests"), contest, rank, winner, church_id: church(Number(b.church_id)) ? Number(b.church_id) : null }); return { ok: true };
  });
  on("DELETE", /^\/api\/admin\/contests\/(\d+)$/, (m) => { D.contests = D.contests.filter((c) => c.id !== +m[1]); return { ok: true }; });

  on("GET", /^\/api\/admin\/photos$/, () => [...D.photos].reverse());
  on("POST", /^\/api\/admin\/photos$/, (m, q, b) => { if (!/^data:image\//.test(b.data || "")) throw E(400, "Format foto harus JPG, PNG, atau WebP."); D.photos.push({ id: nid("photos"), url: b.data, caption: clean(b.caption, 200), filename: "" }); return { ok: true }; });
  on("PUT", /^\/api\/admin\/photos\/(\d+)$/, (m, q, b) => { const p = D.photos.find((x) => x.id === +m[1]); if (p) p.caption = clean(b.caption, 200); return { ok: true }; });
  on("DELETE", /^\/api\/admin\/photos\/(\d+)$/, (m) => { D.photos = D.photos.filter((p) => p.id !== +m[1]); return { ok: true }; });

  on("GET", /^\/api\/admin\/users$/, () => D.users.map((u) => ({ id: u.id, username: u.username, name: u.name, role: u.role, active: u.active, created_at: now(),
    sessions: Object.values(D.tokens).filter((t) => t.user_id === u.id).length, scans: D.attendance.filter((a) => a.user_id === u.id).length })));
  on("POST", /^\/api\/admin\/users$/, (m, q, b) => {
    const username = clean(b.username, 40).toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw E(400, "Username 3–40 karakter: huruf kecil, angka, titik, strip.");
    if (String(b.password || "").length < 8) throw E(400, "Password minimal 8 karakter.");
    if (D.users.some((u) => u.username === username)) throw E(400, "Username sudah dipakai.");
    D.users.push({ id: nid("users"), username, name: clean(b.name, 60) || username, role: b.role === "admin" ? "admin" : "scanner", password: String(b.password), active: 1 });
    log(`Akun ${username} dibuat. Coba login dengan akun ini di HP`); return { ok: true };
  });
  on("PUT", /^\/api\/admin\/users\/(\d+)$/, (m, q, b) => {
    const u = user(+m[1]); if (!u) throw E(404, "Akun tidak ditemukan.");
    if (u.id === 1 && (b.active === false || b.role === "scanner")) throw E(400, "Kamu tidak bisa menonaktifkan akunmu sendiri.");
    if (b.password && String(b.password).length < 8) throw E(400, "Password minimal 8 karakter.");
    if (b.active !== undefined) u.active = b.active ? 1 : 0;
    if (b.password) u.password = String(b.password);
    if (b.name) u.name = clean(b.name, 60);
    if (!u.active || b.password) { for (const [t, v] of Object.entries(D.tokens)) if (v.user_id === u.id) delete D.tokens[t]; log(`Sesi login ${u.username} dicabut. HP-nya akan diminta login ulang saat sinkron`); }
    return { ok: true };
  });

  // scanner
  function scanUser(ctx) {
    const t = D.tokens[ctx.token]; const u = t && user(t.user_id);
    if (!u || !u.active) throw E(401, "Sesi berakhir. Silakan login lagi.");
    return u;
  }
  on("GET", /^\/api\/scanner\/dataset$/, (m, q, b, ctx) => {
    scanUser(ctx);
    const parts = D.participants.filter(isLunasP).map((p) => ({ id: p.id, code: p.code, qr: p.qr_token, name: p.name, role: p.role, church_id: p.church_id })).sort(byName);
    log(`HP mengunduh data: ${parts.length} peserta lunas, ${D.sessions.length} sesi`);
    return { generated_at: now(), event_name: D.settings.event_name, participants: parts, churches: [...D.churches].sort(byName).map(({ id, name, city }) => ({ id, name, city })),
      sessions: [...D.sessions].sort(sortSessions), attendance: D.attendance.map((a) => ({ p: a.participant_id, s: a.session_id, t: a.scanned_at })) };
  });
  on("POST", /^\/api\/scanner\/sync$/, (m, q, b, ctx) => {
    const u = scanUser(ctx);
    const accepted = [], duplicates = [], rejected = [];
    for (const r of b.records || []) {
      const pid = Number(r.participant_id), sid = Number(r.session_id);
      if (!D.participants.some((p) => p.id === pid)) { rejected.push({ local_id: r.local_id, reason: "Peserta sudah dihapus dari sistem" }); continue; }
      if (!sess(sid)) { rejected.push({ local_id: r.local_id, reason: "Sesi sudah dihapus dari sistem" }); continue; }
      const ex = D.attendance.find((a) => a.participant_id === pid && a.session_id === sid);
      if (ex) { duplicates.push({ local_id: r.local_id, scanned_at: ex.scanned_at }); continue; }
      D.attendance.push({ id: nid("attendance"), participant_id: pid, session_id: sid, scanned_at: new Date(r.scanned_at).toISOString(), method: r.method || "qr", device_id: clean(b.device_id, 60), user_id: u.id, received_at: now() });
      accepted.push(r.local_id);
    }
    if ((b.records || []).length) log(`HP mengirim ${b.records.length} scan → ${accepted.length} diterima${duplicates.length ? `, ${duplicates.length} sudah ada` : ""}${rejected.length ? `, ${rejected.length} ditolak` : ""}`, "ok");
    return { accepted, duplicates, rejected, server_time: now() };
  });
  on("GET", /^\/api\/scanner\/attendance$/, (m, q, b, ctx) => {
    scanUser(ctx);
    const since = q.get("since");
    return { rows: D.attendance.filter((a) => !since || a.received_at > since).map((a) => ({ p: a.participant_id, s: a.session_id, t: a.scanned_at, r: a.received_at })), server_time: now() };
  });

  // ---------- log aktivitas ----------
  const listeners = [];
  function log(text, kind) { const e = { t: new Date(), text, kind }; listeners.forEach((f) => f(e)); }

  // ---------- fetch tiruan ----------
  const api = {
    net: "online",
    onLog(f) { listeners.push(f); },
    log,
    data: () => D,
    reset() { try { localStorage.removeItem(KEY); } catch (_) {} D = seed(); },
    async fetch(input, opts = {}, who) {
      const url = new URL(typeof input === "string" ? input : input.url, "https://demo.local");
      const method = (opts.method || "GET").toUpperCase();
      await new Promise((r) => setTimeout(r, who === "scan" ? 220 : 90));
      if (who === "scan" && api.net === "offline") {
        if (url.pathname === "/api/scanner/sync") log("HP mencoba sinkron: tidak ada sinyal", "warn");
        throw new TypeError("Failed to fetch");
      }
      if (who === "scan" && api.net === "captive") {
        if (url.pathname === "/api/scanner/sync" || url.pathname === "/api/ping") log("HP tersambung WiFi berbayar, tapi diarahkan ke halaman login WiFi", "warn");
        return new Response("<html><body>Login WiFi · Rp5.000/jam</body></html>", { status: 200, headers: { "Content-Type": "text/html" } });
      }
      const hdr = opts.headers || {};
      const auth = (hdr.Authorization || hdr.authorization || "").replace(/^Bearer\s+/, "");
      let body = {};
      try { body = opts.body ? JSON.parse(opts.body) : {}; } catch (_) {}
      for (const [m, re, fn] of R) {
        if (m !== method) continue;
        const match = re.exec(url.pathname);
        if (!match) continue;
        try {
          const out = fn(match, url.searchParams, body, { who, token: auth });
          save();
          if (who === "scan" && api.onChange) api.onChange("scan");
          if (who === "admin" && method !== "GET" && api.onChange) api.onChange("admin");
          return new Response(JSON.stringify(out), { status: method === "POST" ? 201 : 200, headers: { "Content-Type": "application/json" } });
        } catch (e) {
          return new Response(JSON.stringify({ error: e.message }), { status: e.status || 500, headers: { "Content-Type": "application/json" } });
        }
      }
      return new Response(JSON.stringify({ error: "Alamat API tidak dikenal." }), { status: 404, headers: { "Content-Type": "application/json" } });
    },
  };
  window.RPKDemo = api;
})();
