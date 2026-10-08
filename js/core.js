// Shared plumbing: Supabase client, server clock, live sync, small helpers.
/* global supabase */

const cfg = window.JEDIS_CONFIG || {};
export const CONFIG = cfg;
export const configured = Boolean(cfg.supabaseUrl && cfg.supabaseKey && !/YOUR-/.test(cfg.supabaseUrl + cfg.supabaseKey));

export const sb = configured
  ? supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
  : null;

// ---------- Errors ----------
const MESSAGES = {
  BAD_PASSWORD: 'Wrong password.',
  ADMIN_PASSWORD_NOT_SET: 'No admin password yet. Run ja_set_admin_password in Supabase (see DEPLOY.md).',
  NAME_TAKEN: 'That name is already in use on another phone. If it’s you, ask the host to free it.',
  DEVICE_ALREADY_JOINED: 'This phone already joined under another name.',
  JOINING_CLOSED: 'Joining is closed. Ask the host to open it.',
  UNKNOWN_NAME: 'That name isn’t on the list.',
  NOT_JOINED: 'This phone isn’t joined any more. Pick your name again.',
  AWARD_NOT_OPEN: 'That award isn’t open.',
  VOTING_PAUSED: 'Voting is paused.',
  VOTING_CLOSED: 'Voting has closed.',
  TIME_UP: 'Time’s up.',
  NOT_ELIGIBLE: 'That person can’t win this award.',
  ALREADY_VOTED: 'You’ve already voted, so your name stays locked to this phone. Ask the host to free it.',
  FINISH_CURRENT_AWARD: 'Finish the current award first (reveal its winner).',
  AWARD_ALREADY_USED: 'That award has already been run. Reset it on the Results tab to run it again.',
  NO_ONE_ELIGIBLE: 'Nobody is eligible for this award (everyone on its list has already won).',
  NOT_LIVE: 'Voting isn’t running.',
  NOT_PAUSED: 'Voting isn’t paused.',
  NOT_CLOSED: 'Close voting first.',
  NOTHING_TO_RESTART: 'Nothing to restart.',
  AWARD_LOCKED: 'This award has already run, so it can’t be edited.',
  TITLE_REQUIRED: 'Give the award a title.',
  TITLE_TOO_LONG: 'Title is too long (80 characters max).',
  DESCRIPTION_TOO_LONG: 'Description is too long (160 characters max).',
  TIME_MUST_BE_10_TO_90: 'Time must be between 10 and 90 seconds.',
  SHORTLIST_EMPTY: 'Pick at least one person for the shortlist.',
  REORDER_MISMATCH: 'The list changed while you were dragging. Try again.',
  TYPE_RESET_TO_CONFIRM: 'Type RESET to confirm.',
  NAME_EXISTS: 'Someone with that name is already on the list.',
  BAD_NAME: 'Enter a name (60 characters max).',
  HAS_WON_AN_AWARD: 'This person has won an award. Reset that award first.',
  ALREADY_HAS_WINNER: 'This award already has a winner.',
  ALREADY_WON: 'That person has already won an award.',
  NOT_REVEALED: 'Reveal the award first.',
  NETWORK: 'No connection. Retrying…',
};
export class ApiError extends Error {
  constructor(code) { super(MESSAGES[code] || code); this.code = code; }
}
export const friendly = (e) => (e && (e.code ? (MESSAGES[e.code] || e.message) : e.message)) || 'Something went wrong.';

// ---------- RPC with retries on network trouble ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function rpc(fn, args = {}, { retries = 3 } = {}) {
  if (!sb) throw new ApiError('NOT_CONFIGURED');
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const sentAt = Date.now();
    let res;
    try { res = await sb.rpc(fn, args); } catch (e) { res = { error: { message: String(e), code: '' }, status: 0 }; }
    const { data, error, status } = res;
    if (!error) {
      if (data && typeof data === 'object' && 'server_now' in data) noteServerTime(data.server_now, sentAt, Date.now());
      return data;
    }
    // Errors raised by our functions come back as HTTP 400, code P0001, with a short message.
    const transient = !status || status >= 500 || status === 429 || status === 408 || /fetch|network|timeout/i.test(error.message || '');
    if (!transient) {
      throw new ApiError(error.code === 'P0001' ? error.message : (error.message || error.code));
    }
    lastErr = new ApiError('NETWORK');
    if (attempt < retries) await sleep(400 * 2 ** attempt + Math.random() * 300);
  }
  throw lastErr;
}

