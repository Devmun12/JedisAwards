// Big screen for the projector: join code, countdown, top 3, winner, hall of fame.
/* global qrcode */
import {
  CONFIG, configured, rpc, startSync, msLeft, esc, initials, joinNames, store, ICONS, ringSvg, setRing, setupNotice, $,
} from './core.js';
import { confetti, drumroll, stopDrumroll, fanfare, unlockAudio } from './fx.js';

const stage = $('#stage');
let S = null, mounted = '', prevPhase = null, celebrated = '';
let soundOn = store.get('ja.sound.screen', '0') === '1';
let ring = null;

const voteUrl = new URL('./', location.href).href;
const prettyUrl = voteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');

if (!configured) stage.innerHTML = `<div class="center-col"><div style="max-width:640px">${setupNotice()}</div></div>`;
else {
  startSync(() => rpc('ja_get_state', {}), (s) => { const p = S && S.phase; S = s; render(p); }, { fast: 1000, idle: 3000, rtFast: 2000, rtIdle: 8000 });
  setInterval(tick, 200);
  addEventListener('resize', () => { mounted = ''; render(S && S.phase); });
}

// controls appear when the mouse moves
let hideT;
addEventListener('mousemove', () => { document.body.classList.add('show-ctl'); clearTimeout(hideT); hideT = setTimeout(() => document.body.classList.remove('show-ctl'), 2500); });
const sndBtn = $('#snd');
const drawSnd = () => { sndBtn.innerHTML = `${soundOn ? ICONS.sound : ICONS.mute} Sound ${soundOn ? 'on' : 'off'}`; };
drawSnd();
sndBtn.addEventListener('click', () => { soundOn = !soundOn; store.set('ja.sound.screen', soundOn ? '1' : '0'); unlockAudio(); if (!soundOn) stopDrumroll(); drawSnd(); });
$('#fs').addEventListener('click', toggleFs);
addEventListener('keydown', (e) => { if (e.key === 'f' || e.key === 'F') toggleFs(); });
function toggleFs() { unlockAudio(); if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.(); }

function viewFor(s) {
  if (s.phase === 'live' && msLeft(s) <= 0) return 'closed';
  if (s.phase === 'live' || s.phase === 'paused') return 'live';
  return { closed: 'closed', top3: 'top3', winner: 'winner', wall: 'wall' }[s.phase] || 'lobby';
}

function render(prev) {
  if (!S) return;
  const v = viewFor(S);
  const key = `${v}:${S.award?.id || ''}:${S.phase}`;
  if (key !== mounted) {
    mounted = key;
    document.body.classList.toggle('dark-stage', v === 'top3');
    document.body.classList.toggle('red-stage', v === 'winner');
    stage.innerHTML = VIEWS[v].mount();
  }
  VIEWS[v].update && VIEWS[v].update();
  // sound + confetti on transitions
  if (prev != null && prev !== S.phase) {
    if (S.phase === 'top3' && soundOn) drumroll({ maxSeconds: 14 });
    if (S.phase === 'winner' && soundOn) fanfare();
    if (S.phase !== 'top3' && S.phase !== 'winner') stopDrumroll();
  }
  if (S.phase === 'winner' && celebrated !== S.award?.id && (S.result?.winners || []).length) {
    celebrated = S.award.id;
    setTimeout(() => confetti({ count: 260, duration: 5200 }), 250);
  }
}

function tick() {
  if (!S) return;
  if (S.phase === 'live' && viewFor(S) !== mounted.split(':')[0]) render(S.phase);
  if (mounted.startsWith('live')) VIEWS.live.update();
}

const head = (left) => `<div class="bar-top"><span class="caps">${left}</span>
  <div class="brand"><img src="assets/logo-256.png" alt=""><b>Jedis Awards</b></div></div>`;
const tag = () => S.award ? `Award ${S.award.number} of ${S.award_total}` : '';

