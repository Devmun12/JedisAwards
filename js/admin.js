// Admin panel: run the night, edit awards and people, see results.
import {
  configured, rpc, startSync, msLeft, fmtClock, friendly, esc, joinNames, store, toast, ICONS,
  setupNotice, $, $$,
} from './core.js';
import { drumroll, stopDrumroll, fanfare, unlockAudio } from './fx.js';

const app = $('#app');
const dlg = $('#dlg');
const ss = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* memory only */ } },
  del(k) { try { sessionStorage.removeItem(k); } catch { /* ignore */ } },
};

let pass = ss.get('ja.admin');
let A = null;                // latest admin state
let sync = null;
let peek = false;
let conn = 'polling';
let soundOn = store.get('ja.sound.admin', '1') === '1';
let tab = (location.hash || '#live').slice(1);
let busy = false;
let editing = null;          // award id being edited, or 'new'
let draft = null;
let closingFor = null;
let lastSig = '';

if (!configured) app.innerHTML = `<div class="login">${setupNotice()}</div>`;
else if (!pass) showLogin();
else start();

// ---------------------------------------------------------------- login
function showLogin(err = '') {
  app.innerHTML = `<form class="login" id="login">
      <div class="brand"><img src="assets/logo-256.png" alt=""><b>Jedis Awards</b><span class="tag">Admin</span></div>
      <h1 style="font-size:30px">Sign in to run the night</h1>
      <div class="field"><label class="label" for="pw">Admin password</label>
        <input class="input" id="pw" type="password" autocomplete="current-password" required></div>
      <p class="small" role="alert">${esc(err)}</p>
      <button class="btn primary big block" type="submit">Sign in</button>
      <p class="small muted">Set the password once in Supabase (DEPLOY.md, step 3). It stays signed in until you close this tab.</p>
    </form>`;
  $('#pw').focus();
  $('#login').addEventListener('submit', async (e) => {
    e.preventDefault();
    unlockAudio();
    const pw = $('#pw').value;
    const btn = e.submitter || $('#login button'); btn.disabled = true; btn.textContent = 'Checking…';
    try {
      const s = await rpc('ja_admin_state', { p_pass: pw, p_peek: false });
      pass = pw; ss.set('ja.admin', pw); A = s; start();
    } catch (er) { showLogin(friendly(er)); }
  });
}

function logout() { ss.del('ja.admin'); pass = null; sync && sync.stop(); location.reload(); }

function start() {
  app.innerHTML = shell();
  bindShell();
  sync = startSync(() => rpc('ja_admin_state', { p_pass: pass, p_peek: peek }), apply, {
    fast: 1000, idle: 4000, rtFast: 1500, rtIdle: 8000,
    onStatus: (s) => { conn = s; drawStatus(); },
    onError: (e) => { if (e.code === 'BAD_PASSWORD') logout(); },
  });
  setInterval(tick, 250);
  window.addEventListener('hashchange', () => { tab = (location.hash || '#live').slice(1); editing = null; draft = null; drawStatus(); drawTab(true); window.scrollTo(0, 0); });
  document.addEventListener('click', () => unlockAudio(), { once: true });
}

// ---------------------------------------------------------------- calls
async function call(fn, args = {}, { quiet = false } = {}) {
  if (busy && !quiet) return null;
  busy = true; markBusy();
  try {
    const s = await rpc('ja_admin_' + fn, { p_pass: pass, ...args });
    if (s && typeof s === 'object' && s.admin) apply(s);
    return s;
  } catch (e) {
    toast(friendly(e));
    if (e.code === 'BAD_PASSWORD') logout();
    return null;
  } finally {
    busy = false; markBusy();
  }
}
function markBusy() { $$('[data-act]').forEach((b) => { if (b.tagName === 'BUTTON') b.toggleAttribute('aria-busy', busy); }); }

function apply(s) {
  const prev = A;
  A = s;
  sounds(prev, s);
  drawStatus();
  drawTab(false);
}

// Sounds follow what's on screen, wherever the click came from.
function sounds(prev, s) {
  if (!prev || !soundOn) return;
  if (s.phase === 'top3' && prev.phase !== 'top3') drumroll({ maxSeconds: 14 });
  if (s.phase === 'winner' && prev.phase !== 'winner') fanfare();
  if (prev.phase === 'top3' && s.phase !== 'top3' && s.phase !== 'winner') stopDrumroll();
}

function tick() {
  if (!A) return;
  if (A.phase === 'live' && A.award && msLeft(A) <= 0 && closingFor !== A.award.id) {
    closingFor = A.award.id;                // timer hit zero: close for everyone
    call('close', {}, { quiet: true });
  }
  if (tab === 'live') updateClock();
}

