// Power card reveal: pick a study group, then reveal its Jedis one card at a time.
// Presenter keys: Space / → / Enter / PageDown = next, ← / PageUp = back, Esc = groups,
// F = full screen, S = sound. Clicking or tapping the stage also goes next.
import { GROUPS, CARD_W, CARD_H } from './cards-data.js';
import { unlockAudio, riser, whoosh, impact, fanfare, stopDrumroll } from './fx.js';

const RATIO = CARD_W / CARD_H;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const touch = matchMedia('(pointer: coarse)').matches;
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode: keep in memory only */ } },
};

const picker = $('#picker'), stage = $('#stage'), deck = $('#deck'), cap = $('#caption'), hint = $('#hint');
const dim = $('#dim'), rays = $('#rays'), halo = $('#halo'), flashEl = $('#flash'), progress = $('#progress');
const sgTitle = $('#sg-title');

let soundOn = store.get('ja.cards.sound', '1') === '1';
let done;
try { done = new Set(JSON.parse(store.get('ja.cards.done', '[]'))); } catch { done = new Set(); }
const S = { view: 'picker', g: -1, revealed: 0, centered: -1, busy: false, phase: 'intro', els: [], group: null, geo: null, run: 0 };
const TOTAL = GROUPS.reduce((n, g) => n + g.members.length, 0);
const say = (t) => (touch ? t.replace(/Space or click/g, 'Tap').replace(/Space/g, 'Tap') : t);

// ---------------------------------------------------------------- picker
function nextGroup() { return GROUPS.findIndex((g) => !done.has(g.sg)); }
function drawPicker() {
  $('#picker-sub').textContent = `${GROUPS.length} study groups · ${TOTAL} Jedis. ${done.size ? `${done.size} of ${GROUPS.length} revealed. ` : ''}${touch ? 'Tap a group to reveal it.' : 'Pick a group, or press Space for the next one.'}`;
  const nx = nextGroup();
  $('#sg-grid').innerHTML = GROUPS.map((g, i) => `
    <button class="sg-tile ${done.has(g.sg) ? 'done' : ''} ${i === nx ? 'next' : ''}" data-i="${i}" aria-label="Reveal study group ${g.sg}, ${g.members.length} Jedis${done.has(g.sg) ? ' (already revealed)' : ''}">
      ${done.has(g.sg) ? '<span class="badge">Revealed</span>' : ''}
      <span class="thumb" aria-hidden="true"><img src="${g.back}" alt="" loading="lazy"><img src="${g.back}" alt="" loading="lazy"><img src="${g.back}" alt="" loading="lazy"></span>
      <b>${g.sg}</b><span>${g.members.length} Jedis</span>
    </button>`).join('');
}
$('#sg-grid').addEventListener('click', (e) => {
  const b = e.target.closest('.sg-tile');
  if (b) openGroup(Number(b.dataset.i));
});
$('#reset-done').addEventListener('click', () => { done.clear(); store.set('ja.cards.done', '[]'); drawPicker(); });

// ---------------------------------------------------------------- geometry
function geom() {
  const W = stage.clientWidth, H = stage.clientHeight;
  const n = S.group.members.length;
  const portrait = H > W * 1.05;
  const gap = Math.max(10, W * 0.014);
  const rowH = Math.min(H * (portrait ? 0.14 : 0.2), (W * 0.9 - gap * (n - 1)) / n / RATIO);
  const rowW = rowH * RATIO;
  const startX = W / 2 - (n * rowW + (n - 1) * gap) / 2 + rowW / 2;
  const rowY = H - rowH / 2 - H * (portrait ? 0.065 : 0.055);
  const cH = portrait ? Math.min(H * 0.48, (W * 0.78) / RATIO) : Math.min(H * 0.7, (W * 0.4) / RATIO);
  const cW = cH * RATIO;
  const cx = portrait ? W / 2 : W * 0.37;
  const cy = portrait ? H * 0.37 : H * 0.43;
  return { W, H, n, portrait, rowH, rowW, gap, rowY, cW, cH, cx, cy, slotS: rowH / cH, slotX: (k) => startX + k * (rowW + gap) };
}
function T(x, y, s, r = 0) {
  const g = S.geo;
  return `translate3d(${(x - g.cW / 2).toFixed(1)}px, ${(y - g.cH / 2).toFixed(1)}px, 0) scale(${s.toFixed(4)}) rotate(${r}deg)`;
}
const atSlot = (k, extraY = 0, sMul = 1) => T(S.geo.slotX(k), S.geo.rowY + extraY, S.geo.slotS * sMul);
const atCenter = (s = 1, r = 0) => T(S.geo.cx, S.geo.cy, s, r);

