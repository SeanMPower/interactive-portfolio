import { fetchScores, submitScore, cleanInitials, isRemote } from '../leaderboard/api.js';
import { fmtTime } from '../world/RingRun.js';

const INITIALS_KEY = 'ringrun-initials';
const TOP = 10;

/**
 * Leaderboard modal. Two modes:
 *   promptEntry(timeMs) → "Course complete" card with three initials boxes; Enter submits, Esc skips
 *   show()              → the top-10 table (opened from the link in the Ring Run HUD box)
 * Pauses the game while open (onOpen / onClose mirror the project Overlay).
 */
export class Leaderboard {
  constructor({ onOpen, onClose }) {
    this.el = document.getElementById('board');
    this.entryEl = document.getElementById('board-entry');
    this.listEl = document.getElementById('board-list');
    this.statusEl = document.getElementById('board-status');
    this.timeEl = document.getElementById('board-time');
    this.rankEl = document.getElementById('board-rank');
    this.boxes = [...document.querySelectorAll('#board-initials input')];
    this.submitBtn = document.getElementById('board-submit');
    this.skipBtn = document.getElementById('board-skip');
    this.onOpen = onOpen;
    this.onClose = onClose;
    this.pendingMs = null;   // time waiting to be submitted, or null in list mode
    this.highlight = null;   // date of the entry to highlight after a submit
    this.scores = null;      // last fetched top list (used to project a rank before submitting)
    this.open = false;

    document.getElementById('board-close').addEventListener('click', () => this.close());
    this.el.addEventListener('click', (e) => { if (e.target === this.el) this.close(); });
    this.skipBtn.addEventListener('click', () => this.close());
    this.submitBtn.addEventListener('click', () => this.submit());

    // Arcade-style initials: type to fill and advance, Backspace to go back, Enter to submit.
    this.boxes.forEach((box, i) => {
      box.addEventListener('input', () => {
        box.value = cleanInitials(box.value).slice(-1);
        if (box.value && i < this.boxes.length - 1) this.boxes[i + 1].focus();
        this.#syncSubmit();
      });
      box.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !box.value && i > 0) { this.boxes[i - 1].value = ''; this.boxes[i - 1].focus(); e.preventDefault(); }
        else if (e.key === 'ArrowLeft' && i > 0) this.boxes[i - 1].focus();
        else if (e.key === 'ArrowRight' && i < this.boxes.length - 1) this.boxes[i + 1].focus();
        else if (e.key === 'Enter') { e.preventDefault(); this.submit(); }
        e.stopPropagation(); // keep E/R/Space from reaching the flight controls
      });
      box.addEventListener('focus', () => box.select());
    });

    // Warm the cache so the "top-10 time?" projection is ready when a run finishes.
    this.#load(false).catch(() => {});
  }

  get isOpen() { return this.open; }
  get initials() { return cleanInitials(this.boxes.map((b) => b.value).join('')); }

  /** Open the list only. */
  show() {
    this.pendingMs = null;
    this.entryEl.classList.add('hidden');
    this.#open();
    this.#load(true);
  }

  /** Open in entry mode for a just-finished run. */
  promptEntry(timeMs) {
    this.pendingMs = Math.round(timeMs);
    this.timeEl.textContent = fmtTime(this.pendingMs / 1000);
    this.rankEl.textContent = this.#projectedRank();
    const saved = cleanInitials(localStorage.getItem(INITIALS_KEY) || '');
    this.boxes.forEach((b, i) => { b.value = saved[i] || ''; });
    this.entryEl.classList.remove('hidden');
    this.#syncSubmit();
    this.#open();
    this.#load(true);
    setTimeout(() => (this.boxes.find((b) => !b.value) || this.boxes[2]).focus(), 0);
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.pendingMs = null;
    this.el.classList.add('hidden');
    this.onClose?.();
  }

  async submit() {
    if (this.pendingMs == null || this.submitBtn.disabled) return;
    const initials = this.initials;
    if (!initials) { this.boxes[0].focus(); return; }
    this.submitBtn.disabled = true;
    this.submitBtn.textContent = 'Saving…';
    try {
      const { rank, entry, scores } = await submitScore(initials, this.pendingMs);
      localStorage.setItem(INITIALS_KEY, initials);
      this.pendingMs = null;
      this.highlight = entry.date;
      this.scores = scores;
      this.entryEl.classList.add('hidden');
      this.#render(scores, rank > scores.length ? `You placed #${rank}` : `You're #${rank} on the board`);
    } catch (err) {
      console.warn('[leaderboard]', err);
      this.submitBtn.disabled = false;
      this.submitBtn.textContent = 'Try again';
      this.statusEl.textContent = 'Couldn’t save your time — check your connection and try again.';
    }
  }

  #open() {
    if (this.open) return;
    this.open = true;
    this.statusEl.textContent = '';
    this.el.classList.remove('hidden');
    this.onOpen?.();
  }

  #syncSubmit() {
    this.submitBtn.disabled = !this.initials;
    this.submitBtn.textContent = 'Save time';
  }

  #projectedRank() {
    const s = this.scores;
    if (!s) return '';
    const place = s.findIndex((e) => this.pendingMs < e.timeMs);
    if (place === -1) return s.length < 10 ? `That's #${s.length + 1} on the board` : 'Not a top-10 time — it still counts';
    return place === 0 ? 'New course record!' : `That's #${place + 1} on the board`;
  }

  async #load(render) {
    if (render && !this.scores) this.#render([], 'Loading…');
    try {
      this.scores = await fetchScores();
      if (render) this.#render(this.scores);
    } catch (err) {
      console.warn('[leaderboard]', err);
      if (render) this.#render(this.scores || [], 'Couldn’t reach the leaderboard.');
    }
  }

  #render(scores, status = '') {
    this.statusEl.textContent = status;
    const thisYear = new Date().getFullYear();
    const rows = [];
    for (let i = 0; i < TOP; i++) {
      const e = scores[i];
      if (!e) { rows.push(`<li class="board-row empty"><span class="rank">${i + 1}</span><span class="who">Not yet recorded</span><span class="time">—</span><span class="when"></span></li>`); continue; }
      const me = e.date === this.highlight ? ' me' : '';
      const d = new Date(e.date);
      const when = isNaN(d) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === thisYear ? undefined : 'numeric' });
      rows.push(`<li class="board-row${me}"><span class="rank">${i + 1}</span><span class="who">${esc(e.initials)}</span><span class="time">${fmtTime(e.timeMs / 1000)}</span><span class="when">${when}</span></li>`);
    }
    this.listEl.innerHTML = `<ol>${rows.join('')}</ol>${isRemote ? '' : '<div class="board-note">Local only — set VITE_LEADERBOARD_URL to share times.</div>'}`;
  }
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