// ---------------------------------------------------------------- shell
function shell() {
  return `<header class="top"><div class="wrap topbar">
      <div class="brand"><img src="assets/logo-256.png" alt=""><b>Jedis Awards</b><span class="tag">Admin</span></div>
      <nav aria-label="Admin sections">
        <a href="#live">Live control</a><a href="#awards">Awards</a><a href="#people">People</a><a href="#results">Results</a>
      </nav>
      <div class="status-line">
        <span id="conn"></span>
        <a class="btn sm" href="screen.html" target="_blank" rel="noopener">${ICONS.screen} Big screen</a>
        <a class="btn sm" href="cards.html" target="_blank" rel="noopener">Power cards</a>
        <button class="btn sm" id="sound" aria-pressed="${soundOn}"></button>
        <button class="btn sm ghost" id="logout">Sign out</button>
      </div>
    </div></header>
    <main><div class="wrap" id="tab"></div></main>`;
}
function bindShell() {
  $('#logout').addEventListener('click', logout);
  $('#sound').addEventListener('click', () => {
    soundOn = !soundOn; store.set('ja.sound.admin', soundOn ? '1' : '0'); unlockAudio(); if (!soundOn) stopDrumroll(); drawStatus();
  });
  drawStatus();
}
function drawStatus() {
  $$('nav a').forEach((a) => a.setAttribute('aria-current', a.getAttribute('href') === '#' + tab ? 'page' : 'false'));
  const c = $('#conn');
  if (c) c.innerHTML = `<span class="dot ${conn === 'live' ? '' : 'off'}"></span> ${conn === 'live' ? 'Live' : 'Polling'}${A ? ` · ${A.joined} of ${A.voters} joined` : ''}`;
  const s = $('#sound');
  if (s) { s.innerHTML = `${soundOn ? ICONS.sound : ICONS.mute} Sound ${soundOn ? 'on' : 'off'}`; s.setAttribute('aria-pressed', String(soundOn)); s.title = 'Drumroll and applause on this laptop'; }
}

function drawTab(force) {
  if (!A) return;
  const root = $('#tab'); if (!root) return;
  // Don't redraw a form while someone is typing in it.
  const typing = root.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if (!force && (editing || typing) && tab !== 'live') return;
  const sig = tab + '|' + JSON.stringify(tab === 'live' ? liveSig() : A);
  if (!force && sig === lastSig) return;
  lastSig = sig;
  const scroll = window.scrollY;
  ({ live: drawLive, awards: drawAwards, people: drawPeople, results: drawResults }[tab] || drawLive)(root);
  if (!force) window.scrollTo(0, scroll);
}
function liveSig() {
  return [A.phase, A.version, A.votes_in, A.joined, A.eligible, A.joining_open, A.ends_at, A.remaining_ms, peek, JSON.stringify(A.tally), soundOn,
    A.awards.map((a) => a.status + a.title + JSON.stringify(a.result)).join()];
}

// ---------------------------------------------------------------- LIVE
const nextQueued = () => A.awards.find((a) => a.status === 'queued');
const busyPhase = () => ['live', 'paused', 'closed', 'top3'].includes(A.phase);

function drawLive(root) {
  const cur = A.award;
  const nq = nextQueued();
  const showCurrent = cur && ['live', 'paused', 'closed', 'top3', 'winner'].includes(A.phase);
  root.innerHTML = `<div class="cols">
    <aside class="side card" aria-label="Run order">
      <div style="display:flex;justify-content:space-between;align-items:center"><h2 class="sec">Run order</h2><a href="#awards" class="small" style="font-weight:800">Edit awards</a></div>
      <div class="run">${A.awards.map(runItem).join('') || '<p class="muted small">No awards yet. Add some on the Awards tab.</p>'}</div>
    </aside>
    <div class="main">
      <section class="card" style="padding:24px;display:flex;flex-direction:column;gap:20px" aria-label="Current award">
        ${showCurrent ? currentHtml(cur) : readyHtml(nq)}
      </section>
      <div class="row2">
        <section class="card" aria-label="Live tally" style="display:flex;flex-direction:column;gap:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
            <h2 class="sec">Live tally <span class="muted" style="font-weight:600">· only you see this</span></h2>
            <button class="btn sm" data-act="peek">${peek ? 'Hide' : 'Peek'}</button>
          </div>
          ${peek ? tallyHtml() : `<p class="muted small" style="padding:22px 14px;text-align:center;border:1px dashed var(--line-strong);border-radius:12px">Hidden so the reveal surprises you too.<br>Peek only if you need to check something.</p>`}
        </section>
        <section class="card" aria-label="Event controls">
          <h2 class="sec">Event controls</h2>
          <div class="setting" style="margin-top:6px"><div class="txt"><b>Joining is ${A.joining_open ? 'open' : 'locked'}</b><span>${A.joined} of ${A.voters} have joined</span></div>
            <button class="switch" role="switch" aria-checked="${A.joining_open}" aria-label="Joining open" data-act="joining"><i></i></button></div>
          <div class="setting"><div class="txt"><b>Hall of fame</b><span>${A.phase === 'wall' ? 'Showing on the big screen now' : 'Every winner so far, on the big screen'}</span></div>
            <button class="btn sm" data-act="${A.phase === 'wall' ? 'lobby' : 'wall'}" ${busyPhase() ? 'disabled' : ''}>${A.phase === 'wall' ? 'Back to join screen' : 'Show'}</button></div>
          <div class="setting"><div class="txt"><b>Free up a name</b><span>Someone switched phones?</span></div>
            <a class="btn sm" href="#people">People</a></div>
          <div class="setting"><div class="txt"><b>Reset whole event</b><span>Wipes every vote and winner. For rehearsals.</span></div>
            <button class="btn sm danger" data-act="reset">Reset…</button></div>
        </section>
      </div>
    </div>
  </div>`;
  bindLive(root);
  updateClock();
}

