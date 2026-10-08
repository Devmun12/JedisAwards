// Phone app: join → wait → vote → reveal.
import {
  configured, rpc, startSync, msLeft, fmtClock, friendly, esc, initials, firstName, joinNames,
  store, toast, ICONS, ringSvg, setRing, setupNotice, $,
} from './core.js';
import { confetti } from './fx.js';

const app = $('#app');

// One random token per phone. It is how the server knows this phone holds a name.
function newToken() {
  const a = new Uint8Array(24);
  (window.crypto || window.msCrypto).getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}
let token = store.get('ja.token');
if (!token) { token = newToken(); store.set('ja.token', token); }

let S = null;                       // latest server state
let mounted = '';                   // key of the view on screen
const names = new Map();            // id → name, remembered after voting closes
const local = {
  awardId: null, pick: null, sent: null, sending: false, queued: null, error: null,
  editing: false, q: '',
};
const join = { people: null, q: '', sel: null, open: false, active: 0, busy: false, err: '' };
let celebrated = '';

if (!configured) {
  app.innerHTML = `<div class="pad" style="padding-top:40px">${setupNotice()}</div>`;
} else {
  const sync = startSync(() => rpc('ja_get_state', { p_token: token }), (s) => { S = s; render(); },
    { onError: () => { if (!S) app.innerHTML = loadingError(); } });
  window.__sync = sync;
  setInterval(tick, 200);
}

function loadingError() {
  return `<div class="center"><img class="hero-logo" src="assets/logo-256.png" alt=""><p class="lede">Can’t reach the voting server. Check your connection; this page retries by itself.</p></div>`;
}

// ---------------------------------------------------------------- routing
function viewFor(s) {
  if (!s.me) return 'join';
  const p = s.phase;
  if (p === 'live' || p === 'paused') {
    if (p === 'live' && msLeft(s) <= 0) return 'closed';
    return 'vote';
  }
  if (p === 'closed') return 'closed';
  if (p === 'top3') return 'top3';
  if (p === 'winner') {
    const won = (s.result?.winners || []).some((w) => w.id === s.me.id);
    return won ? 'won' : 'winner';
  }
  if (p === 'wall') return 'wall';
  return 'lobby';
}

function render() {
  if (!S) return;
  for (const n of S.nominees || []) names.set(n.id, n.name);
  if (S.award && S.award.id !== local.awardId) {
    Object.assign(local, { awardId: S.award.id, pick: S.my_vote || null, sent: S.my_vote || null, error: null, editing: false, q: '', queued: null });
  }
  if (!local.sending && !local.queued && S.my_vote !== undefined && (S.phase === 'live' || S.phase === 'paused')) {
    // keep in step with the server (e.g. after a reload)
    if (S.my_vote && local.pick !== S.my_vote && local.sent === local.pick) { local.pick = S.my_vote; local.sent = S.my_vote; }
  }
  const v = viewFor(S);
  const key = `${v}:${S.award?.id || ''}:${S.phase}`;
  document.body.classList.toggle('won', v === 'won');
  document.body.classList.toggle('red-stage', v === 'winner');
  if (key !== mounted) {
    mounted = key;
    app.innerHTML = VIEWS[v].mount();
    VIEWS[v].bind && VIEWS[v].bind();
  }
  VIEWS[v].update && VIEWS[v].update();
}

function tick() {
  if (!S) return;
  if (S.phase === 'live' && viewFor(S) !== mounted.split(':')[0]) render();   // timer ran out
  const v = mounted.split(':')[0];
  if (v === 'vote') updateTimer();
}

// ---------------------------------------------------------------- shared bits
const topBar = () => `
  <header class="top">
    <div class="brand"><img src="assets/logo-256.png" alt=""><b>Jedis Awards</b></div>
    ${S.me ? `<span class="me-chip" title="${esc(S.me.name)}">${esc(S.me.name)}</span>` : ''}
  </header>`;
const awardTag = () => S.award ? `Award ${S.award.number} of ${S.award_total}` : '';

// ---------------------------------------------------------------- views
const VIEWS = {};

