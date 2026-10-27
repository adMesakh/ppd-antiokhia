# PPD Antiokhia

Satu aplikasi web berisi tiga bagian:

| Alamat | Untuk siapa | Isi |
|---|---|---|
| `/` | Publik | Landing page: hitung mundur, jadwal sebagai kartu sesi, lineup, papan skor, galeri, ajakan mendaftar |
| `/daftar.html` | Koordinator gereja | Formulir pendaftaran rombongan dan cek status (halaman terpisah dari landing) |
| `/status.html?t=…` | Koordinator gereja | Status pembayaran dan pass QR tiap peserta |
| `/admin/login.html` | Panitia | Halaman masuk. Membuka `/admin/` tanpa login otomatis diarahkan ke sini |
| `/admin/` | Panitia (laptop) | Pendaftaran & approval tunai, peserta & QR, cetak ID card, gereja, jadwal sesi, kehadiran, hasil & lomba, galeri, konten website, akun |
| `/admin/wallboard.html` | Panitia (TV/monitor) | Layar monitor: jumlah peserta, gereja, pengunjung website, peserta terbanyak per gereja, acara yang sedang berlangsung, pendaftaran terbaru. Perlu login admin |
| `/scan/` | Petugas scanner (HP Android) | PWA offline: scan kamera, cari nama, ketik kode, sinkron otomatis |

Panduan langkah demi langkah untuk panitia ada di **PANDUAN.md**.

## Teknologi

- Node.js 20+ dan Express. Database PostgreSQL: Neon saat di Vercel, atau PGlite (Postgres di dalam folder `data/pgdata`, tanpa instalasi) saat di laptop/VPS.
- Foto galeri: Vercel Blob saat di Vercel, folder `data/uploads` saat di laptop/VPS.
- Frontend HTML/CSS/JavaScript biasa tanpa proses build. Ubah file di `public/` lalu muat ulang browser.
- Scanner: service worker + IndexedDB. QR dibaca dengan `BarcodeDetector` bawaan Chrome Android, atau `jsQR` sebagai cadangan.

## Menjalankan di laptop

```bash
npm install
ADMIN_PASSWORD=passwordku npm start
# buka http://localhost:3000, admin di /admin
```

Tanpa `ADMIN_PASSWORD`, password admin pertama dibuat acak dan ditampilkan di terminal.

Catatan: kamera dan service worker hanya jalan di `https://` atau `localhost`. Untuk mencoba scanner dari HP, server harus sudah online dengan HTTPS.

## Pasang di Vercel (gratis, disarankan)

Butuh akun GitHub (repo ini) dan akun Vercel (daftar pakai GitHub di vercel.com).

1. **Impor repo.** Buka vercel.com/new → pilih repo `ppd-antiokhia` → **Deploy**. Tidak perlu mengubah pengaturan apa pun. Setelah selesai, website sudah tampil, tapi pendaftaran dan admin belum jalan karena database belum ada.
2. **Sambungkan database.** Di halaman proyek → tab **Storage** → **Create Database** → pilih **Neon** (Serverless Postgres) → region **Singapore** → buat dan sambungkan ke proyek ini. Vercel otomatis mengisi `DATABASE_URL`.
3. **Sambungkan penyimpanan foto.** Masih di **Storage** → **Create** → **Blob** → akses **Public** → sambungkan ke proyek. Vercel otomatis mengisi `BLOB_READ_WRITE_TOKEN`.
4. **Isi password admin.** Tab **Settings** → **Environment Variables** → tambahkan `ADMIN_PASSWORD` (password panjang) dan, bila mau, `ADMIN_USERNAME` (default `admin`).
5. **Redeploy.** Tab **Deployments** → titik tiga pada deployment teratas → **Redeploy**. Variabel baru hanya terbaca setelah redeploy.
6. **Coba.** Buka `https://nama-proyek.vercel.app/admin`, login, lalu ganti password di menu Akun. Scanner ada di `/scan`.

Tabel database dibuat otomatis saat pertama kali dibuka. Setiap `git push` ke `main` otomatis memperbarui website.

