// Perhitungan nominasi gereja. Dipakai dashboard admin (live) dan landing page (setelah dipublikasikan).
const { db, getSettings } = require("./db");

function churchRankings() {
  const settings = getSettings();
  const minP = Math.max(1, Number(settings.min_participants_for_activity) || 1);
  const seminarCount = db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE kind = 'seminar'").get().n;

  const rows = db.prepare(`
    SELECT c.id, c.name, c.city,
      COUNT(DISTINCT p.id) AS confirmed,
      COUNT(DISTINCT a_any.participant_id) AS present,
      (SELECT COUNT(*) FROM attendance a
         JOIN participants p2 ON p2.id = a.participant_id
         JOIN registrations r2 ON r2.id = p2.registration_id AND r2.status = 'lunas'
         JOIN sessions s ON s.id = a.session_id AND s.kind = 'seminar'
       WHERE p2.church_id = c.id) AS seminar_scans
    FROM churches c
    LEFT JOIN registrations r ON r.church_id = c.id AND r.status = 'lunas'
    LEFT JOIN participants p ON p.registration_id = r.id
    LEFT JOIN attendance a_any ON a_any.participant_id = p.id
    GROUP BY c.id
  `).all();

  const list = rows.map((r) => {
    const eligible = r.confirmed >= minP;
    const perPerson = r.confirmed ? r.seminar_scans / r.confirmed : 0;
    return {
      church_id: r.id, church: r.name, city: r.city,
      confirmed: r.confirmed, present: r.present, seminar_scans: r.seminar_scans,
      seminar_per_person: Math.round(perPerson * 100) / 100,
      seminar_rate: seminarCount ? Math.round((perPerson / seminarCount) * 1000) / 10 : 0,
      eligible_activity: eligible,
    };
  });

  const mostParticipants = list.filter((r) => r.present > 0)
    .sort((a, b) => b.present - a.present || b.confirmed - a.confirmed || a.church.localeCompare(b.church, "id"));
  const mostActive = list.filter((r) => r.eligible_activity && r.seminar_scans > 0)
    .sort((a, b) => b.seminar_per_person - a.seminar_per_person || b.confirmed - a.confirmed || a.church.localeCompare(b.church, "id"));

  return { seminar_count: seminarCount, min_participants: minP, most_participants: mostParticipants, most_active: mostActive, all: list };
}

function contestResults() {
  return db.prepare(`
    SELECT cr.id, cr.contest, cr.rank, cr.winner, cr.church_id, c.name AS church
    FROM contest_results cr LEFT JOIN churches c ON c.id = cr.church_id
    ORDER BY cr.contest COLLATE NOCASE, cr.rank, cr.id`).all();
}

module.exports = { churchRankings, contestResults };
