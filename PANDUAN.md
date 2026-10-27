# Panduan panitia

Aplikasinya sudah jadi dan sudah diuji. Yang tersisa adalah hal-hal yang butuh akun, uang, perangkat, atau keputusan panitia. Urutannya dari yang paling awal.

## A. Yang harus kamu lakukan sendiri (sekali)

1. **Sewa server dan domain.** Cukup VPS kecil (1 vCPU, 1 GB RAM) dengan Ubuntu, plus satu domain. Pilih penyedia dengan pusat data di Indonesia supaya cepat dari Kalbar.
2. **Aktifkan HTTPS.** Wajib. Tanpa HTTPS, kamera HP dan mode offline scanner tidak akan jalan. Cara termudah: pakai `docker-compose.yml` yang sudah disediakan (Caddy mengurus sertifikat otomatis).
3. **Deploy.** Ikuti bagian "Deploy ke VPS" di README.md. Isi `ADMIN_PASSWORD` di `.env` dengan password panjang.
4. **Login ke `/admin`, lalu ganti password** di menu Akun & scanner.
5. **Atur cadangan otomatis.** Jadwalkan `npm run backup` (atau salin folder `data/`) tiap malam ke tempat lain, misalnya Google Drive.

## B. Isi konten (bisa dikerjakan panitia lain)

Semua dari `/admin`:

1. **Gereja** → tempel daftar 40+ gereja sekaligus (format `Nama, Kota` per baris, bisa disalin dari Excel).
2. **Konten website** → tanggal & jam mulai/selesai (WIB), lokasi, biaya per peserta, kontak panitia, catatan pembayaran, lineup pembicara dan bintang tamu.
3. **Jadwal sesi** → minimal satu sesi *Check-in* (registrasi ulang) dan semua sesi *Seminar*. Hanya sesi Seminar yang dihitung untuk nominasi "gereja paling aktif".
4. **Hasil & lomba** → atur batas minimal peserta agar gereja ikut nominasi paling aktif (default 5).
5. Buka pendaftaran (saklar "Pendaftaran dibuka" di Konten website) lalu bagikan alamat website ke grup koordinator gereja.

## C. Selama masa pendaftaran

- Setiap uang tunai diterima: **Pendaftaran → Tandai lunas**. QR peserta langsung terbit dan koordinator bisa melihatnya di tautan status.
- Gereja yang mendaftar lewat telepon: **+ Pendaftaran oleh admin** (bisa langsung lunas).
- Data peserta salah: buka Detail pendaftaran → Ubah.

## D. Persiapan perangkat (H-7 sampai H-1)

1. **Cetak ID card**: Peserta & QR → Cetak ID card. Kertas A4 tebal (art carton 210–260 gsm), printer warna, skala 100%. Potong mengikuti garis, laminating bila sempat, pasang lanyard. Pita emas = Gembala sidang, merah = Peserta.
2. **Buat akun scanner**, satu per petugas: Akun & scanner → Akun baru. Catat password-nya.
3. **Siapkan HP Android petugas**:
   - Update Google Chrome ke versi terbaru.
   - Buka `https://domainmu/scan`, login, tunggu data terunduh.
   - Menu Chrome (⋮) → **Tambahkan ke layar utama / Instal aplikasi**.
   - Izinkan kamera saat diminta.
   - Pengaturan HP → Baterai → matikan optimasi baterai untuk Chrome.
   - **Uji mode pesawat**: nyalakan mode pesawat, buka aplikasi dari layar utama, scan satu ID card. Matikan mode pesawat, tekan Sinkronkan.
4. **H-1 (masih di kota)**: semua petugas buka aplikasi dan tekan **Unduh ulang data** supaya peserta yang baru lunas ikut masuk.
5. Siapkan power bank untuk setiap HP scanner.

## E. Di lokasi (tanpa sinyal)

- Petugas pilih sesi, lalu scan. Hijau = tercatat, kuning = sudah tercatat sebelumnya, merah = QR tidak dikenal.
- ID card rusak atau tertinggal: pakai tab **Cari nama** atau **Ketik kode** (kode tercetak di bawah QR).
- Peserta yang lunas setelah data diunduh akan muncul merah. Catat namanya di kertas, lalu masukkan lewat admin → Kehadiran → Catat manual saat ada koneksi.
- **Sekali sehari**, bawa HP ke spot WiFi berbayar: login WiFi dulu lewat browser, lalu buka aplikasi dan tekan **Sinkronkan**. Bila muncul "WiFi perlu login", berarti voucher WiFi belum aktif.
- Jangan tekan Keluar di HP yang masih punya scan belum terkirim.

## F. Setelah acara

1. Pastikan semua HP menunjukkan **0 scan belum terkirim**.
2. Admin → Hasil & lomba: cek nominasi, isi pemenang lomba, lalu nyalakan **Tampilkan hasil**.
3. Unggah foto dokumentasi di Galeri foto.
4. Unduh CSV peserta dan kehadiran untuk arsip.
5. Data peserta (banyak di bawah umur): tentukan kapan data dihapus, misalnya 3 bulan setelah acara, dan nonaktifkan akun scanner.

## G. Keputusan panitia yang masih terbuka

- **Musik NDC.** Website memakai pad worship buatan sendiri yang bebas hak cipta. Untuk memakai rekaman NDC, minta izin dulu ke pihak NDC, lalu isi alamat file MP3-nya di Konten website → File musik latar.
- **Biaya per peserta** dan **tanggal pasti** (saat ini memakai contoh 6–9 Juli 2027).
- **Siapa yang memegang akun admin.** Sarannya dua orang saja: ketua panitia dan bendahara.