Catatan Vercel:
- Fungsi server diatur berjalan di Singapura (`vercel.json` → `regions`), jadi pilih Neon di Singapura juga supaya cepat.
- Ukuran unggahan dibatasi 4,5 MB per permintaan. Dashboard sudah mengecilkan foto otomatis sebelum diunggah.
- Paket gratis (Hobby) ditujukan untuk penggunaan non-komersial. Neon dan Blob gratis punya batas kuota; untuk satu acara dengan ratusan peserta biasanya cukup, cek pemakaian di tab Storage.

## Alternatif: pasang di VPS dengan satu perintah

Server Ubuntu baru, domain sudah diarahkan (A record) ke IP server. Jalankan:

```bash
curl -fsSL https://raw.githubusercontent.com/adMesakh/ppd-antiokhia/main/install.sh | sudo bash
```

Skrip memasang Docker, mengambil kode dari GitHub, menanyakan domain dan password admin, membuka port 80/443, menyalakan HTTPS otomatis, dan memasang cadangan database harian. Jalankan perintah yang sama lagi untuk memperbarui ke kode terbaru; data tidak hilang.

Di Oracle Cloud, buka juga port 80 dan 443 di **Security List** VCN (Networking → Virtual Cloud Networks → subnet → Security List → Add Ingress Rules, sumber `0.0.0.0/0`).

## Deploy ke VPS (Docker)

1. Arahkan domain (A record) ke IP VPS.
2. Salin `.env.example` menjadi `.env`, isi `DOMAIN` dan `ADMIN_PASSWORD`.
3. `docker compose up -d --build`
4. Buka `https://domainmu/admin`.

Caddy di `docker-compose.yml` mengurus sertifikat HTTPS otomatis. Data tersimpan di folder `./data` di VPS.

## Variabel lingkungan

| Nama | Default | Keterangan |
|---|---|---|
| `PORT` | `3000` | Port server |
| `DATABASE_URL` | kosong | Alamat PostgreSQL (Neon). Kosong = pakai PGlite di `DATA_DIR/pgdata` |
| `BLOB_READ_WRITE_TOKEN` | kosong | Diisi otomatis oleh Vercel Blob. Kosong = foto disimpan di `DATA_DIR/uploads` |
| `DATA_DIR` | `./data` | Lokasi database lokal, foto, dan cadangan |
| `ADMIN_USERNAME` | `admin` | Admin pertama (hanya saat database masih kosong) |
| `ADMIN_PASSWORD` | acak | Password admin pertama |
| `TRUST_PROXY` | kosong | Isi `1` bila di belakang reverse proxy (Caddy/Nginx) |

## Cadangan

```bash
npm run backup                          # database lokal → data/backup/*.json
DATABASE_URL=postgres://… npm run backup  # database Neon → data/backup/*.json
```

Foto galeri di Vercel tersimpan di Blob; di VPS simpan juga folder `data/uploads`.

## Pengujian

```bash
npm install
npm test
```

Uji ujung-ke-ujung dengan Chromium (pakai PGlite; set `DATABASE_URL` untuk menguji ke PostgreSQL sungguhan): admin mengisi data, pendaftaran publik, approval, scanner login, scan QR lewat kamera palsu, scan offline, deteksi WiFi berbayar, sinkron tanpa duplikat, nominasi, cetak ID card, dan pemeriksaan hak akses.

## Cara kerja sinkron scanner

1. Login (butuh internet) → HP mengunduh peserta lunas, gereja, sesi, dan kehadiran yang sudah ada.
2. Setiap scan disimpan di IndexedDB dengan id lokal unik, lalu dikirim saat ada koneksi (otomatis, Background Sync, atau tombol Sinkronkan).
3. Server menyimpan kehadiran dengan kunci unik (peserta, sesi). Kiriman ulang tidak menambah data.
4. Sebelum mengirim, aplikasi memanggil `/api/ping` dan memastikan jawabannya JSON dari server ini, sehingga WiFi berbayar yang belum login terdeteksi.
5. Sesi login scanner berlaku 45 hari supaya tidak kedaluwarsa saat offline.

## Struktur

```
index.js     titik masuk Vercel
vercel.json  region, redirect login admin, header keamanan & cache
server/      index.js (rute & API), start.js (laptop/VPS), db.js (skema Postgres), auth.js, stats.js (nominasi), storage.js (foto), backup.js
public/      index.html, status.html, assets/ (landing)
public/admin dashboard panitia + print.html (ID card A4)
public/scan  PWA scanner (app.js, store.js, sw.js)
tests/       e2e.js
```