VIEWS.join = {
  mount() {
    return `
      <div class="pad" style="padding-top:36px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:14px">
        <img class="hero-logo" src="assets/logo-256.png" alt="Jedis logo">
        <h1 class="title glow">Jedis Awards</h1>
        <p class="lede">Vote live for Section J’s awards. One pick per award, before the timer runs out.</p>
      </div>
      <div class="pad" style="flex:1;display:flex;flex-direction:column;gap:8px">
        <label class="label" for="who" id="who-label">Who are you?</label>
        <div id="who-slot"></div>
        <p class="small muted" id="who-help">Type to find your name. It then locks to this phone, so nobody else can vote as you.</p>
        <p class="small" id="who-err" role="alert"></p>
      </div>
      <div class="dock">
        <button class="btn primary big block" id="join-btn" disabled>Join</button>
        <p class="hint">${ICONS.lock.replace('<svg', '<svg width="13" height="13" style="vertical-align:-2px"')} Votes are anonymous. Nobody sees who you picked.</p>
      </div>`;
  },
  bind() {
    loadPeople();
    clearInterval(join.timer);
    join.timer = setInterval(() => { if (mounted.startsWith('join')) loadPeople(); else clearInterval(join.timer); }, 10000);
    $('#join-btn').addEventListener('click', doJoin);
    drawWho();
  },
  update() {
    const closed = S && !S.joining_open;
    $('#who-help').textContent = closed
      ? 'Joining is closed right now. Ask the host to open it.'
      : 'Type to find your name. It then locks to this phone, so nobody else can vote as you.';
    $('#join-btn').disabled = !join.sel || join.busy || closed;
    $('#join-btn').textContent = join.busy ? 'Joining…' : join.sel ? `Join as ${firstName(join.sel.name)}` : 'Join';
    $('#who-err').textContent = join.err;
  },
};

async function loadPeople() {
  try { join.people = await rpc('ja_participants'); if (join.open) drawList(); } catch { /* retry on next tick */ }
}

function drawWho() {
  const slot = $('#who-slot'); if (!slot) return;
  if (join.sel) {
    slot.innerHTML = `<div class="chosen"><span>${esc(join.sel.name)}</span>
      <button class="icon-btn" id="who-clear" aria-label="Change name">${ICONS.x}</button></div>`;
    $('#who-clear').addEventListener('click', () => { join.sel = null; join.q = ''; drawWho(); VIEWS.join.update(); setTimeout(() => $('#who')?.focus(), 0); });
    return;
  }
  slot.innerHTML = `<div class="combo">
      <div class="search">${ICONS.search}<input id="who" class="input" type="text" autocomplete="off" autocapitalize="words" spellcheck="false"
        role="combobox" aria-expanded="false" aria-controls="who-list" aria-autocomplete="list" aria-labelledby="who-label"
        placeholder="Start typing your name" value="${esc(join.q)}"></div>
      <ul class="combo-list" id="who-list" role="listbox" hidden></ul>
    </div>`;
  const input = $('#who');
  input.addEventListener('input', () => { join.q = input.value; join.open = true; join.active = 0; drawList(); });
  input.addEventListener('focus', () => { join.open = true; drawList(); });
  input.addEventListener('blur', () => setTimeout(() => { join.open = false; drawList(); }, 150));
  input.addEventListener('keydown', (e) => {
    const items = matches();
    if (e.key === 'ArrowDown') { e.preventDefault(); join.active = Math.min(items.length - 1, join.active + 1); drawList(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); join.active = Math.max(0, join.active - 1); drawList(); }
    else if (e.key === 'Enter') { e.preventDefault(); const it = items[join.active]; if (it && !it.claimed) choose(it); }
    else if (e.key === 'Escape') { join.open = false; drawList(); }
  });
}

function matches() {
  const q = join.q.trim().toLowerCase();
  const list = join.people || [];
  if (!q) return list;
  const starts = [], contains = [];
  for (const p of list) {
    const n = p.name.toLowerCase();
    if (n.startsWith(q) || n.split(/\s+/).some((w) => w.startsWith(q))) starts.push(p);
    else if (n.includes(q)) contains.push(p);
  }
  return starts.concat(contains);
}

