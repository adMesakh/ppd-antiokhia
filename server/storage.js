// Penyimpanan file unggahan (foto galeri, foto pembicara, lagu latar).
// - Di Vercel: Vercel Blob (store harus dibuat dengan akses Public).
// - Di laptop: folder DATA_DIR/uploads, dilayani di /uploads/...
const path = require("path");
const fs = require("fs");
const { DATA_DIR } = require("./db");

// Token Blob; bisa berawalan bila "Custom Prefix" diisi saat menyambungkan (misalnya FOTO_READ_WRITE_TOKEN).
// Tanpa token, Blob memakai login otomatis Vercel (OIDC) lewat BLOB_STORE_ID.
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || process.env[Object.keys(process.env).sort().find((k) => /_READ_WRITE_TOKEN$/.test(k) && process.env[k])] || undefined;
const USE_BLOB = !!(BLOB_TOKEN || process.env.BLOB_STORE_ID);
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

// folder: "galeri" | "lineup" | "musik"
async function saveFile(buf, folder, filename, contentType) {
  if (USE_BLOB) {
    const { put } = require("@vercel/blob");
    const blob = await put(`${folder}/${filename}`, buf, { access: "public", contentType, addRandomSuffix: false, token: BLOB_TOKEN });
    return blob.url;
  }
  if (process.env.VERCEL && !process.env.TEST_LOCAL_UPLOADS) throw Object.assign(new Error("Penyimpanan file belum disambungkan. Buat Blob store (Public) dari tab Storage di Vercel."), { status: 400 });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), buf);
  return `/uploads/${filename}`;
}

// Hapus file berdasarkan alamatnya. Alamat dari luar (bukan unggahan aplikasi ini) dibiarkan.
async function removeFile(url) {
  if (!url) return;
  if (/^https?:\/\//.test(url)) {
    if (USE_BLOB && /\.blob\.vercel-storage\.com\//.test(url)) {
      const { del } = require("@vercel/blob");
      try { await del(url, { token: BLOB_TOKEN }); } catch (e) { console.error("[storage] gagal menghapus", url, e.message); }
    }
    return;
  }
  if (url.startsWith("/uploads/")) fs.rmSync(path.join(UPLOAD_DIR, path.basename(url)), { force: true });
}

const savePhoto = (buf, filename, contentType) => saveFile(buf, "galeri", filename, contentType);
const removePhoto = (photo) => removeFile(photo.url || `/uploads/${photo.filename}`);

module.exports = { USE_BLOB, UPLOAD_DIR, saveFile, removeFile, savePhoto, removePhoto };