function layout() {
  if (!S.group) return;
  S.geo = geom();
  const g = S.geo;
  stage.style.setProperty('--cx', `${g.cx}px`);
  stage.style.setProperty('--cy', `${g.cy}px`);
  S.els.forEach((el, k) => {
    el.style.width = `${g.cW}px`; el.style.height = `${g.cH}px`;
    if (!el.getAnimations().length) el.style.transform = k === S.centered ? atCenter() : atSlot(k);
  });
  const gc = deck.querySelector('.group-card');
  if (gc) { gc.style.width = `${g.cW}px`; gc.style.height = `${g.cH}px`; gc.style.transform = atCenter(); }
  placeCaption();
}
addEventListener('resize', () => layout());

// ---------------------------------------------------------------- helpers
async function run(el, frames, opts) {
  const a = el.animate(frames, { fill: 'forwards', ...opts });
  try { await a.finished; } catch { return; }
  const last = frames[frames.length - 1];
  for (const k of Object.keys(last)) if (!['offset', 'easing', 'composite'].includes(k)) el.style[k] = last[k];
  a.cancel();
}
const alive = (tok) => tok === S.run && S.view === 'stage';
function preload(urls) {
  return Promise.all(urls.map((u) => new Promise((res) => {
    const i = new Image(); i.onload = () => (i.decode ? i.decode().then(res, res) : res()); i.onerror = res; i.src = u;
  })));
}
function cardEl(m, back) {
  const el = document.createElement('div');
  el.className = 'tc';
  el.innerHTML = `<div class="tc-tilt"><div class="tc-inner">
      <div class="tc-face tc-front"><img src="${m.img}" alt="${esc(m.name)}, ${esc(m.title)}. Warrior no. ${esc(m.no)}. ${esc(m.desc)}" draggable="false"><div class="tc-holo"></div><div class="tc-glare"></div></div>
      <div class="tc-face tc-back"><img src="${back}" alt="" draggable="false"></div>
    </div></div>`;
  return el;
}
function drawProgress() {
  progress.innerHTML = S.group.members.map((_, k) => `<i class="${k < S.revealed ? 'on' : ''} ${k === S.centered ? 'now' : ''}"></i>`).join('');
}
function setHint(t) { hint.textContent = say(t); }

// ---------------------------------------------------------------- open / close a group
async function openGroup(i) {
  if (S.busy && S.view === 'stage') return;
  unlockAudio();
  const tok = ++S.run;
  Object.assign(S, { view: 'stage', g: i, group: GROUPS[i], revealed: 0, centered: -1, busy: true, phase: 'intro', els: [] });
  picker.hidden = true; stage.hidden = false; document.body.classList.add('staging');
  window.scrollTo(0, 0);
  deck.innerHTML = ''; cap.className = 'caption'; cap.innerHTML = '';
  $('#sg-name').textContent = S.group.sg;
  [dim, rays, halo].forEach((e) => { e.style.opacity = 0; });
  setHint('Loading cards…');
  await preload([S.group.back, ...S.group.members.map((m) => m.img)]);
  if (!alive(tok)) return;
  // warm up the next group in the background
  const nx = GROUPS[i + 1]; if (nx) preload([nx.back, ...nx.members.map((m) => m.img)]);

  S.els = S.group.members.map((m) => { const el = cardEl(m, S.group.back); deck.appendChild(el); return el; });
  layout(); drawProgress(); setHint('');
  const g = S.geo;

  // Title slams in, the deck flies up and deals out face down.
  if (soundOn) whoosh(0.9);
  run(sgTitle, [{ opacity: 0, transform: 'scale(1.9)', filter: 'blur(14px)' }, { opacity: 1, transform: 'scale(1)', filter: 'blur(0px)' }],
    { duration: reduce ? 1 : 750, easing: 'cubic-bezier(.2,.9,.2,1)' });
  await Promise.all(S.els.map((el, k) => run(el, [
    { transform: T(g.W / 2, g.H + g.cH * 0.6, g.slotS * 1.6, (k - (g.n - 1) / 2) * 14), opacity: 0 },
    { transform: atSlot(k), opacity: 1 },
  ], { duration: reduce ? 1 : 850, delay: reduce ? 0 : 250 + k * 120, easing: 'cubic-bezier(.2,.9,.25,1.12)' })));
  if (!alive(tok)) return;
  S.busy = false;
  setHint(`${S.group.members.length} Jedis in ${S.group.sg} · Space or click to reveal`);
}