function drawList() {
  const ul = $('#who-list'), input = $('#who');
  if (!ul || !input) return;
  const items = matches();
  const show = join.open && join.people;
  ul.hidden = !show; input.setAttribute('aria-expanded', String(Boolean(show)));
  if (!show) return;
  const q = join.q.trim();
  if (!items.length) { ul.innerHTML = `<li class="combo-item" aria-disabled="true">No one by that name in Section J</li>`; return; }
  ul.innerHTML = items.map((p, i) => {
    let label = esc(p.name);
    if (q) {
      const idx = p.name.toLowerCase().indexOf(q.toLowerCase());
      if (idx >= 0) label = esc(p.name.slice(0, idx)) + '<mark>' + esc(p.name.slice(idx, idx + q.length)) + '</mark>' + esc(p.name.slice(idx + q.length));
    }
    return `<li class="combo-item" role="option" id="opt-${i}" data-i="${i}" aria-selected="${i === join.active}" aria-disabled="${p.claimed}">
      <span>${label}</span>${p.claimed ? '<span class="note">already joined</span>' : ''}</li>`;
  }).join('');
  input.setAttribute('aria-activedescendant', `opt-${join.active}`);
  ul.querySelectorAll('.combo-item[data-i]').forEach((li) => {
    li.addEventListener('mousedown', (e) => e.preventDefault());
    li.addEventListener('click', () => { const p = items[Number(li.dataset.i)]; if (p && !p.claimed) choose(p); });
  });
}

function choose(p) {
  join.sel = p; join.open = false; join.err = '';
  drawWho(); VIEWS.join.update();
  $('#join-btn').focus();
}

async function doJoin() {
  if (!join.sel) return;
  join.busy = true; join.err = ''; VIEWS.join.update();
  try {
    await rpc('ja_claim', { p_participant_id: join.sel.id, p_token: token });
    await window.__sync.refresh();
  } catch (e) {
    join.err = friendly(e);
    if (e.code === 'DEVICE_ALREADY_JOINED') { token = newToken(); store.set('ja.token', token); join.err += ' Try again.'; }
    loadPeople();
  } finally {
    join.busy = false; if (mounted.startsWith('join')) VIEWS.join.update();
  }
}

VIEWS.lobby = {
  mount() {
    const done = S.award_total - S.awards_left;
    return `${topBar()}
      <div class="center">
        <img class="hero-logo" src="assets/logo-256.png" alt="">
        <h1 style="font-size:30px">${done ? 'Next award coming up' : `You’re in, ${esc(firstName(S.me.name))}`}</h1>
        <p class="lede">Keep this page open. ${done ? 'The next award' : 'The first award'} opens here the moment the host starts it.</p>
        <span class="pill"><span class="dot"></span><span id="joined"></span></span>
      </div>
      <div class="pad" style="padding-top:0">
        <div class="card rules">
          <b style="font-size:14px">How it works</b>
          <div class="rule"><b>1</b><span>Each award has a timer. Pick any Jedi, yourself included, and lock it in.</span></div>
          <div class="rule"><b>2</b><span>You can change your pick until the timer runs out.</span></div>
          <div class="rule"><b>3</b><span>The winner is revealed as soon as voting closes. Win once and you’re off the later lists.</span></div>
        </div>
        ${done ? '' : `<p style="text-align:center;margin-top:14px"><button class="btn ghost sm" id="not-me">Not ${esc(firstName(S.me.name))}? Switch name</button></p>`}
      </div>`;
  },
  bind() {
    $('#not-me')?.addEventListener('click', async () => {
      try { await rpc('ja_release_self', { p_token: token }); join.sel = null; join.q = ''; await window.__sync.refresh(); }
      catch (e) { toast(friendly(e)); }
    });
  },
  update() { $('#joined').textContent = `${S.joined} of ${S.voters} Jedis have joined`; },
};

// ----- voting
const RING = ringSvg(66, 6);
VIEWS.vote = {
  mount() {
    const a = S.award;
    return `
      <div class="vote-head">
        <div style="min-width:0">
          <span class="caps">${esc(awardTag())}</span>
          <h1>${esc(a.title)}</h1>
          ${a.description ? `<p class="desc">${esc(a.description)}</p>` : ''}
        </div>
        <div class="ring" id="ring" role="timer" aria-live="off" style="width:66px;height:66px">${RING.html}<span class="val" id="secs" style="font-size:16px"></span></div>
      </div>
      <div id="banner"></div>
      <div id="vote-body" style="flex:1;display:flex;flex-direction:column"></div>
      <div class="dock" id="dock"></div>`;
  },
  bind() { drawVoteBody(); },
  update() { drawVoteBody(); updateTimer(); },
};

