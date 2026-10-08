// Ember confetti and synthesized sounds (no audio files: drumroll, crash and applause
// are generated in the browser with the Web Audio API).

const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- Confetti ----------
export function confetti({ count = 180, duration = 4200, colors: palette } = {}) {
  if (reduceMotion()) return;
  let canvas = document.getElementById('fx');
  if (!canvas) { canvas = document.createElement('canvas'); canvas.id = 'fx'; document.body.appendChild(canvas); }
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = (canvas.width = innerWidth * dpr), H = (canvas.height = innerHeight * dpr);
  canvas.style.width = innerWidth + 'px'; canvas.style.height = innerHeight + 'px';
  const colors = palette || ['#ffffff', '#fcf1f1', '#1a1a1a', '#efc9cb', '#ffffff'];   // for the red reveal screen
  const parts = Array.from({ length: count }, (_, i) => {
    const fromLeft = i % 2 === 0;
    return {
      x: fromLeft ? -20 * dpr : W + 20 * dpr,
      y: H * (0.55 + Math.random() * 0.4),
      vx: (fromLeft ? 1 : -1) * (6 + Math.random() * 11) * dpr,
      vy: -(12 + Math.random() * 14) * dpr,
      w: (6 + Math.random() * 7) * dpr, h: (9 + Math.random() * 12) * dpr,
      r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.35,
      c: colors[i % colors.length], round: Math.random() < 0.3,
    };
  });
  const start = performance.now();
  (function frame(t) {
    const k = (t - start) / duration;
    ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.vy += 0.42 * dpr; p.vx *= 0.985; p.vy *= 0.99;
      p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save(); ctx.globalAlpha = Math.max(0, 1 - Math.max(0, k - 0.6) / 0.4);
      ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c;
      if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2); ctx.fill(); }
      else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r)));
      ctx.restore();
    }
    if (k < 1) requestAnimationFrame(frame); else ctx.clearRect(0, 0, W, H);
  })(start);
}

// ---------- Sound ----------
let ac = null, master = null, noise = null, rollTimer = null, rollGain = null;
function ensure() {
  if (!ac) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ac = new AC();
    master = ac.createGain(); master.gain.value = 0.9; master.connect(ac.destination);
    noise = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ac.state === 'suspended') ac.resume();
  return ac;
}
// Call from a click so browsers allow audio later.
export function unlockAudio() { ensure(); }
export const audioReady = () => Boolean(ac && ac.state === 'running');

function hit(time, { freq = 2400, q = 0.8, gain = 0.5, decay = 0.07, dest } = {}) {
  const src = ac.createBufferSource(); src.buffer = noise; src.playbackRate.value = 0.9 + Math.random() * 0.2;
  const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = q;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, time);
  g.gain.exponentialRampToValueAtTime(gain, time + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, time + decay);
  src.connect(bp); bp.connect(g); g.connect(dest || master);
  src.start(time, Math.random() * 1.5); src.stop(time + decay + 0.05);
}

// Snare roll that builds until stopped (or maxSeconds).
export function drumroll({ maxSeconds = 12 } = {}) {
  if (!ensure()) return;
  stopDrumroll();
  rollGain = ac.createGain(); rollGain.gain.value = 0.25; rollGain.connect(master);
  const t0 = ac.currentTime + 0.05;
  rollGain.gain.setValueAtTime(0.25, t0);
  rollGain.gain.linearRampToValueAtTime(1, t0 + Math.min(6, maxSeconds));
  let next = t0;
  const end = t0 + maxSeconds;
  const pump = () => {
    if (!ac) return;
    while (next < ac.currentTime + 0.25 && next < end) {
      const rate = 17 + Math.random() * 3;
      hit(next, { freq: 1800 + Math.random() * 900, q: 0.7, gain: 0.35 + Math.random() * 0.12, decay: 0.06, dest: rollGain });
      // low body of the drum
      const o = ac.createOscillator(), g = ac.createGain();
      o.frequency.value = 180; g.gain.setValueAtTime(0.0001, next); g.gain.exponentialRampToValueAtTime(0.08, next + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, next + 0.05);
      o.connect(g); g.connect(rollGain); o.start(next); o.stop(next + 0.06);
      next += 1 / rate;
    }
    if (next >= end) stopDrumroll();
  };
  pump();
  rollTimer = setInterval(pump, 60);
}
export function stopDrumroll() {
  if (rollTimer) { clearInterval(rollTimer); rollTimer = null; }
  if (rollGain && ac) {
    const g = rollGain; const t = ac.currentTime;
    g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(0.0001, t + 0.08);
    setTimeout(() => g.disconnect(), 300);
    rollGain = null;
  }
}

