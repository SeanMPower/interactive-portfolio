/**
 * Ring Run leaderboard client.
 *
 * Talks to the Lambda Function URL in VITE_LEADERBOARD_URL (see infra/leaderboard.yml).
 * When the variable is unset (local dev without a backend) it falls back to a localStorage
 * board with the same shape, so the UI works everywhere.
 *
 * Score shape: { initials: 'ABC', timeMs: 83400, date: ISO string }
 */
const URL = (import.meta.env.VITE_LEADERBOARD_URL || '').trim();
const TOP = 10;
const LS_KEY = 'ringrun-board';

export const isRemote = URL.length > 0;

export async function fetchScores() {
  if (!isRemote) return localTop();
  const r = await fetch(URL, { cache: 'no-store' });
  if (!r.ok) throw new Error(`leaderboard GET ${r.status}`);
  return (await r.json()).scores;
}

/** @returns {Promise<{ rank: number, entry: object, scores: object[] }>} */
export async function submitScore(initials, timeMs) {
  initials = cleanInitials(initials);
  timeMs = Math.round(timeMs);
  if (!initials) throw new Error('initials required');
  if (!isRemote) return localSubmit(initials, timeMs);
  const r = await fetch(URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ initials, timeMs }),
  });
  if (!r.ok) throw new Error(`leaderboard POST ${r.status}`);
  return r.json();
}

export const cleanInitials = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);

// ---------------------------------------------------------------- localStorage fallback
function localAll() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; }
}
function localTop() { return localAll().sort((a, b) => a.timeMs - b.timeMs).slice(0, TOP); }
function localSubmit(initials, timeMs) {
  const entry = { initials, timeMs, date: new Date().toISOString() };
  const all = [...localAll(), entry].sort((a, b) => a.timeMs - b.timeMs);
  localStorage.setItem(LS_KEY, JSON.stringify(all));
  return { rank: all.indexOf(entry) + 1, entry, scores: all.slice(0, TOP) };
}
