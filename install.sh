#!/usr/bin/env bash
# Pasang website PPD Antiokhia di VPS Ubuntu (Oracle Cloud, Biznet Gio, dll).
# Jalankan di server sebagai root:
#   curl -fsSL https://raw.githubusercontent.com/adMesakh/ppd-antiokhia/main/install.sh | sudo bash
# Menjalankan ulang skrip ini = memperbarui ke kode terbaru dari GitHub (data tidak hilang).
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/adMesakh/ppd-antiokhia.git}"
DIR="${DIR:-/opt/ppd-antiokhia}"

say() { printf "\n\033[1;33m==> %s\033[0m\n" "$*"; }
[ "$(id -u)" -eq 0 ] || { echo "Jalankan dengan sudo."; exit 1; }

say "Memasang git dan Docker"
apt-get update -y >/dev/null
apt-get install -y git curl ca-certificates >/dev/null
if ! command -v docker >/dev/null; then curl -fsSL https://get.docker.com | sh; fi

say "Mengambil kode dari GitHub"
if [ -d "$DIR/.git" ]; then git -C "$DIR" pull --ff-only; else git clone "$REPO_URL" "$DIR"; fi
cd "$DIR"

if [ ! -f .env ]; then
  say "Pengaturan pertama"
  read -rp "Domain website (contoh: ppdantiokhia.my.id): " DOMAIN </dev/tty
  read -rsp "Password admin pertama (min. 8 karakter): " PASS </dev/tty; echo
  printf "DOMAIN=%s\nADMIN_USERNAME=admin\nADMIN_PASSWORD=%s\n" "$DOMAIN" "$PASS" > .env
  chmod 600 .env
fi
DOMAIN="$(grep '^DOMAIN=' .env | cut -d= -f2)"

say "Membuka port 80 dan 443"
if command -v ufw >/dev/null && ufw status | grep -q active; then ufw allow 80,443/tcp; fi
# Image Ubuntu di Oracle Cloud memblokir port lewat iptables bawaan
if command -v iptables >/dev/null && iptables -L INPUT -n | grep -q "REJECT"; then
  for p in 80 443; do iptables -C INPUT -p tcp --dport $p -j ACCEPT 2>/dev/null || iptables -I INPUT 6 -p tcp --dport $p -j ACCEPT; done
  command -v netfilter-persistent >/dev/null && netfilter-persistent save || true
fi

say "Membangun dan menjalankan aplikasi (beberapa menit pada pemasangan pertama)"
mkdir -p data
docker compose up -d --build

say "Memasang cadangan database harian (02.00)"
cat > /etc/cron.d/ppd-antiokhia-backup <<CRON
0 2 * * * root cd $DIR && docker compose exec -T app node server/backup.js >> /var/log/ppd-backup.log 2>&1 && find $DIR/data/backup -name '*.json' -mtime +14 -delete
CRON

say "Selesai"
echo "Website : https://$DOMAIN"
echo "Panitia : https://$DOMAIN/admin  (username: admin)"
echo "Scanner : https://$DOMAIN/scan"
echo "Catatan : sertifikat HTTPS dibuat otomatis begitu domain sudah mengarah ke IP server ini."