async function closeGroup() {
  S.run++;
  S.busy = false; S.view = 'picker'; S.group = null; S.els = []; S.centered = -1;
  stopDrumroll();
  deck.innerHTML = ''; cap.className = 'caption'; cap.innerHTML = '';
  stage.hidden = true; picker.hidden = false; document.body.classList.remove('staging');
  drawPicker();
}

// ---------------------------------------------------------------- the reveal
async function reveal(k) {
  const tok = S.run;
  S.busy = true; S.phase = 'reveal'; S.centered = k;
  const el = S.els[k], inner = el.querySelector('.tc-inner'), holo = el.querySelector('.tc-holo');
  el.classList.add('center');
  S.els.forEach((o, j) => o.classList.toggle('dimmed', j !== k));
  drawProgress(); setHint('');

  run(dim, [{ opacity: 0 }, { opacity: 1 }], { duration: 600 });
  run(halo, [{ opacity: 0, transform: 'scale(.5)' }, { opacity: 0.55, transform: 'scale(1)' }], { duration: 900 });
  run(rays, [{ opacity: 0 }, { opacity: 0.7 }], { duration: 1200 });

  if (reduce) {
    el.style.transform = atCenter(); inner.style.transform = 'rotateY(0deg)';
  } else {
    // 1. lift out of the row, face down
    await run(el, [{ transform: atSlot(k) }, { transform: atCenter(0.92, -5) }], { duration: 750, easing: 'cubic-bezier(.2,.8,.2,1)' });
    if (!alive(tok)) return;
    // 2. charge up: trembling, glowing, a rising swell
    if (soundOn) riser(1.05);
    const shake = [];
    for (let i = 0; i <= 14; i++) {
      const a = (i / 14) * 7;
      shake.push({ transform: T(S.geo.cx + (Math.random() - 0.5) * a, S.geo.cy + (Math.random() - 0.5) * a, 0.92 + 0.08 * (i / 14), -5 + 5 * (i / 14)) });
    }
    run(halo, [{ opacity: 0.55, transform: 'scale(1)' }, { opacity: 1, transform: 'scale(1.25)' }], { duration: 1050, easing: 'ease-in' });
    await run(el, shake, { duration: 1050, easing: 'linear' });
    if (!alive(tok)) return;
    // 3. the swivel: two and a half turns, fast then slow
    if (soundOn) whoosh(1.3);
    const spinMs = 1600;
    const spin = inner.animate([{ transform: 'rotateY(180deg)' }, { transform: 'rotateY(1080deg)' }],
      { duration: spinMs, easing: 'cubic-bezier(.45,0,.12,1)', fill: 'forwards' });
    const pulse = el.animate([
      { transform: atCenter(1, 0) }, { transform: atCenter(1.14, 0), offset: 0.45 }, { transform: atCenter(0.98, 0), offset: 0.8 }, { transform: atCenter(1, 0) },
    ], { duration: spinMs, easing: 'ease-in-out', fill: 'forwards' });
    await sleep(spinMs * 0.6);
    if (!alive(tok)) return;
    // 4. the face lands: flash, sparks, boom, foil shine
    boom(el, holo);
    await spin.finished.catch(() => {});
    if (!alive(tok)) return;
    inner.style.transform = 'rotateY(0deg)'; spin.cancel();
    el.style.transform = atCenter(); pulse.cancel();
    run(halo, [{ opacity: 1 }, { opacity: 0.55 }], { duration: 900 });
  }
  el.classList.add('live');
  S.revealed = Math.max(S.revealed, k + 1);
  drawProgress();
  showCaption(k);
  setHint(k + 1 < S.group.members.length ? 'Space for the next Jedi' : 'Space to see the whole group');
  S.busy = false;
}