function runItem(a) {
  const isCur = A.award && A.award.id === a.id && A.phase !== 'lobby' && A.phase !== 'wall';
  const won = a.result && a.result.winners ? joinNames(a.result.winners.map((w) => w.name)) : '';
  const chip = { queued: 'Queued', live: A.phase === 'paused' && isCur ? 'Paused' : 'Live', closed: A.phase === 'top3' && isCur ? 'Top 3' : 'Closed', revealed: 'Revealed' }[a.status];
  const nq = nextQueued();
  const canOpen = a.status === 'queued' && !busyPhase();
  return `<div class="run-item ${isCur ? 'current' : ''} ${a.status === 'revealed' ? 'done' : ''}">
    <span class="n">${a.number}</span>
    <span class="t"><b title="${esc(a.title)}">${esc(a.title)}</b>${won ? `<span>${esc(won)}</span>` : a.status === 'revealed' ? '<span>No winner</span>' : ''}</span>
    ${a.status === 'queued'
      ? `<button class="btn sm ${nq && nq.id === a.id ? '' : 'ghost'}" data-act="open" data-id="${a.id}" ${canOpen ? '' : 'disabled'} title="Open this award now">Open</button>`
      : `<span class="chip ${isCur ? 'solid' : ''}">${chip}</span>`}
  </div>`;
}

function readyHtml(nq) {
  const done = A.awards.filter((a) => a.status === 'revealed').length;
  if (!nq) {
    return `<span class="caps muted">All done</span>
      <h1 style="font-size:36px">${A.awards.length ? `All ${A.awards.length} awards revealed` : 'No awards yet'}</h1>
      <p class="muted">${A.awards.length ? 'Put the hall of fame on the big screen to close the night.' : 'Add awards on the Awards tab.'}</p>
      <div class="actions">${A.awards.length ? `<button class="btn primary big" data-act="${A.phase === 'wall' ? 'lobby' : 'wall'}">${A.phase === 'wall' ? 'Back to join screen' : 'Show the hall of fame'}</button>` : `<a class="btn primary big" href="#awards">Add awards</a>`}</div>`;
  }
  return `<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center"><span class="chip">${done ? 'Between awards' : 'Ready'}</span>
      <span class="small muted" style="font-weight:700">Up next: award ${nq.number} of ${A.awards.length}</span></div>
    <div><h1 style="font-size:38px">${esc(nq.title)}</h1>${nq.description ? `<p class="muted" style="margin-top:6px">${esc(nq.description)}</p>` : ''}</div>
    <div class="stats">
      <div class="stat"><span class="k">Timer</span><span class="v num">${nq.duration_s}<small> s</small></span></div>
      <div class="stat"><span class="k">Joined</span><span class="v num">${A.joined}<small> / ${A.voters}</small></span></div>
      <div class="stat"><span class="k">${nq.shortlist ? 'Shortlist' : 'In the running'}</span><span class="v num">${nq.shortlist ? nq.shortlist.filter((id) => !A.people.find((p) => p.id === id)?.won_award_id).length : A.eligible}</span></div>
    </div>
    <div class="actions"><button class="btn primary big" data-act="open" data-id="${nq.id}">Open award ${nq.number} ${ICONS.arrow}</button>
      ${done ? `<button class="btn" data-act="wall">Show hall of fame</button>` : ''}</div>`;
}

function currentHtml(cur) {
  const p = A.phase;
  const label = { live: '● Live', paused: 'Paused', closed: 'Voting closed', top3: 'Top 3 on the big screen', winner: 'Winner on the big screen' }[p];
  const solid = p === 'live' || p === 'winner';
  const nq = nextQueued();
  const r = cur && A.awards.find((a) => a.id === cur.id);
  let onscreen = '';
  if (p === 'top3') onscreen = `<div class="onscreen"><span class="caps muted">On the big screen now</span><b style="font-size:18px">Top ${A.top3.length}, A to Z: ${esc(A.top3.join(', ') || 'no votes')}</b></div>`;
  if (p === 'winner' && r && r.result) {
    const w = r.result.winners.map((x) => x.name);
    onscreen = `<div class="onscreen"><span class="caps muted">On the big screen now</span>
      <b style="font-size:22px">${w.length ? `${esc(joinNames(w))} · ${r.result.votes} of ${r.result.total} votes${w.length > 1 ? ' each (joint)' : ''}` : 'No winner (no votes)'}</b>
      ${r.result.runners.length ? `<span class="small muted">Runners-up: ${r.result.runners.map((x) => `${esc(x.name)} ${x.votes}`).join(' · ')}</span>` : ''}
      ${w.length ? `<span class="small muted">${esc(joinNames(w))} ${w.length > 1 ? 'are' : 'is'} now off the later lists.</span>` : `<span class="small muted">Pick a winner on the Results tab, or move on.</span>`}</div>`;
  }
  let controls = '';
  if (p === 'live') controls = `
    <button class="btn" data-act="pause">${ICONS.pause} Pause</button>
    <button class="btn" data-act="add15">${ICONS.plus} 15 s</button>
    <button class="btn" data-act="close">${ICONS.stop} Close voting now</button>
    <button class="btn ghost" data-act="restart">${ICONS.restart} Restart award</button>
    <span class="small muted">The reveal unlocks when voting closes, at 0:00 or when you close it.</span>`;
  if (p === 'paused') controls = `
    <button class="btn primary" data-act="resume">${ICONS.play} Resume</button>
    <button class="btn" data-act="add15">${ICONS.plus} 15 s</button>
    <button class="btn" data-act="close">${ICONS.stop} Close voting now</button>
    <button class="btn ghost" data-act="restart">${ICONS.restart} Restart award</button>`;
  if (p === 'closed') controls = `
    <button class="btn primary big" data-act="top3">Reveal top 3</button>
    <button class="btn" data-act="winner">Skip to winner</button>
    <button class="btn ghost" data-act="restart">${ICONS.restart} Restart award</button>`;
  if (p === 'top3') controls = `
    <button class="btn primary big" data-act="winner">Reveal winner</button>
    <button class="btn ghost" data-act="restart">${ICONS.restart} Restart award</button>`;
  if (p === 'winner') controls = nq
    ? `<button class="btn primary big" data-act="open" data-id="${nq.id}">Open next: ${esc(nq.title)} ${ICONS.arrow}</button>
       <button class="btn" data-act="wall">Show hall of fame</button>`
    : `<button class="btn primary big" data-act="wall">Show the hall of fame</button>`;

  return `<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">
      <span class="chip ${solid ? 'solid' : 'hot'}">${label}</span>
      <span class="small muted" style="font-weight:700">Award ${cur.number} of ${A.award_total} · ${cur.duration_s} s${cur.shortlisted ? ' · shortlist' : ''}</span></div>
    <div><h1 style="font-size:38px">${esc(cur.title)}</h1>${cur.description ? `<p class="muted" style="margin-top:6px">${esc(cur.description)}</p>` : ''}</div>
    <div class="stats">
      <div class="stat"><span class="k">Time left</span><span class="v num" id="clock">0:00</span><div class="bar"><i id="clock-bar" style="width:0%"></i></div></div>
      <div class="stat"><span class="k">Votes in</span><span class="v num">${A.votes_in}<small> / ${A.joined}</small></span><div class="bar"><i style="width:${Math.round(A.votes_in / Math.max(1, A.joined) * 100)}%"></i></div></div>
      <div class="stat"><span class="k">In the running</span><span class="v num">${A.eligible}</span><span class="small muted">${A.voters - A.eligible} off the list</span></div>
    </div>
    ${onscreen}
    <div class="actions">${controls}</div>`;
}