function isLocked() { return !local.editing && Boolean(local.pick) && (local.sent === local.pick || local.sending); }

let bodyKey = '';
function drawVoteBody() {
  const paused = S.phase === 'paused';
  const banner = $('#banner');
  const already = S.me.won_award_id ? `<div class="banner"><span class="ic">${ICONS.check.replace('<svg', '<svg width="18" height="18"')}</span><div><b>You’ve already won an award.</b><p class="small muted">You’re off the list, but you can still vote.</p></div></div>` : '';
  banner.innerHTML = paused
    ? `<div class="banner" role="status"><span class="ic">${ICONS.pause.replace('<svg', '<svg width="16" height="16"')}</span>
        <div><b>Paused by the host</b><p class="small muted">The timer is frozen. Your pick is saved and voting picks up where it left off.</p></div></div>`
    : already;

  const locked = isLocked() && !paused;
  const key = locked ? 'locked' : 'list';
  const body = $('#vote-body');
  if (key !== bodyKey || !body.firstChild) {
    bodyKey = key;
    body.innerHTML = locked ? lockedHtml() : listHtml();
    if (locked) $('#change').addEventListener('click', () => { local.editing = true; bodyKey = ''; nomKey = ''; drawVoteBody(); });
    else { nomKey = ''; bindList(); }
  }
  if (locked) {
    $('#locked-name').textContent = names.get(local.pick) || '';
    $('#locked-av').textContent = initials(names.get(local.pick));
    $('#locked-status').textContent = local.sending ? 'Saving…' : 'Change it any time before 0:00.';
    $('#votes-in').textContent = `${S.votes_in} of ${S.joined} have voted`;
    $('#votes-bar').style.width = `${Math.round((S.votes_in / Math.max(1, S.joined)) * 100)}%`;
  } else {
    drawNominees();
  }
  drawDock(paused, locked);
}

function lockedHtml() {
  return `<div class="center" style="justify-content:flex-start;padding-top:40px">
      <div class="big-check">${ICONS.check}</div>
      <h2 style="font-size:28px">Vote locked in</h2>
      <p class="muted" id="locked-status"></p>
      <div class="locked-card" style="margin-top:12px">
        <span class="avatar" id="locked-av"></span>
        <div style="flex:1;display:flex;flex-direction:column;gap:2px"><span class="small muted">Your pick</span><b id="locked-name" style="font-size:18px"></b></div>
        <button class="btn ghost sm" id="change">Change</button>
      </div>
      <div style="width:100%;display:flex;flex-direction:column;gap:8px;margin-top:18px;text-align:left">
        <span class="small" style="font-weight:800" id="votes-in"></span>
        <div class="bar"><i id="votes-bar"></i></div>
      </div>
    </div>`;
}

function listHtml() {
  const n = (S.nominees || []).length;
  return `<div class="vote-tools">
      <div class="search">${ICONS.search}<label class="sr" for="q">Search names</label>
        <input id="q" class="input" type="search" autocomplete="off" spellcheck="false" placeholder="Search ${n} names" value="${esc(local.q)}"></div>
      <span class="small muted" id="count"></span>
    </div>
    <div class="nominees" id="nominees" role="group" aria-label="Nominees"></div>`;
}

function bindList() {
  const q = $('#q');
  q.addEventListener('input', () => { local.q = q.value; drawNominees(); });
  $('#nominees').addEventListener('click', (e) => {
    const b = e.target.closest('.nominee');
    if (b && !b.disabled) pick(b.dataset.id);
  });
}

let nomKey = '';
function drawNominees() {
  const wrap = $('#nominees'); if (!wrap) return;
  const all = S.nominees || [];
  const q = local.q.trim().toLowerCase();
  const list = q ? all.filter((n) => n.name.toLowerCase().includes(q)) : all;
  const paused = S.phase === 'paused';
  wrap.classList.toggle('dim', paused);
  const key = list.map((n) => n.id).join(',') + '|' + local.pick + '|' + paused;
  if (key !== nomKey) {
    nomKey = key;
    wrap.innerHTML = list.length ? list.map((n) => {
      const on = n.id === local.pick;
      return `<button type="button" class="nominee" data-id="${esc(n.id)}" aria-pressed="${on}" ${paused ? 'disabled' : ''}>
        <span class="avatar">${esc(initials(n.name))}</span>
        <span class="nm">${esc(n.name)}${n.id === S.me.id ? '<span class="you">you</span>' : ''}</span>
        <span class="tick">${on ? ICONS.check.replace('<svg', '<svg width="14" height="14"') : ''}</span></button>`;
    }).join('') : `<p class="muted" style="padding:12px">No one matches that.</p>`;
  }
  const off = S.voters - all.length;
  $('#count').textContent = q ? `${list.length} match${list.length === 1 ? '' : 'es'}`
    : `${all.length} in the running${S.award.shortlisted ? ' (shortlist)' : off ? ` · ${off} past winner${off === 1 ? '' : 's'} off the list` : ''}`;
}