// Cymbal crash + boom, then applause that swells and fades.
export function fanfare({ applauseSeconds = 6 } = {}) {
  if (!ensure()) return;
  stopDrumroll();
  const t = ac.currentTime + 0.02;
  // crash
  const src = ac.createBufferSource(); src.buffer = noise;
  const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 5000;
  const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.6, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
  src.connect(hp); hp.connect(g); g.connect(master); src.start(t); src.stop(t + 2.3);
  // boom
  const o = ac.createOscillator(), og = ac.createGain();
  o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.5);
  og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.7, t + 0.01); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
  o.connect(og); og.connect(master); o.start(t); o.stop(t + 1);
  applause({ seconds: applauseSeconds, delay: 0.15 });
}

export function applause({ seconds = 6, delay = 0 } = {}) {
  if (!ensure()) return;
  const t0 = ac.currentTime + delay;
  const claps = Math.round(seconds * 55);
  for (let i = 0; i < claps; i++) {
    const u = Math.random();
    const at = t0 + seconds * Math.pow(u, 1.15);
    const env = Math.sin(Math.PI * Math.min(1, (at - t0) / seconds)) ** 0.6;   // swell then fade
    hit(at, { freq: 900 + Math.random() * 1800, q: 1.1, gain: 0.05 + env * 0.22 * Math.random(), decay: 0.03 + Math.random() * 0.03 });
  }
}

// ---------- Card reveal sounds ----------
// A rising swell while the card charges up.
export function riser(seconds = 1.2) {
  if (!ensure()) return;
  const t = ac.currentTime + 0.02;
  const src = ac.createBufferSource(); src.buffer = noise; src.loop = true;
  const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 2.5;
  bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(4200, t + seconds);
  const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + seconds);
  g.gain.exponentialRampToValueAtTime(0.0001, t + seconds + 0.08);
  const o = ac.createOscillator(); o.type = 'sawtooth';
  o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(260, t + seconds);
  const og = ac.createGain(); og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.07, t + seconds); og.gain.exponentialRampToValueAtTime(0.0001, t + seconds + 0.08);
  src.connect(bp); bp.connect(g); g.connect(master); o.connect(og); og.connect(master);
  src.start(t); src.stop(t + seconds + 0.1); o.start(t); o.stop(t + seconds + 0.1);
}

// The swish of the card spinning.
export function whoosh(seconds = 1.1) {
  if (!ensure()) return;
  const t = ac.currentTime + 0.01;
  const src = ac.createBufferSource(); src.buffer = noise;
  const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
  bp.frequency.setValueAtTime(2500, t); bp.frequency.exponentialRampToValueAtTime(400, t + seconds);
  const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + seconds * 0.3);
  g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
  src.connect(bp); bp.connect(g); g.connect(master); src.start(t, 0.3); src.stop(t + seconds + 0.05);
}

// Impact when the face lands: boom, crack and a shimmer of bells.
export function impact() {
  if (!ensure()) return;
  const t = ac.currentTime + 0.01;
  const o = ac.createOscillator(), og = ac.createGain();
  o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.6);
  og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.9, t + 0.01); og.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
  o.connect(og); og.connect(master); o.start(t); o.stop(t + 1.2);
  hit(t, { freq: 3000, q: 0.5, gain: 0.6, decay: 0.25 });
  const notes = [1318.5, 1568, 1975.5, 2349.3, 2637, 3136];
  notes.forEach((f, i) => {
    const at = t + 0.05 + i * 0.055;
    const s = ac.createOscillator(), sg = ac.createGain();
    s.type = 'sine'; s.frequency.value = f;
    sg.gain.setValueAtTime(0.0001, at); sg.gain.exponentialRampToValueAtTime(0.12, at + 0.01); sg.gain.exponentialRampToValueAtTime(0.0001, at + 1.2);
    s.connect(sg); sg.connect(master); s.start(at); s.stop(at + 1.3);
  });
}