function tallyHtml() {
  const t = A.tally || [];
  if (!A.award || !busyPhase()) return '<p class="muted small">Nothing is being voted on right now.</p>';
  if (!t.length) return '<p class="muted small">No votes yet.</p>';
  const top = t[0].votes || 1;
  return `<div class="tally">${t.slice(0, 8).map((r) => `<div class="r"><div><span>${esc(r.name)}</span><span class="num">${r.votes}</span></div>
    <div class="bar"><i style="width:${Math.round(r.votes / top * 100)}%"></i></div></div>`).join('')}</div>`;
}

function updateClock() {
  const c = $('#clock'); if (!c || !A || !A.award) return;
  const left = msLeft(A);
  c.textContent = fmtClock(left);
  const bar = $('#clock-bar'); if (bar) bar.style.width = `${Math.min(100, left / (A.award.duration_s * 1000) * 100)}%`;
}

function bindLive(root) {
  root.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
    const act = b.dataset.act;
    unlockAudio();
    if (act === 'open') { closingFor = null; await call('open', { p_award_id: b.dataset.id }); }
    else if (act === 'pause') await call('pause');
    else if (act === 'resume') await call('resume');
    else if (act === 'add15') await call('add_time', { p_seconds: 15 });
    else if (act === 'close') await call('close');
    else if (act === 'restart') { if (await ask('Restart this award?', 'Every vote for this award is wiped and the timer starts again.', 'Restart')) { closingFor = null; await call('restart'); } }
    else if (act === 'top3') await call('reveal_top3');
    else if (act === 'winner') await call('reveal_winner');
    else if (act === 'wall') await call('set_phase', { p_phase: 'wall' });
    else if (act === 'lobby') await call('set_phase', { p_phase: 'lobby' });
    else if (act === 'joining') await call('set_joining', { p_open: !A.joining_open });
    else if (act === 'peek') { peek = !peek; lastSig = ''; await sync.refresh(); }
    else if (act === 'reset') resetEvent();
  }));
}

async function resetEvent() {
  const res = await ask('Reset the whole event?',
    'Every vote and winner is wiped and all awards go back to queued. Awards and names stay.',
    'Reset everything', { confirmText: 'RESET', checkbox: 'Also sign every phone out (everyone picks their name again)' });
  if (res) await call('reset_event', { p_confirm: 'RESET', p_clear_claims: res.checked });
}

// ---------------------------------------------------------------- AWARDS
function drawAwards(root) {
  const queued = A.awards.filter((a) => a.status === 'queued').length;
  root.innerHTML = `<div class="page-head">
      <div><h1>Awards</h1><p class="muted" style="margin-top:4px">${A.awards.length} award${A.awards.length === 1 ? '' : 's'} · drag or use the arrows to change the running order</p></div>
      <div class="actions">
        <button class="btn" data-act="paste">Paste a list</button>
        <button class="btn primary" data-act="add">${ICONS.plus} Add award</button>
      </div>
    </div>
    <div class="card" style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-bottom:16px">
      <b style="font-size:15px">Timer for every queued award</b>
      <select class="input" id="all-time" style="width:120px;min-height:44px">${timeOptions(45)}</select>
      <button class="btn sm" data-act="all-time" ${queued ? '' : 'disabled'}>Apply to ${queued} queued</button>
      <span class="small muted">Each award can also have its own time (10–90 s) in its editor.</span>
    </div>
    <div class="list" id="award-list">
      ${A.awards.map((a, i) => awardRow(a, i) + (editing === a.id ? editorHtml(a) : '')).join('')}
      ${editing === 'new' ? editorHtml(null) : ''}
      ${A.awards.length ? '' : '<p class="muted" style="padding:18px">No awards yet.</p>'}
    </div>
    <p class="small muted" style="margin-top:12px">Awards that have already run are locked. Reset one on the Results tab to run it again.</p>`;
  bindAwards(root);
}