function drawDock(paused, locked) {
  const dock = $('#dock');
  let html;
  if (paused) html = `<button class="btn primary big block" disabled>Voting on hold</button><p class="hint">Stay on this page. It wakes up by itself.</p>`;
  else if (locked) html = `<p class="hint">${ICONS.lock.replace('<svg', '<svg width="13" height="13" style="vertical-align:-2px"')} Results are revealed the moment voting closes.</p>`;
  else if (!local.pick) html = `<button class="btn primary big block" disabled>Pick someone to vote</button><p class="hint">You can change your pick until 0:00.</p>`;
  else {
    const name = names.get(local.pick) || '';
    const status = local.error ? local.error : local.sending ? 'Saving your pick…' : 'Saved. Change it any time before 0:00.';
    html = `<button class="btn primary big block" id="lock">Lock in ${esc(firstName(name))}</button><p class="hint" role="status">${esc(status)}</p>`;
  }
  if (dock.dataset.html !== html) {
    dock.dataset.html = html; dock.innerHTML = html;
    $('#lock')?.addEventListener('click', () => { local.editing = false; bodyKey = ''; drawVoteBody(); window.scrollTo(0, 0); });
  }
}

function updateTimer() {
  const ring = $('#ring'); if (!ring || !S.award) return;
  const left = msLeft(S);
  setRing(ring, left / (S.award.duration_s * 1000), RING.circumference);
  $('#secs').textContent = fmtClock(left);
  ring.classList.toggle('urgent', S.phase === 'live' && left <= 10000);
  ring.classList.toggle('paused', S.phase === 'paused');
  ring.setAttribute('aria-label', `${Math.ceil(left / 1000)} seconds left`);
}

// Send picks one at a time; if you tap fast, only the latest pick is sent next.
function pick(id) {
  if (S.phase !== 'live' || msLeft(S) <= 0) return;
  local.pick = id; local.error = null; local.editing = true;
  drawVoteBody();
  if (local.sending) { local.queued = id; return; }
  send(id);
}
async function send(id) {
  local.sending = true; drawVoteBody();
  try {
    await rpc('ja_cast_vote', { p_token: token, p_award_id: local.awardId, p_nominee_id: id });
    local.sent = id; S.my_vote = id;
  } catch (e) {
    local.error = friendly(e);
    if (local.queued == null) local.pick = local.sent;
    if (e.code === 'NOT_JOINED') { window.__sync.refresh(); }
    else if (['VOTING_CLOSED', 'TIME_UP', 'AWARD_NOT_OPEN', 'VOTING_PAUSED', 'NOT_ELIGIBLE'].includes(e.code)) { window.__sync.refresh(); }
  } finally {
    local.sending = false;
    const next = local.queued; local.queued = null;
    if (next && next !== local.sent && S.phase === 'live') send(next);
    else if (mounted.startsWith('vote')) drawVoteBody();
  }
}

// ----- after voting
VIEWS.closed = {
  mount() {
    const mine = S.my_vote ? names.get(S.my_vote) : null;
    return `${topBar()}
      <div class="center">
        <span class="caps muted">${esc(awardTag())}</span>
        <h1 style="font-size:28px">${esc(S.award.title)}</h1>
        <div class="big-check" style="margin-top:10px">${ICONS.lock.replace('<svg', '<svg style="width:34px;height:34px"')}</div>
        <h2 style="font-size:26px">${S.phase === 'closed' ? 'Voting closed' : 'Time’s up'}</h2>
        <p class="lede">${mine ? `Your vote: <b style="color:var(--ink)">${esc(mine)}</b>` : 'You didn’t vote this round.'}</p>
        <p class="small muted" id="closed-votes"></p>
        <div class="drum" aria-hidden="true"><i></i><i></i><i></i></div>
        <p class="small muted">The host reveals the result in a moment.</p>
      </div>`;
  },
  update() { const el = $('#closed-votes'); if (el) el.textContent = `${S.votes_in} vote${S.votes_in === 1 ? '' : 's'} in`; },
};