// ---------- Server clock (so every phone hits 0:00 together) ----------
let offset = 0;
const samples = [];
export function noteServerTime(serverNow, sentAt, recvAt) {
  if (!serverNow) return;
  const rtt = recvAt - sentAt;
  samples.push({ rtt, off: serverNow + rtt / 2 - recvAt, at: recvAt });
  while (samples.length > 12) samples.shift();
  const best = samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
  offset = best.off;
}
export const serverNow = () => Date.now() + offset;

// Milliseconds left on the current award's clock.
export function msLeft(state) {
  if (!state) return 0;
  if (state.phase === 'paused') return Math.max(0, state.remaining_ms || 0);
  if (state.phase === 'live' && state.ends_at) return Math.max(0, state.ends_at - serverNow());
  return 0;
}
export const fmtClock = (ms) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// ---------- Live sync: realtime push when available, polling always as a safety net ----------
export function startSync(fetchState, onState, { fast = 2500, idle = 6000, rtFast = 6000, rtIdle = 20000, onStatus, onError } = {}) {
  let realtime = false, timer = null, inflight = null, again = false, last = null, stopped = false;

  const isBusy = () => last && ['live', 'paused', 'closed', 'top3'].includes(last.phase);
  function schedule() {
    clearTimeout(timer);
    if (stopped) return;
    const ms = realtime ? (isBusy() ? rtFast : rtIdle) : (isBusy() ? fast : idle);
    timer = setTimeout(refresh, ms);
  }
  async function refresh() {
    if (inflight) { again = true; return inflight; }
    inflight = (async () => {
      try {
        const s = await fetchState();
        last = s;
        onState(s);
      } catch (e) {
        onError && onError(e);
      } finally {
        inflight = null;
        if (again) { again = false; refresh(); } else schedule();
      }
    })();
    return inflight;
  }

  if (sb) {
    sb.channel('ja-event')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ja_event' }, (payload) => {
        const v = payload && payload.new && payload.new.version;
        if (!last || v == null || Number(v) !== Number(last.version)) {
          setTimeout(refresh, Math.random() * 250);   // spread 70 phones over a quarter second
        }
      })
      .subscribe((status) => {
        realtime = status === 'SUBSCRIBED';
        onStatus && onStatus(realtime ? 'live' : 'polling');
        schedule();
      });
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  window.addEventListener('online', refresh);
  window.addEventListener('focus', refresh);
  refresh();
  return { refresh, get state() { return last; }, stop() { stopped = true; clearTimeout(timer); } };
}

// ---------- Tiny DOM helpers ----------
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export const initials = (name) => {
  const p = String(name || '').trim().split(/\s+/);
  return ((p[0] || '')[0] || '').concat(p.length > 1 ? p[p.length - 1][0] : '').toUpperCase();
};
export const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';
export const joinNames = (arr) => {
  const a = (arr || []).filter(Boolean);
  if (a.length <= 1) return a.join('');
  return a.slice(0, -1).join(', ') + ' & ' + a[a.length - 1];
};

let toastTimer;
export function toast(msg, ms = 3200) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

// Storage that never throws (private mode, blocked storage…).
export const store = {
  get(k, fallback = null) { try { const v = localStorage.getItem(k); return v === null ? fallback : v; } catch { return memory[k] ?? fallback; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { memory[k] = v; } },
  del(k) { try { localStorage.removeItem(k); } catch { delete memory[k]; } },
};
const memory = {};

export const ICONS = {
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5l12 7-12 7z"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  restart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4v4.5h4.5"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  screen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  grip: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
  sound: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5L6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
  mute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5L6 9H3v6h3l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>',
  full: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
};

export function ringSvg(size, stroke) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return {
    html: `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <circle class="track" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}"/>
      <circle class="prog" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="0"/>
    </svg>`,
    circumference: c,
  };
}
export function setRing(el, fraction, circumference) {
  const prog = el.querySelector('.prog');
  if (prog) prog.setAttribute('stroke-dashoffset', (circumference * (1 - Math.max(0, Math.min(1, fraction)))).toFixed(1));
}

export function setupNotice() {
  return `<div class="notice"><b>Setup needed.</b> Paste your Supabase URL and key into <code>js/config.js</code>. The steps are in DEPLOY.md.</div>`;
}
