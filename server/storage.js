// Penyimpanan foto galeri.
// - Di Vercel: Vercel Blob (store harus dibuat dengan akses Public).
// - Di laptop/VPS: folder DATA_DIR/uploads, dilayani di /uploads/...
const path = require("path");
const fs = require("fs");
const { DATA_DIR } = require("./db");

// Token Blob; bisa berawalan bila "Custom Prefix" diisi saat menyambungkan (misalnya FOTO_READ_WRITE_TOKEN)
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || process.env[Object.keys(process.env).sort().find((k) => /_READ_WRITE_TOKEN$/.test(k) && process.env[k])] || undefined;
const USE_BLOB = !!(BLOB_TOKEN || process.env.BLOB_STORE_ID);
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

async function savePhoto(buf, filename, contentType) {
  if (USE_BLOB) {
    const { put } = require("@vercel/blob");
    const blob = await put(`galeri/${filename}`, buf, { access: "public", contentType, addRandomSuffix: false, token: BLOB_TOKEN });
    return blob.url;
  }
  if (process.env.VERCEL) throw Object.assign(new Error("Penyimpanan foto belum disambungkan. Buat Blob store (Public) dari tab Storage di Vercel."), { status: 400 });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), buf);
  return `/uploads/${filename}`;
}

async function removePhoto(photo) {
  if (/^https?:\/\//.test(photo.url)) {
    if (USE_BLOB) { const { del } = require("@vercel/blob"); await del(photo.url, { token: BLOB_TOKEN }); }
    return;
  }
  fs.rmSync(path.join(UPLOAD_DIR, path.basename(photo.filename)), { force: true });
}

module.exports = { USE_BLOB, UPLOAD_DIR, savePhoto, removePhoto };