function boom(el, holo) {
  const r = stage.getBoundingClientRect();
  const x = r.left + S.geo.cx, y = r.top + S.geo.cy;
  run(flashEl, [{ opacity: 0 }, { opacity: 0.95, offset: 0.12 }, { opacity: 0 }], { duration: 650, easing: 'ease-out' });
  sparks(x, y, 170);
  setTimeout(() => sparks(x, y, 90, 0.7), 140);
  if (soundOn) impact();
  holo.animate([
    { opacity: 0, backgroundPosition: '0% 0%' }, { opacity: 0.95, offset: 0.25 }, { opacity: 0.18, backgroundPosition: '100% 100%' },
  ], { duration: 1500, easing: 'ease-out' });
  stage.animate([
    { transform: 'translate(0,0)' }, { transform: 'translate(-7px,4px)' }, { transform: 'translate(6px,-5px)' },
    { transform: 'translate(-4px,3px)' }, { transform: 'translate(2px,-1px)' }, { transform: 'translate(0,0)' },
  ], { duration: 380, easing: 'ease-out' });
}

// Center card goes back to its slot, face up.
async function settle(k) {
  const tok = S.run;
  S.busy = true;
  const el = S.els[k];
  hideCaption();
  el.classList.remove('live');
  el.querySelector('.tc-tilt').style.transform = '';
  run(dim, [{ opacity: 1 }, { opacity: 0 }], { duration: 500 });
  run(rays, [{ opacity: 0.7 }, { opacity: 0 }], { duration: 500 });
  run(halo, [{ opacity: 0.55 }, { opacity: 0 }], { duration: 500 });
  await run(el, [{ transform: atCenter() }, { transform: atSlot(k) }], { duration: reduce ? 1 : 650, easing: 'cubic-bezier(.5,0,.2,1)' });
  if (!alive(tok)) return;
  el.classList.remove('center'); el.classList.add('slot-done');
  S.els.forEach((o) => o.classList.remove('dimmed'));
  S.centered = -1; drawProgress();
  S.busy = false;
}

// After the last Jedi: the group card takes the stage.
async function finale() {
  const tok = S.run;
  S.busy = true; S.phase = 'finale';
  done.add(S.group.sg); store.set('ja.cards.done', JSON.stringify([...done]));
  const g = S.geo;
  const gc = document.createElement('div');
  gc.className = 'tc center group-card';
  gc.style.width = `${g.cW}px`; gc.style.height = `${g.cH}px`;
  gc.innerHTML = `<div class="tc-tilt"><div class="tc-inner" style="transform:rotateY(90deg)"><div class="tc-face"><img src="${S.group.back}" alt="Study group ${esc(S.group.sg)}: ${esc(S.group.members.map((m) => m.name).join(', '))}" draggable="false"><div class="tc-holo"></div><div class="tc-glare"></div></div></div></div>`;
  deck.appendChild(gc);
  gc.style.transform = atCenter(0.7);
  run(rays, [{ opacity: 0 }, { opacity: 0.85 }], { duration: 900 });
  run(halo, [{ opacity: 0 }, { opacity: 0.7 }], { duration: 900 });
  if (soundOn) fanfare({ applauseSeconds: 5 });
  // row cards jump in a wave
  S.els.forEach((el, k) => el.animate([
    { transform: atSlot(k) }, { transform: atSlot(k, -g.rowH * 0.28, 1.08), offset: 0.5 }, { transform: atSlot(k) },
  ], { duration: reduce ? 1 : 700, delay: k * 90, easing: 'ease-in-out' }));
  const inner = gc.querySelector('.tc-inner');
  run(inner, [{ transform: 'rotateY(90deg)' }, { transform: 'rotateY(0deg)' }], { duration: reduce ? 1 : 900, easing: 'cubic-bezier(.2,.9,.25,1.1)' });
  await run(gc, [{ transform: atCenter(0.7), opacity: 0 }, { transform: atCenter(1), opacity: 1 }], { duration: reduce ? 1 : 900, easing: 'cubic-bezier(.2,.9,.25,1.1)' });
  if (!alive(tok)) return;
  boom(gc, gc.querySelector('.tc-holo'));
  gc.classList.add('live');
  cap.className = 'caption';
  cap.innerHTML = `<span class="no gold caps-wide">Study group ${esc(S.group.sg)}</span>
    <span class="nm">All revealed</span>
    <span class="ttl names">${S.group.members.map((m) => `<span style="white-space:nowrap">${esc(m.name)}</span>`).join(' · ')}</span>
    <span class="ds gold">May the Force be with you</span>
    <span class="ct">${done.size} of ${GROUPS.length} groups revealed</span>`;
  placeCaption();
  requestAnimationFrame(() => cap.classList.add('show'));
  S.centered = -1; drawProgress();
  setHint(nextGroup() >= 0 ? 'Space for the groups · Esc any time' : 'Every group is revealed · Space for the groups');
  S.busy = false;
}

