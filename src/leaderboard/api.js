/**
 * Leaderboard client (Ring Run, Balloon Burst — any `course`).
 *
 * Talks to the Lambda Function URL in VITE_LEADERBOARD_URL (see infra/leaderboard.yml).
 * When the variable is unset (local dev without a backend) it falls back to a localStorage
 * board with the same shape, so the UI works everywhere.
 *
 * Score shape: { initials: 'ABC', timeMs: 83400, date: ISO string }
 */
const URL = (import.meta.env.VITE_LEADERBOARD_URL || '').trim();
const TOP = 10;
const LS_KEY = (course) => `${course}-board`;

export const isRemote = URL.length > 0;

export async function fetchScores(course = 'ringrun') {
  if (!isRemote) return localTop(course);
  const r = await fetch(`${URL}?course=${encodeURIComponent(course)}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`leaderboard GET ${r.status}`);
  return (await r.json()).scores;
}

/** @returns {Promise<{ rank: number, entry: object, scores: object[] }>} */
export async function submitScore(initials, timeMs, course = 'ringrun') {
  initials = cleanInitials(initials);
  timeMs = Math.round(timeMs);
  if (!initials) throw new Error('initials required');
  if (!isRemote) return localSubmit(initials, timeMs, course);
  const r = await fetch(URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ initials, timeMs, course }),
  });
  if (!r.ok) throw new Error(`leaderboard POST ${r.status}`);
  return r.json();
}

export const cleanInitials = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);

// ---------------------------------------------------------------- localStorage fallback
function localAll(course) {
  try { return JSON.parse(localStorage.getItem(LS_KEY(course)) || '[]'); } catch { return []; }
}
function localTop(course) { return localAll(course).sort((a, b) => a.timeMs - b.timeMs).slice(0, TOP); }
function localSubmit(initials, timeMs, course) {
  const entry = { initials, timeMs, date: new Date().toISOString() };
  const all = [...localAll(course), entry].sort((a, b) => a.timeMs - b.timeMs);
  localStorage.setItem(LS_KEY(course), JSON.stringify(all));
  return { rank: all.indexOf(entry) + 1, entry, scores: all.slice(0, TOP) };
}