const timeOptions = (sel) => Array.from({ length: 17 }, (_, i) => 10 + i * 5).map((s) => `<option value="${s}" ${s === sel ? 'selected' : ''}>${s} s</option>`).join('');

function awardRow(a, i) {
  const q = a.status === 'queued';
  const pool = a.shortlist ? `Shortlist · ${a.shortlist.length}` : 'Everyone';
  return `<div class="list-row" data-id="${a.id}" ${q ? 'draggable="true"' : ''}>
    ${q ? `<span class="handle" title="Drag to reorder">${ICONS.grip.replace('<svg', '<svg width="18" height="18"')}</span>` : `<span style="color:var(--line-strong)" title="Already run">${ICONS.lock.replace('<svg', '<svg width="18" height="18"')}</span>`}
    <span class="n">${a.number}</span>
    <div class="grow"><b>${esc(a.title)}</b>${a.description ? `<span>${esc(a.description)}</span>` : ''}</div>
    <div class="meta">
      <span class="chip">${a.duration_s} s</span>
      <span class="chip ${a.shortlist ? 'hot' : ''}">${pool}</span>
      <span class="chip ${a.status === 'queued' ? '' : 'solid'}">${{ queued: 'Queued', live: 'Live', closed: 'Closed', revealed: 'Revealed' }[a.status]}</span>
      ${q ? `<button class="icon-btn" data-act="up" data-i="${i}" aria-label="Move up">${ICONS.up}</button>
      <button class="icon-btn" data-act="down" data-i="${i}" aria-label="Move down">${ICONS.down}</button>
      <button class="icon-btn" data-act="edit" data-id="${a.id}" aria-label="Edit">${ICONS.edit}</button>
      <button class="icon-btn" data-act="dup" data-id="${a.id}" aria-label="Duplicate">${ICONS.copy}</button>
      <button class="icon-btn" data-act="del" data-id="${a.id}" aria-label="Delete">${ICONS.trash}</button>` : ''}
    </div>
  </div>`;
}

function editorHtml(a) {
  if (!draft) draft = a
    ? { title: a.title, description: a.description, duration_s: a.duration_s, shortlist: a.shortlist ? [...a.shortlist] : null, q: '' }
    : { title: '', description: '', duration_s: 45, shortlist: null, q: '' };
  const d = draft;
  return `<form class="editor" id="editor">
    <b>${a ? `Editing award ${a.number}` : 'New award'}</b>
    <div class="grid2">
      <div class="field"><label class="label" for="ed-title">Award title</label>
        <input class="input" id="ed-title" maxlength="80" required value="${esc(d.title)}" placeholder="e.g. The Excel Wizard"></div>
      <div class="field"><label class="label" for="ed-desc">One-line description <span class="muted" style="font-weight:600">(optional)</span></label>
        <input class="input" id="ed-desc" maxlength="160" value="${esc(d.description)}" placeholder="Shown under the title"></div>
    </div>
    <div class="field"><label class="label" for="ed-time">Voting time: <span id="ed-time-v">${d.duration_s} s</span></label>
      <input type="range" id="ed-time" min="10" max="90" step="5" value="${d.duration_s}"></div>
    <fieldset style="border:0;padding:0;margin:0;display:flex;flex-direction:column;gap:8px">
      <legend class="label">Who can be voted for</legend>
      <label style="display:flex;gap:10px;align-items:center;font-weight:700"><input type="radio" name="pool" value="all" ${d.shortlist ? '' : 'checked'}> Everyone who hasn’t won yet</label>
      <label style="display:flex;gap:10px;align-items:center;font-weight:700"><input type="radio" name="pool" value="short" ${d.shortlist ? 'checked' : ''}> A shortlist I pick <span class="muted small" id="short-count"></span></label>
      <div id="short-wrap" ${d.shortlist ? '' : 'hidden'}>
        <div class="search" style="margin-bottom:8px">${ICONS.search}<input class="input" id="short-q" placeholder="Search names" value="${esc(d.q)}"></div>
        <div class="picker" id="picker"></div>
      </div>
    </fieldset>
    <div class="actions">
      <button class="btn primary" type="submit">Save award</button>
      <button class="btn" type="button" data-act="cancel">Cancel</button>
    </div>
  </form>`;
}

function drawPicker() {
  const box = $('#picker'); if (!box || !draft) return;
  const q = (draft.q || '').toLowerCase();
  const sel = new Set(draft.shortlist || []);
  box.innerHTML = A.people.filter((p) => !q || p.name.toLowerCase().includes(q)).map((p) => {
    const won = Boolean(p.won_award_id);
    return `<label class="${won ? 'off' : ''}"><input type="checkbox" value="${esc(p.id)}" ${sel.has(p.id) ? 'checked' : ''} ${won ? 'disabled' : ''}> ${esc(p.name)}${won ? ' <span class="tiny">(won)</span>' : ''}</label>`;
  }).join('');
  $('#short-count').textContent = draft.shortlist ? `(${draft.shortlist.length} picked)` : '';
}

