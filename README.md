# PPD Antiokhia

Website pendaftaran, dashboard panitia, scanner kehadiran offline, dan wallboard TV untuk retreat pemuda antar gereja se-Kalimantan Barat.

Panduan untuk panitia (tanpa istilah teknis) ada di **[PANDUAN.md](PANDUAN.md)**.

| Alamat | Untuk | Isi |
|---|---|---|
| `/` | Publik | Info acara, jadwal, pembicara, dokumentasi |
| `/daftar.html` | Pendaftar | Daftar sendiri atau rombongan, cek status |
| `/status.html?t=…` | Pendaftar | Status pembayaran dan pass QR |
| `/admin/` | Panitia | Pendaftaran & pembayaran tunai, peserta & QR, gereja, jadwal & kehadiran, hasil, galeri, konten, akun |
| `/scan/` | Petugas (HP Android) | Scanner QR yang tetap jalan tanpa internet, sinkron otomatis |
| `/wallboard.html` | TV/monitor | Ringkasan pendaftaran dan acara yang sedang berlangsung |

## Teknologi

- Node.js 20+ dan Express, dijalankan sebagai Vercel Function.
- Database PostgreSQL: Neon di Vercel; PGlite (Postgres di dalam folder `data/`, tanpa instalasi) saat di laptop.
- File unggahan (foto, lagu): Vercel Blob; folder `data/uploads` saat di laptop.
- Frontend HTML/CSS/JavaScript biasa tanpa proses build. Scanner: service worker + IndexedDB, QR dibaca dengan `BarcodeDetector` atau `jsQR`.

## Pasang di Vercel

1. **Impor repo** di vercel.com/new → Application Preset **Express** → isi Environment Variable `ADMIN_PASSWORD` → Deploy.
2. **Storage → Neon** (region Singapore), sambungkan ke proyek. `DATABASE_URL` terisi otomatis.
3. **Storage → Blob** (akses Public, region Singapore), sambungkan ke proyek.
4. **Redeploy**, lalu buka `/admin` dan ganti password.

Tabel database dibuat otomatis. Setiap `git push` ke `main` otomatis ter-deploy.

## Menjalankan di laptop

```bash
cp .env.example .env    # isi ADMIN_PASSWORD
npm install
npm start               # http://localhost:3000, admin di /admin
```

## Pengujian

```bash
npm test                                   # PGlite
DATABASE_URL=postgres://… npm test         # PostgreSQL sungguhan
```

Uji ujung-ke-ujung dengan Chromium (butuh `ffmpeg` dan `python3`): pendaftaran, pembayaran, scanner offline & WiFi berbayar, sinkron tanpa duplikat, unggah foto & lagu, wallboard, hak akses, dan pemeriksaan keamanan di bawah.

## Keamanan & data

- **Akses.** Admin login dengan cookie `HttpOnly`/`SameSite`; setiap perubahan data wajib membawa header `X-RPK` (anti-CSRF). Scanner memakai token Bearer dan tidak bisa membuka API admin. Wallboard TV memakai link khusus yang hanya bisa membaca data wallboard dan bisa dicabut.
- **Password & sesi.** Password di-hash dengan scrypt. Token sesi hanya disimpan sebagai hash SHA-256, jadi isi database yang bocor tidak bisa dipakai untuk login. Sesi admin 14 hari, scanner 14 hari.
- **Pembatasan.** Login, pendaftaran, dan cek status dibatasi per IP. Gagal login juga dibatasi per akun + IP, jadi menebak password dibatasi tanpa membuat orang lain bisa mengunci akun panitia. Formulir pendaftaran punya kolom jebakan bot.
- **Header.** Content-Security-Policy ketat (`script-src 'self'`, tanpa skrip inline), HSTS, anti-iframe, `nosniff`, `Referrer-Policy: same-origin`. Halaman admin, scanner, status, dan wallboard tidak diindeks mesin pencari dan API sensitif tidak di-cache.
- **Data pribadi.** Yang dikumpulkan hanya nama, status, jenis kelamin, gereja, dan satu nomor WhatsApp per pendaftaran. Nomor WA disamarkan di halaman status dan tidak pernah tampil di wallboard. Penghitung pengunjung hanya memakai ID acak, tanpa IP. Setelah acara, admin bisa menghapus semua nomor WA dan menonaktifkan semua akun scanner dari menu Akun & scanner. Export CSV aman dari rumus Excel berbahaya.
- **Unggahan.** Foto diperiksa dari isi filenya (JPG/PNG/WebP), lagu hanya MP3 maksimal 15 MB, nama file dibuat server.
- **Rahasia.** Tidak ada password, token, atau data peserta di repo. Semua rahasia ada di Environment Variables Vercel. Dependabot mengecek pembaruan keamanan dependensi tiap minggu.

Menemukan celah keamanan? Hubungi pengelola repo secara pribadi, jangan lewat issue publik.

## Cadangan

```bash
DATABASE_URL=postgres://… npm run backup   # → data/backup/ppd-<waktu>.json
```

Neon juga menyimpan riwayat database beberapa hari ke belakang. File cadangan berisi data pribadi peserta: simpan di tempat yang aman dan hapus bila sudah tidak perlu.

## Struktur

```
index.js         titik masuk Vercel
vercel.json      region, redirect, header keamanan & cache (dibuat dari server/headers.js)
server/          index.js (API), auth.js, db.js (skema), headers.js, storage.js, stats.js, util.js, start.js (laptop), backup.js
public/          landing, daftar, status, wallboard, assets/
public/admin/    dashboard panitia, login, cetak ID card
public/scan/     PWA scanner (app.js, store.js, sw.js)
tests/           e2e.js
```