VIEWS.top3 = {
  mount() {
    const top = S.top3 || [];
    return `${topBar()}
      <div class="reveal">
        <span class="caps muted">${esc(awardTag())}</span>
        <span class="award-name">${esc(S.award.title)}</span>
        <h1 style="font-size:30px;margin-top:14px">${top.length ? `The top ${top.length}` : 'No votes this round'}</h1>
        <div class="top3">${top.map((n) => `<div class="${n === S.me.name ? 'me' : ''}">${esc(n)}</div>`).join('')}</div>
        <p style="margin-top:18px;font-weight:800;font-size:18px">And the Jedi is…</p>
        <div class="drum" aria-hidden="true"><i></i><i></i><i></i></div>
      </div>`;
  },
};

function resultBits() {
  const r = S.result || {};
  const winners = (r.winners || []).map((w) => w.name);
  const runners = (r.runners || []).map((x) => `${esc(x.name)} ${x.votes}`).join(' · ');
  return { r, winners, runners };
}

VIEWS.winner = {
  mount() {
    const { r, winners, runners } = resultBits();
    return `${topBar()}
      <div class="reveal">
        <img src="assets/logo-256.png" alt="" style="width:84px;height:84px">
        <span class="caps muted" style="margin-top:14px">${esc(awardTag())}</span>
        <span class="award-name">${esc(S.award.title)}</span>
        ${winners.length ? `
          <span class="muted" style="margin-top:22px;font-weight:700">${winners.length > 1 ? 'Joint winners' : 'And the Jedi is'}</span>
          <div class="winner">${winners.map(esc).join('<br>')}</div>
          ${r.picked_by_admin ? '<p class="small muted">Picked by the host</p>' : `<p style="font-weight:800;margin-top:8px">${r.votes} of ${r.total} votes${winners.length > 1 ? ' each' : ''}</p>`}
          ${runners ? `<p class="small muted">Runners-up: ${runners}</p>` : ''}`
        : `<div class="winner" style="font-size:34px">No winner</div><p class="muted">Nobody voted this round.</p>`}
      </div>
      <div class="dock"><p class="hint">The next award opens here when the host is ready.</p></div>`;
  },
  bind() { celebrate(); },
};

VIEWS.won = {
  mount() {
    const { r, winners } = resultBits();
    const joint = winners.length > 1;
    return `<div class="reveal">
        <div class="ring-logo"><img src="assets/logo-256.png" alt="Jedis logo"></div>
        <h1 style="margin-top:22px">You won, ${esc(firstName(S.me.name))}!</h1>
        <span class="caps" style="margin-top:8px">${esc(awardTag())}${joint ? ' · joint winner' : ''}</span>
        <span class="award-name" style="font-size:26px">${esc(S.award.title)}</span>
        <p style="font-weight:800;margin-top:8px">${r.picked_by_admin ? 'Picked by the host' : `${r.votes} of ${r.total} Jedis picked you`}</p>
      </div>
      <div class="pad"><div class="notice" style="background:rgba(0,0,0,.18);border-color:transparent;color:#fff;font-weight:600">Take a bow. You’re off the lists for the rest of the night, but you can keep voting.</div></div>`;
  },
  bind() { celebrate(); },
};

function celebrate(colors) {
  const k = S.award?.id + ':' + S.phase;
  if (celebrated === k) return;
  celebrated = k;
  confetti(colors ? { colors } : {});
}

VIEWS.wall = {
  mount() {
    const w = S.wall || [];
    return `${topBar()}
      <div class="reveal" style="justify-content:flex-start">
        <h1 style="font-size:32px" class="glow">Hall of Fame</h1>
        <p class="muted">${w.length} award${w.length === 1 ? '' : 's'} so far</p>
        <div class="wall-list" style="margin-top:8px">
          ${w.map((a) => `<div><span>${a.number}. ${esc(a.title)}</span><b>${esc(joinNames(a.winners) || 'No winner')}</b></div>`).join('')}
        </div>
      </div>`;
  },
};
