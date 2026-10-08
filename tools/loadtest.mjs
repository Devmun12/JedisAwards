// Rehearsal load test: 80 phones watching + every Section J name voting at once.
//
// It RESETS the event (votes, winners and phone sign-ins) before and after, so run it
// only during setup, never on the night.
//
//   JA_URL=https://xxxx.supabase.co JA_KEY=<publishable key> JA_ADMIN=<admin password> \
//   node tools/loadtest.mjs --i-understand-this-resets-the-event
//
// Needs Node 18 or newer. No packages to install.

const URL_ = process.env.JA_URL, KEY = process.env.JA_KEY, PASS = process.env.JA_ADMIN;
if (!URL_ || !KEY || !PASS || !process.argv.includes('--i-understand-this-resets-the-event')) {
  console.log('Usage: JA_URL=... JA_KEY=... JA_ADMIN=... node tools/loadtest.mjs --i-understand-this-resets-the-event');
  process.exit(1);
}
const WATCHERS = Number(process.env.JA_WATCHERS || 80);
const POLL_MS = Number(process.env.JA_POLL_MS || 2500);   // phones fall back to this if live updates are blocked
const stats = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rpc(fn, args = {}) {
  const t0 = performance.now();
  const r = await fetch(`${URL_.replace(/\/$/, '')}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const ms = performance.now() - t0;
  const s = (stats[fn] ||= { n: 0, err: 0, ms: [] });
  s.n++; s.ms.push(ms);
  const j = await r.json().catch(() => null);
  if (!r.ok) { s.err++; const e = new Error((j && j.message) || `HTTP ${r.status}`); e.status = r.status; throw e; }
  return j;
}
const admin = (fn, args = {}) => rpc('ja_admin_' + fn, { p_pass: PASS, ...args });
const tok = (i) => `loadtest-${Date.now().toString(36)}-${String(i).padStart(4, '0')}-xxxxxxxx`;
const pct = (a, p) => { const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * b.length))] || 0; };

console.log('Resetting event and signing every phone out…');
let s = await admin('reset_event', { p_confirm: 'RESET', p_clear_claims: true });
const award = s.awards.find((a) => a.status === 'queued');
if (!award) { console.log('No queued award to test with.'); process.exit(1); }
const people = await rpc('ja_participants');
const tokens = people.map((_, i) => tok(i));
await Promise.all(people.map((p, i) => rpc('ja_claim', { p_participant_id: p.id, p_token: tokens[i] })));
console.log(`${people.length} names claimed. Starting ${WATCHERS} watchers (every ${POLL_MS} ms)…`);

let stop = false;
const watchers = Array.from({ length: WATCHERS }, (_, i) => (async () => {
  await sleep(Math.random() * POLL_MS);
  while (!stop) {
    try { await rpc('ja_get_state', { p_token: tokens[i % tokens.length] }); } catch { /* counted */ }
    await sleep(POLL_MS);
  }
})());

console.log(`Opening “${award.title}” (${award.duration_s} s)…`);
s = await admin('open', { p_award_id: award.id });
const st = await rpc('ja_get_state', { p_token: tokens[0] });
const nominees = st.nominees.map((n) => n.id);
const voted = new Set();
const window_ = Math.max(5, award.duration_s - 8) * 1000;
await Promise.all(people.map((p, i) => (async () => {
  const picks = 1 + Math.floor(Math.random() * 3);              // some people change their mind
  for (let k = 0; k < picks; k++) {
    await sleep(Math.random() * window_ / picks);
    try {
      await rpc('ja_cast_vote', { p_token: tokens[i], p_award_id: award.id, p_nominee_id: nominees[Math.floor(Math.random() * Math.min(12, nominees.length))] });
      voted.add(i);
    } catch (e) { console.log('vote failed:', e.message); }
  }
})()));
const left = st.ends_at - st.server_now - window_;
if (left > 0) await sleep(left + 500);

s = await admin('close');
s = await admin('reveal_top3');
s = await admin('reveal_winner');
const result = s.awards.find((a) => a.id === award.id).result;
stop = true; await Promise.all(watchers);

console.log(`\nVoters who voted: ${voted.size}. Votes counted: ${result.total}. Winner(s): ${result.winners.map((w) => w.name).join(' & ')} with ${result.votes}.`);
console.log(result.total === voted.size ? 'OK: every voter counted exactly once.' : 'MISMATCH: check the logs above.');
console.log('\nCall                     calls  errors   p50 ms   p95 ms   max ms');
for (const [fn, v] of Object.entries(stats)) {
  console.log(`${fn.padEnd(24)} ${String(v.n).padStart(5)}  ${String(v.err).padStart(6)}  ${pct(v.ms, 0.5).toFixed(0).padStart(7)}  ${pct(v.ms, 0.95).toFixed(0).padStart(7)}  ${Math.max(...v.ms).toFixed(0).padStart(7)}`);
}

console.log('\nCleaning up: resetting the event and signing the test phones out…');
await admin('reset_event', { p_confirm: 'RESET', p_clear_claims: true });
console.log('Done. The event is back to a clean start.');
