// Perhitungan nominasi gereja. Dipakai dashboard admin (live) dan landing page (setelah dipublikasikan).
const { many, one, getSettings } = require("./db");

async function churchRankings() {
  const settings = await getSettings();
  const minP = Math.max(1, Number(settings.min_participants_for_activity) || 1);
  const seminarCount = (await one("SELECT COUNT(*)::int AS n FROM sessions WHERE kind = 'seminar'")).n;

  const rows = await many(`
    WITH paid AS (
      SELECT p.id, p.church_id FROM participants p JOIN registrations r ON r.id = p.registration_id AND r.status = 'lunas'
    )
    SELECT c.id, c.name, c.city,
      (SELECT COUNT(*)::int FROM paid WHERE paid.church_id = c.id) AS confirmed,
      (SELECT COUNT(DISTINCT a.participant_id)::int FROM attendance a JOIN paid ON paid.id = a.participant_id WHERE paid.church_id = c.id) AS present,
      (SELECT COUNT(*)::int FROM attendance a JOIN paid ON paid.id = a.participant_id JOIN sessions s ON s.id = a.session_id AND s.kind = 'seminar'
         WHERE paid.church_id = c.id) AS seminar_scans
    FROM churches c`);

  const list = rows.map((r) => {
    const perPerson = r.confirmed ? r.seminar_scans / r.confirmed : 0;
    return {
      church_id: r.id, church: r.name, city: r.city,
      confirmed: r.confirmed, present: r.present, seminar_scans: r.seminar_scans,
      seminar_per_person: Math.round(perPerson * 100) / 100,
      seminar_rate: seminarCount ? Math.round((perPerson / seminarCount) * 1000) / 10 : 0,
      eligible_activity: r.confirmed >= minP,
    };
  });

  const byName = (a, b) => a.church.localeCompare(b.church, "id");
  const mostParticipants = list.filter((r) => r.present > 0).sort((a, b) => b.present - a.present || b.confirmed - a.confirmed || byName(a, b));
  const mostActive = list.filter((r) => r.eligible_activity && r.seminar_scans > 0).sort((a, b) => b.seminar_per_person - a.seminar_per_person || b.confirmed - a.confirmed || byName(a, b));

  return { seminar_count: seminarCount, min_participants: minP, most_participants: mostParticipants, most_active: mostActive, all: list };
}

function contestResults() {
  return many(`
    SELECT cr.id, cr.contest, cr.rank, cr.winner, cr.church_id, c.name AS church
    FROM contest_results cr LEFT JOIN churches c ON c.id = cr.church_id
    ORDER BY lower(cr.contest), cr.rank, cr.id`);
}

module.exports = { churchRankings, contestResults };