function qrSvg(text) {
  const qr = qrcode(0, 'M'); qr.addData(text); qr.make();
  const n = qr.getModuleCount(), m = 2, size = n + m * 2;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + m} ${r + m}h1v1h-1z`;
  return `<svg viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="QR code for ${esc(text)}"><path d="${d}" fill="#000"/></svg>`;
}

const VIEWS = {};
VIEWS.lobby = {
  mount() {
    const done = S.award_total - S.awards_left;
    return `<div class="body">
        <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2.4vh">
          <img src="assets/logo-256.png" alt="Jedis logo" style="width:clamp(80px,9vw,150px);height:auto">
          <h1 class="mega glow">Jedis Awards</h1>
          <p class="sub">${esc(CONFIG.subtitle || '')}</p>
          <div style="margin-top:2vh;display:flex;flex-direction:column;gap:.6vh">
            <span class="sub" style="font-weight:700">Scan the code or go to</span>
            <span class="url">${esc(prettyUrl)}</span>
          </div>
        </div>
        <div class="qr">${qrSvg(voteUrl)}</div>
      </div>
      <div class="foot">
        <span class="big num" id="joined"></span>
        <div class="bar"><i id="joined-bar"></i></div>
        <span class="note">${done ? `${S.awards_left} award${S.awards_left === 1 ? '' : 's'} to go` : 'First award starts soon'}</span>
      </div>`;
  },
  update() {
    $('#joined').innerHTML = `${S.joined}<small> / ${S.voters} joined</small>`;
    $('#joined-bar').style.width = `${Math.round(S.joined / Math.max(1, S.voters) * 100)}%`;
  },
};

VIEWS.live = {
  mount() {
    const size = Math.round(Math.min(innerHeight * 0.44, innerWidth * 0.27));
    ring = ringSvg(size, Math.max(12, Math.round(size * 0.075)));
    return `${head(tag())}
      <div class="body">
        <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2.2vh">
          <h1 class="mega">${esc(S.award.title)}</h1>
          ${S.award.description ? `<p class="sub">${esc(S.award.description)}</p>` : ''}
          <p class="sub" style="color:var(--ink);font-weight:700;margin-top:1vh">Vote on your phone now</p>
        </div>
        <div class="ring" id="ring" style="width:${size}px;height:${size}px">${ring.html}
          <span class="val" style="flex-direction:column;display:flex;align-items:center;justify-content:center">
            <span id="secs" style="font-size:${Math.round(size * 0.34)}px;line-height:1;letter-spacing:-0.03em" class="glow"></span>
            <span style="font-size:${Math.round(size * 0.075)}px;color:var(--muted)">seconds</span>
          </span>
        </div>
      </div>
      <div class="foot">
        <span class="big num" id="votes"></span>
        <div class="bar"><i id="votes-bar"></i></div>
        <span class="note">Winner revealed when time’s up</span>
      </div>
      ${S.phase === 'paused' ? '<div class="paused-veil"><div>Paused</div></div>' : ''}`;
  },
  update() {
    const r = $('#ring'); if (!r) return;
    const left = msLeft(S);
    setRing(r, left / (S.award.duration_s * 1000), ring.circumference);
    $('#secs').textContent = Math.ceil(left / 1000);
    r.classList.toggle('urgent', S.phase === 'live' && left <= 10000);
    r.classList.toggle('paused', S.phase === 'paused');
    $('#votes').innerHTML = `${S.votes_in}<small> / ${S.joined} voted</small>`;
    $('#votes-bar').style.width = `${Math.round(S.votes_in / Math.max(1, S.joined) * 100)}%`;
  },
};

VIEWS.closed = {
  mount() {
    return `${head(tag())}
      <div class="center-col">
        <span class="sub">${esc(S.award.title)}</span>
        <h1 class="mega glow">${S.phase === 'closed' ? 'Voting closed' : 'Time’s up'}</h1>
        <p class="sub" id="closed-votes"></p>
        <div class="drum" aria-hidden="true" style="transform:scale(1.8);margin-top:3vh"><i></i><i></i><i></i></div>
      </div>`;
  },
  update() { $('#closed-votes').textContent = `${S.votes_in} vote${S.votes_in === 1 ? '' : 's'} in · revealing in a moment`; },
};

VIEWS.top3 = {
  mount() {
    const top = S.top3 || [];
    const cols = Math.min(Math.max(top.length, 1), 4);
    return `${head(tag())}
      <div class="center-col">
        <span class="sub" style="font-weight:700">${top.length ? 'The nominees for' : 'Nobody voted for'}</span>
        <h1 class="mega glow" style="font-size:clamp(40px,6vw,100px)">${esc(S.award.title)}</h1>
        <div class="cards" style="grid-template-columns:repeat(${cols},minmax(0,1fr));margin-top:3vh">
          ${top.map((n, i) => `<div style="animation-delay:${0.25 + i * 0.35}s"><span class="avatar">${esc(initials(n))}</span><b>${esc(n)}</b></div>`).join('')}
        </div>
        ${top.length ? `<div style="display:flex;align-items:center;gap:1.4vw;margin-top:4vh">
          <span style="font-size:clamp(22px,2.8vw,44px);font-weight:800">And the Jedi is</span>
          <div class="drum" aria-hidden="true" style="transform:scale(1.6)"><i></i><i></i><i></i></div></div>` : ''}
      </div>`;
  },
};

VIEWS.winner = {
  mount() {
    const r = S.result || {};
    const w = (r.winners || []).map((x) => x.name);
    const runners = (r.runners || []).map((x) => `${esc(x.name)} ${x.votes}`).join(' · ');
    return `<div class="center-col" style="padding-top:3vh">
        <img src="assets/logo-256.png" alt="" style="width:clamp(70px,8vw,130px);height:auto">
        <span class="caps" style="font-size:clamp(14px,1.6vw,24px);color:#fff">${esc(tag())} · ${esc(S.award.title)}</span>
        ${w.length ? `
          <span class="sub" style="margin-top:2vh">${w.length > 1 ? 'Joint winners' : 'And the Jedi is'}</span>
          <div class="winner-name ${w.length > 1 ? 'two' : ''}">${w.map(esc).join('<br>')}</div>
          ${r.picked_by_admin ? '' : `<span style="font-size:clamp(22px,2.6vw,40px);font-weight:800;margin-top:1.5vh;color:#fff">${r.votes} of ${r.total} votes${w.length > 1 ? ' each' : ''}</span>`}
          ${runners ? `<span class="sub">Runners-up: ${runners}</span>` : ''}`
        : `<div class="winner-name two">No winner</div><span class="sub">Nobody voted this round.</span>`}
      </div>`;
  },
};

const cols = (n) => (n > 16 ? 5 : 4);
VIEWS.wall = {
  mount() {
    const w = S.wall || [];
    return `<div class="bar-top" style="padding-bottom:2.5vh">
        <div style="display:flex;align-items:center;gap:1.4vw"><img src="assets/logo-256.png" alt="" style="width:clamp(44px,5vw,84px);height:auto">
          <div><h1 class="glow" style="font-size:clamp(32px,4.4vw,72px)">Hall of Fame</h1><span class="sub" style="font-size:clamp(14px,1.6vw,24px)">Jedis Awards · ${esc(CONFIG.subtitle || '')}</span></div></div>
      </div>
      <div class="wall" style="grid-template-columns:repeat(${cols(w.length)},minmax(0,1fr));grid-auto-rows:minmax(0,${Math.min(24, Math.floor(72 / Math.max(1, Math.ceil(w.length / cols(w.length)))))}vh)">
        ${w.map((a) => `<div><span>${a.number}. ${esc(a.title)}</span><b>${esc(joinNames(a.winners) || 'No winner')}</b></div>`).join('')}
      </div>`;
  },
};