let dragId = null;
function bindAwards(root) {
  root.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async (e) => {
    const act = b.dataset.act;
    if (act === 'add') { editing = 'new'; draft = null; drawTab(true); $('#ed-title')?.focus(); }
    else if (act === 'edit') { editing = b.dataset.id; draft = null; drawTab(true); $('#ed-title')?.focus(); }
    else if (act === 'cancel') { e.preventDefault(); editing = null; draft = null; drawTab(true); }
    else if (act === 'dup') {
      const a = A.awards.find((x) => x.id === b.dataset.id);
      await call('save_award', { p_id: null, p_title: (a.title + ' (copy)').slice(0, 80), p_description: a.description, p_duration_s: a.duration_s, p_shortlist: a.shortlist });
      drawTab(true);
    } else if (act === 'del') {
      const a = A.awards.find((x) => x.id === b.dataset.id);
      if (await ask(`Delete “${a.title}”?`, 'This can’t be undone.', 'Delete')) { await call('delete_award', { p_id: a.id }); drawTab(true); }
    } else if (act === 'up' || act === 'down') {
      move(Number(b.dataset.i), act === 'up' ? -1 : 1);
    } else if (act === 'all-time') {
      const s = Number($('#all-time').value);
      if (await ask(`Set every queued award to ${s} seconds?`, 'Awards that have already run keep their time.', 'Apply')) { await call('set_all_durations', { p_seconds: s }); drawTab(true); }
    } else if (act === 'paste') pasteDialog();
  }));

  // drag and drop (queued awards only)
  root.querySelectorAll('.list-row[draggable="true"]').forEach((row) => {
    row.addEventListener('dragstart', (e) => { dragId = row.dataset.id; row.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); });
    row.addEventListener('dragend', () => { dragId = null; $$('.list-row').forEach((r) => r.classList.remove('dragging', 'drop-before', 'drop-after')); });
  });
  root.querySelectorAll('.list-row').forEach((row) => {
    row.addEventListener('dragover', (e) => {
      if (!dragId || row.dataset.id === dragId || !row.hasAttribute('draggable')) return;
      e.preventDefault();
      const r = row.getBoundingClientRect(); const after = e.clientY > r.top + r.height / 2;
      row.classList.toggle('drop-after', after); row.classList.toggle('drop-before', !after);
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-before', 'drop-after'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      const after = row.classList.contains('drop-after');
      row.classList.remove('drop-before', 'drop-after');
      if (!dragId || dragId === row.dataset.id) return;
      const ids = A.awards.map((a) => a.id).filter((id) => id !== dragId);
      let at = ids.indexOf(row.dataset.id) + (after ? 1 : 0);
      ids.splice(at, 0, dragId);
      reorder(ids);
    });
  });

  const form = $('#editor');
  if (form) {
    const t = $('#ed-time');
    t.addEventListener('input', () => { draft.duration_s = Number(t.value); $('#ed-time-v').textContent = `${t.value} s`; });
    $('#ed-title').addEventListener('input', (e) => { draft.title = e.target.value; });
    $('#ed-desc').addEventListener('input', (e) => { draft.description = e.target.value; });
    form.querySelectorAll('input[name="pool"]').forEach((r) => r.addEventListener('change', () => {
      draft.shortlist = r.value === 'short' && r.checked ? (draft.shortlist || []) : (r.value === 'all' && r.checked ? null : draft.shortlist);
      $('#short-wrap').hidden = !draft.shortlist; drawPicker();
    }));
    $('#short-q')?.addEventListener('input', (e) => { draft.q = e.target.value; drawPicker(); });
    $('#picker')?.addEventListener('change', (e) => {
      const id = e.target.value; const set = new Set(draft.shortlist || []);
      e.target.checked ? set.add(id) : set.delete(id);
      draft.shortlist = [...set]; $('#short-count').textContent = `(${set.size} picked)`;
    });
    drawPicker();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (draft.shortlist && !draft.shortlist.length) { toast('Pick at least one person for the shortlist.'); return; }
      const ok = await call('save_award', {
        p_id: editing === 'new' ? null : editing, p_title: draft.title, p_description: draft.description,
        p_duration_s: draft.duration_s, p_shortlist: draft.shortlist,
      });
      if (ok) { editing = null; draft = null; toast('Award saved'); drawTab(true); }
    });
  }
}

function move(i, dir) {
  const ids = A.awards.map((a) => a.id);
  let j = i + dir;
  while (j >= 0 && j < ids.length && A.awards[j].status !== 'queued') j += dir;
  if (j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  reorder(ids);
}
async function reorder(ids) { await call('reorder', { p_ids: ids }); drawTab(true); }

async function pasteDialog() {
  dlg.innerHTML = `<form method="dialog" style="display:flex;flex-direction:column;gap:14px">
    <h3>Paste a list of awards</h3>
    <p class="small muted">One award per line. Add a description after a dash: <b>The Night Owl — Online at 3 a.m.</b></p>
    <textarea class="input" id="paste-text" rows="10" placeholder="Most Likely to Become a CEO — Already talks in quarterly targets.\nBest Dressed\n…"></textarea>
    <div class="field"><label class="label" for="paste-time">Voting time for these</label><select class="input" id="paste-time">${timeOptions(45)}</select></div>
    <p class="small" id="paste-msg"></p>
    <div class="actions"><button class="btn primary" value="ok" id="paste-go">Add awards</button><button class="btn" value="cancel">Cancel</button></div>
  </form>`;
  dlg.returnValue = '';
  dlg.showModal();
  $('#paste-text').focus();
  const go = await new Promise((res) => dlg.addEventListener('close', () => res(dlg.returnValue === 'ok'), { once: true }));
  if (!go) return;
  const lines = $('#paste-text').value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const secs = Number($('#paste-time').value);
  let added = 0;
  for (const line of lines) {
    const m = line.replace(/^\s*(\d+[.)]|[-•*])\s*/, '').split(/\s+[—–-]\s+|\s*\|\s*|\t/);
    const title = (m[0] || '').trim().slice(0, 80);
    const desc = m.slice(1).join(' — ').trim().slice(0, 160);
    if (!title) continue;
    const r = await call('save_award', { p_id: null, p_title: title, p_description: desc, p_duration_s: secs, p_shortlist: null }, { quiet: true });
    if (r) added++;
  }
  toast(`Added ${added} award${added === 1 ? '' : 's'}`);
  drawTab(true);
}

