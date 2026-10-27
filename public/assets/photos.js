// Foto latar dari Unsplash (lisensi Unsplash: bebas dipakai, kredit tidak wajib; daftar fotografer ada di bawah dan di komentar index.html).
// Hanya foto gratis, bukan Unsplash+. Bila foto gagal dimuat (misalnya tanpa internet), ilustrasi panggung tetap tampil di belakangnya.
// Untuk mengganti foto: ambil ID dari alamat gambar images.unsplash.com/photo-<ID>.
(function () {
  const P = {
    stageLights: { id: "1470229722913-7c0e2dbbafd3", by: "Yvette de Wit", page: "https://unsplash.com/photos/NYrVisodQ2M" },
    handsUp: { id: "1477281765962-ef34e8bb0967", by: "Edwin Andrade", page: "https://unsplash.com/photos/4V1dC_eoCwg" },
    handsSilhouette: { id: "1508829040592-72f179f8a73f", by: "Matt Botsford", page: "https://unsplash.com/photos/bBNabN9R_ac" },
    handsFocus: { id: "1438232992991-995b7058bbb3", by: "John Price", page: "https://unsplash.com/photos/RAZQiZOX3mU" },
    bandStage: { id: "1565035010268-a3816f98589a", by: "Tijs van Leur", page: "https://unsplash.com/photos/So6YckShOVA" },
    crowdWatch: { id: "1522158637959-30385a09e0da", by: "Rachel Coyne", page: "https://unsplash.com/photos/U7HLzMO4SIY" },
    crowdHands: { id: "1692271931628-adc2b16670dd", by: "Roberto Rendon", page: "https://unsplash.com/photos/-Ma-aFuivjs" },
    audience: { id: "1470229538611-16ba8c7ffbd7", by: "Yvette de Wit", page: "https://unsplash.com/photos/8XLapfNMW04" },
    nightCrowd: { id: "1583795484071-3c453e3a7c71", by: "Spencer Davis", page: "https://unsplash.com/photos/naFHFLV5cqU" },
    frontStage: { id: "1622598453695-4fbaf151aadc", by: "Terren Hurst", page: "https://unsplash.com/photos/KU66acygwIY" },
    grayCrowd: { id: "1573152958734-1922c188fba3", by: "Nathan Fertig", page: "https://unsplash.com/photos/IW5Bm4rB9OA" },
  };
  const url = (p, w) => `https://images.unsplash.com/photo-${p.id}?auto=format&fit=crop&w=${w}&q=70`;
  window.RPKPhotos = {
    all: P,
    P,
    hero: [P.handsSilhouette, P.stageLights, P.handsUp],
    sessions: [P.crowdHands, P.bandStage, P.audience, P.nightCrowd, P.frontStage, P.handsFocus, P.crowdWatch],
    lineup: [P.grayCrowd, P.frontStage, P.stageLights],
    url,
    // <img> yang menutupi ilustrasi; dihapus sendiri bila gagal dimuat
    img(p, w, cls) { return `<img class="${cls || "photo"}" src="${url(p, w)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">`; },
  };
})();