// Undo one step.
async function back() {
  if (S.busy || S.view !== 'stage') return;
  if (S.phase === 'finale') {
    const gc = deck.querySelector('.group-card');
    hideCaption(); run(rays, [{ opacity: 0.85 }, { opacity: 0 }], { duration: 400 }); run(halo, [{ opacity: 0.7 }, { opacity: 0 }], { duration: 400 });
    if (gc) await run(gc, [{ opacity: 1 }, { opacity: 0 }], { duration: 400 });
    gc && gc.remove(); S.phase = 'reveal';
    setHint('Space to see the whole group');
    return;
  }
  let k = S.centered;
  if (k >= 0) await settle(k);
  else if (S.revealed > 0) k = S.revealed - 1;
  else return closeGroup();
  const el = S.els[k];
  el.classList.remove('slot-done');
  await run(el.querySelector('.tc-inner'), [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(180deg)' }], { duration: reduce ? 1 : 500, easing: 'ease-in-out' });
  S.revealed = k; drawProgress();
  setHint(`${S.group.members.length - S.revealed} to go · Space to reveal`);
}

async function next() {
  if (S.view === 'picker') { const i = nextGroup(); if (i >= 0) openGroup(i); return; }
  if (S.busy) return;
  if (S.phase === 'finale') return closeGroup();
  const n = S.group.members.length;
  if (S.centered >= 0) { await settle(S.centered); if (S.view !== 'stage') return; }
  if (S.revealed < n) await reveal(S.revealed);
  else await finale();
}

// ---------------------------------------------------------------- caption
function showCaption(k) {
  const m = S.group.members[k];
  cap.className = 'caption';
  cap.innerHTML = `<span class="no gold caps-wide">Warrior No. ${esc(m.no)}</span>
    <span class="nm">${esc(m.name)}</span>
    <span class="ttl">${esc(m.title)}</span>
    ${m.desc ? `<span class="ds">${esc(m.desc)}</span>` : ''}
    <span class="ct">${esc(S.group.sg)} · ${k + 1} of ${S.group.members.length}</span>`;
  placeCaption();
  requestAnimationFrame(() => cap.classList.add('show'));
}
function hideCaption() { cap.classList.remove('show'); cap.innerHTML = ''; }
function placeCaption() {
  const g = S.geo; if (!g) return;
  if (g.portrait) {
    Object.assign(cap.style, { left: '6vw', right: '6vw', width: 'auto', top: `${g.cy + g.cH / 2 + 14}px`, transform: 'none', alignItems: 'center', textAlign: 'center' });
  } else {
    const left = g.cx + g.cW / 2 + g.W * 0.045;
    Object.assign(cap.style, { left: `${left}px`, right: 'auto', width: `${g.W - left - g.W * 0.04}px`, top: `${g.cy}px`, transform: 'translateY(-50%)', alignItems: 'flex-start', textAlign: 'left' });
  }
}

// ---------------------------------------------------------------- tilt + foil follow the pointer
stage.addEventListener('pointermove', (e) => {
  if (S.busy) return;
  const el = S.centered >= 0 ? S.els[S.centered] : deck.querySelector('.group-card.live');
  if (!el) return;
  const r = el.getBoundingClientRect();
  const px = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  const py = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
  el.querySelector('.tc-tilt').style.transform = `rotateX(${((0.5 - py) * 16).toFixed(2)}deg) rotateY(${((px - 0.5) * 22).toFixed(2)}deg)`;
  const face = el.querySelector('.tc-front') || el.querySelector('.tc-face');
  face.style.setProperty('--gx', `${(px * 100).toFixed(1)}%`);
  face.style.setProperty('--gy', `${(py * 100).toFixed(1)}%`);
  face.style.setProperty('--hx', `${(20 + px * 60).toFixed(1)}%`);
  face.style.setProperty('--hy', `${(20 + py * 60).toFixed(1)}%`);
});
stage.addEventListener('pointerleave', () => {
  const el = S.centered >= 0 ? S.els[S.centered] : deck.querySelector('.group-card');
  if (el) el.querySelector('.tc-tilt').style.transform = '';
});

// ---------------------------------------------------------------- input
stage.addEventListener('click', () => { unlockAudio(); next(); });
addEventListener('keydown', (e) => {
  if (e.target.closest && e.target.closest('input, textarea')) return;
  const k = e.key;
  if (k === ' ' || k === 'ArrowRight' || k === 'Enter' || k === 'PageDown') {
    if (S.view === 'picker' && k === 'Enter' && e.target.closest('.sg-tile')) return;   // let the focused tile handle Enter
    e.preventDefault(); unlockAudio(); next();
  } else if (k === 'ArrowLeft' || k === 'PageUp' || k === 'Backspace') { e.preventDefault(); back(); }
  else if (k === 'Escape') { if (S.view === 'stage') closeGroup(); }
  else if (k === 'f' || k === 'F') toggleFs();
  else if (k === 's' || k === 'S') toggleSound();
});
function toggleFs() { unlockAudio(); if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.(); }
function toggleSound() { soundOn = !soundOn; store.set('ja.cards.sound', soundOn ? '1' : '0'); unlockAudio(); if (!soundOn) stopDrumroll(); drawCtl(); }
function drawCtl() { $('#ctl-sound').textContent = `Sound ${soundOn ? 'on' : 'off'}`; }
$('#ctl-sound').addEventListener('click', toggleSound);
$('#ctl-fs').addEventListener('click', toggleFs);
$('#ctl-groups').addEventListener('click', () => { if (S.view === 'stage') closeGroup(); });
let hideT;
addEventListener('pointermove', () => { document.body.classList.add('show-ctl'); clearTimeout(hideT); hideT = setTimeout(() => document.body.classList.remove('show-ctl'), 2500); });

// ---------------------------------------------------------------- sparks
const sc = $('#sparks'), sctx = sc.getContext('2d');
let parts = [], sparking = false;
function sizeCanvas(c) { const d = Math.min(2, devicePixelRatio || 1); c.width = innerWidth * d; c.height = innerHeight * d; c.style.width = innerWidth + 'px'; c.style.height = innerHeight + 'px'; return d; }
function sparks(x, y, count = 150, power = 1) {
  if (reduce) return;
  const d = sizeCanvas(sc);
  const colors = ['#ffffff', '#ffd27a', '#d6ad5c', '#ff4a50', '#c8161d', '#ffe9b0'];
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2, sp = (4 + Math.random() * 16) * power * d;
    parts.push({ x: x * d, y: y * d, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, decay: 0.012 + Math.random() * 0.02, c: colors[i % colors.length], w: (1 + Math.random() * 2.2) * d });
  }
  if (!sparking) { sparking = true; requestAnimationFrame(drawSparks); }
}
function drawSparks() {
  sctx.clearRect(0, 0, sc.width, sc.height);
  sctx.globalCompositeOperation = 'lighter';
  parts = parts.filter((p) => p.life > 0);
  for (const p of parts) {
    const ox = p.x, oy = p.y;
    p.vx *= 0.955; p.vy = p.vy * 0.955 + 0.25; p.x += p.vx; p.y += p.vy; p.life -= p.decay;
    sctx.strokeStyle = p.c; sctx.globalAlpha = Math.max(0, p.life); sctx.lineWidth = p.w; sctx.lineCap = 'round';
    sctx.beginPath(); sctx.moveTo(ox - p.vx * 1.5, oy - p.vy * 1.5); sctx.lineTo(p.x, p.y); sctx.stroke();
  }
  sctx.globalAlpha = 1;
  if (parts.length) requestAnimationFrame(drawSparks); else { sparking = false; sctx.clearRect(0, 0, sc.width, sc.height); }
}

// ---------------------------------------------------------------- starfield
(function stars() {
  const c = $('#stars'), ctx = c.getContext('2d');
  let d = sizeCanvas(c), list = [];
  const make = () => { d = sizeCanvas(c); list = Array.from({ length: Math.round((innerWidth * innerHeight) / 9000) }, () => ({ x: Math.random() * c.width, y: Math.random() * c.height, r: (Math.random() * 1.3 + 0.2) * d, p: Math.random() * 6.28, s: 0.4 + Math.random() * 1.2 })); };
  make(); addEventListener('resize', make);
  let last = 0;
  (function frame(t) {
    if (t - last > 50 || reduce) {
      last = t;
      ctx.clearRect(0, 0, c.width, c.height);
      for (const s of list) {
        const a = reduce ? 0.6 : 0.35 + 0.35 * Math.sin(s.p + t / 1000 * s.s);
        ctx.globalAlpha = a; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.283); ctx.fill();
      }
    }
    if (!reduce) requestAnimationFrame(frame);
  })(0);
})();

// ---------------------------------------------------------------- go
drawCtl();
drawPicker();
window.__cards = { S, next, back, openGroup, closeGroup };