// ---------------------------------------------------------------- PEOPLE
let peopleQ = '';
function drawPeople(root) {
  const q = peopleQ.toLowerCase();
  const titleOf = (id) => A.awards.find((a) => a.id === id)?.title || '';
  const rows = A.people.filter((p) => !q || p.name.toLowerCase().includes(q));
  root.innerHTML = `<div class="page-head">
      <div><h1>People</h1><p class="muted" style="margin-top:4px">${A.joined} of ${A.voters} joined · ${A.people.filter((p) => p.won_award_id).length} have won</p></div>
      <form class="actions" id="add-person"><input class="input" id="new-name" placeholder="Add a name" maxlength="60" style="width:220px;min-height:44px"><button class="btn sm primary" type="submit">${ICONS.plus} Add</button></form>
    </div>
    <div class="card" style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;margin-bottom:16px">
      <div class="setting" style="padding:0;border:0;flex:1"><div class="txt"><b>Joining is ${A.joining_open ? 'open' : 'locked'}</b><span>Lock it once everyone is in, so nobody can grab a free name.</span></div>
        <button class="switch" role="switch" aria-checked="${A.joining_open}" aria-label="Joining open" data-act="joining"><i></i></button></div>
    </div>
    <div class="search" style="margin-bottom:12px;max-width:420px">${ICONS.search}<input class="input" id="people-q" placeholder="Search ${A.voters} names" value="${esc(peopleQ)}"></div>
    <div class="list scroll-x"><table class="table">
      <thead><tr><th>Name</th><th>Phone</th><th>Won</th><th>Votes cast</th><th style="text-align:right">Actions</th></tr></thead>
      <tbody>${rows.map((p) => `<tr>
        <td><b>${esc(p.name)}</b></td>
        <td>${p.claimed ? '<span class="chip solid">Joined</span>' : '<span class="chip">Not joined</span>'}</td>
        <td>${p.won_award_id ? esc(titleOf(p.won_award_id)) : '<span class="muted">—</span>'}</td>
        <td class="num">${p.votes_cast}</td>
        <td style="text-align:right;white-space:nowrap">
          ${p.claimed ? `<button class="btn sm" data-act="release" data-id="${esc(p.id)}">Free up name</button>` : ''}
          <button class="btn sm ghost" data-act="rename" data-id="${esc(p.id)}">Rename</button>
          <button class="btn sm ghost" data-act="remove" data-id="${esc(p.id)}" ${p.won_award_id ? 'disabled title="Has won an award"' : ''}>Remove</button>
        </td></tr>`).join('')}</tbody></table></div>`;
  const pq = $('#people-q');
  pq.addEventListener('input', () => { peopleQ = pq.value; const pos = pq.selectionStart; drawTab(true); const n = $('#people-q'); n.focus(); n.setSelectionRange(pos, pos); });
  $('#add-person').addEventListener('submit', async (e) => {
    e.preventDefault(); const v = $('#new-name').value.trim(); if (!v) return;
    if (await call('add_person', { p_name: v })) { toast(`Added ${v}`); drawTab(true); }
  });
  root.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
    const p = A.people.find((x) => x.id === b.dataset.id);
    if (b.dataset.act === 'joining') await call('set_joining', { p_open: !A.joining_open });
    else if (b.dataset.act === 'release') { if (await ask(`Free up ${p.name}?`, 'Their phone is signed out and they can pick their name again on any phone. Votes already cast still count.', 'Free up')) await call('release', { p_participant_id: p.id }); }
    else if (b.dataset.act === 'rename') { const r = await ask(`Rename ${p.name}`, '', 'Save', { input: p.name }); if (r && r.value.trim()) await call('rename_person', { p_id: p.id, p_name: r.value }); }
    else if (b.dataset.act === 'remove') { if (await ask(`Remove ${p.name}?`, 'Their votes are deleted too. Use this only for names that shouldn’t be on the list.', 'Remove')) await call('remove_person', { p_id: p.id }); }
    drawTab(true);
  }));
}

// ---------------------------------------------------------------- RESULTS
function drawResults(root) {
  const revealed = A.awards.filter((a) => a.status === 'revealed');
  const winners = A.people.filter((p) => p.won_award_id).length;
  root.innerHTML = `<div class="page-head">
      <div><h1>Results</h1><p class="muted" style="margin-top:4px">${revealed.length} of ${A.awards.length} awards revealed · ${winners} Jedi${winners === 1 ? ' has' : 's have'} won and ${winners === 1 ? 'is' : 'are'} off the later lists</p></div>
      <div class="actions">
        <button class="btn" data-act="${A.phase === 'wall' ? 'lobby' : 'wall'}" ${busyPhase() ? 'disabled' : ''}>${ICONS.screen} ${A.phase === 'wall' ? 'Back to join screen' : 'Hall of fame on big screen'}</button>
        <button class="btn primary" data-act="csv">${ICONS.download} Download CSV</button>
      </div>
    </div>
    <div class="list scroll-x"><table class="table">
      <thead><tr><th>#</th><th>Award</th><th>Winner</th><th>Votes</th><th>Runners-up</th><th>Status</th><th></th></tr></thead>
      <tbody>${A.awards.map((a) => {
        const r = a.result;
        const w = r ? r.winners.map((x) => x.name) : [];
        const cur = A.award && A.award.id === a.id && busyPhase();
        return `<tr class="${cur ? 'current' : ''}">
          <td class="num">${a.number}</td>
          <td><b>${esc(a.title)}</b></td>
          <td>${r ? (w.length ? `<b>${esc(joinNames(w))}</b> ${w.length > 1 ? '<span class="chip hot">Joint</span>' : ''} ${r.picked_by_admin ? '<span class="chip">Picked</span>' : ''}` : '<span class="muted">No votes</span>') : '<span class="muted">—</span>'}</td>
          <td class="num">${r && !r.picked_by_admin ? `${r.votes} of ${r.total}` : ''}</td>
          <td class="small">${r ? r.runners.map((x) => `${esc(x.name)} ${x.votes}`).join(' · ') : ''}</td>
          <td><span class="chip ${a.status === 'queued' ? '' : 'solid'}">${{ queued: 'Queued', live: 'Live', closed: 'Closed', revealed: 'Revealed' }[a.status]}</span></td>
          <td style="text-align:right;white-space:nowrap">
            ${r && !w.length ? `<button class="btn sm" data-act="pick" data-id="${a.id}">Pick winner</button>` : ''}
            ${a.status !== 'queued' ? `<button class="btn sm ghost" data-act="reset-award" data-id="${a.id}">Reset</button>` : ''}
          </td></tr>`;
      }).join('')}</tbody></table></div>
    <p class="small muted" style="margin-top:12px">Reset puts an award back in the queue, wipes its votes and puts its winner back in the running.</p>`;
  root.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
    const act = b.dataset.act;
    const a = A.awards.find((x) => x.id === b.dataset.id);
    if (act === 'csv') downloadCsv();
    else if (act === 'wall') await call('set_phase', { p_phase: 'wall' });
    else if (act === 'lobby') await call('set_phase', { p_phase: 'lobby' });
    else if (act === 'reset-award') { if (await ask(`Reset “${a.title}”?`, 'Its votes are wiped, its winner goes back in the running, and it can be run again.', 'Reset award')) await call('reset_award', { p_award_id: a.id }); }
    else if (act === 'pick') {
      const opts = A.people.filter((p) => !p.won_award_id);
      const r = await ask(`Pick a winner for “${a.title}”`, 'Nobody voted for this award.', 'Make winner', { select: opts.map((p) => [p.id, p.name]) });
      if (r) await call('pick_winner', { p_award_id: a.id, p_participant_id: r.value });
    }
    drawTab(true);
  }));
}

function downloadCsv() {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['#', 'Award', 'Status', 'Winner(s)', 'Winner votes', 'Total votes', 'Runner-up 1', 'Votes', 'Runner-up 2', 'Votes', 'Picked by host']];
  for (const a of A.awards) {
    const r = a.result || {};
    const run = r.runners || [];
    rows.push([a.number, a.title, a.status, joinNames((r.winners || []).map((w) => w.name)), r.votes ?? '', r.total ?? '',
      run[0]?.name ?? '', run[0]?.votes ?? '', run[1]?.name ?? '', run[1]?.votes ?? '', r.picked_by_admin ? 'yes' : '']);
  }
  const blob = new Blob(['﻿' + rows.map((r) => r.map(q).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'jedis-awards-results.csv';
  document.body.appendChild(a); a.click(); a.remove();
}

// ---------------------------------------------------------------- dialog helper
function ask(title, body, okLabel, { confirmText, checkbox, input, select } = {}) {
  dlg.innerHTML = `<form method="dialog" style="display:flex;flex-direction:column;gap:14px">
    <h3>${esc(title)}</h3>
    ${body ? `<p class="muted">${esc(body)}</p>` : ''}
    ${confirmText ? `<div class="field"><label class="label" for="dlg-confirm">Type ${confirmText} to confirm</label><input class="input" id="dlg-confirm" autocomplete="off"></div>` : ''}
    ${input !== undefined ? `<input class="input" id="dlg-input" value="${esc(input)}" maxlength="60">` : ''}
    ${select ? `<select class="input" id="dlg-select">${select.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select>` : ''}
    ${checkbox ? `<label style="display:flex;gap:10px;align-items:center;font-weight:700"><input type="checkbox" id="dlg-check"> ${esc(checkbox)}</label>` : ''}
    <div class="actions"><button class="btn primary" value="ok" id="dlg-ok" ${confirmText ? 'disabled' : ''}>${esc(okLabel)}</button><button class="btn" value="cancel">Cancel</button></div>
  </form>`;
  dlg.returnValue = '';
  dlg.showModal();
  const c = $('#dlg-confirm');
  if (c) { c.focus(); c.addEventListener('input', () => { $('#dlg-ok').disabled = c.value.trim() !== confirmText; }); }
  else ($('#dlg-input') || $('#dlg-select') || $('#dlg-ok')).focus();
  return new Promise((res) => dlg.addEventListener('close', () => {
    if (dlg.returnValue !== 'ok') return res(null);
    res({ checked: Boolean($('#dlg-check')?.checked), value: ($('#dlg-input') || $('#dlg-select'))?.value ?? '' });
  }, { once: true }));
}
