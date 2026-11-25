// Event Pal sports graphics: shared code for the setup page, scorer pad and screens.
// The scorer pad owns the rules (football, netball, cricket) and publishes the whole match state.
(function () {
  const BASE = (window.SPORTS_CFG && window.SPORTS_CFG.base) || 'https://ogklumjigwdhlcfbllsv.supabase.co';
  const FN = BASE + '/functions/v1/sports';
  const PUB = BASE + '/storage/v1/object/public/sports/m/';

  // ---------- server time ----------
  let offset = 0, synced = false;
  async function syncTime() {
    for (let i = 0; i < 3; i++) {
      try {
        const t0 = Date.now();
        const r = await fetch(FN, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ a: 'time' }) });
        const j = await r.json(); const t1 = Date.now();
        if (j && j.now) { offset = j.now - (t0 + t1) / 2; synced = true; return; }
      } catch (e) { await new Promise(r => setTimeout(r, 800)); }
    }
  }
  const now = () => Date.now() + offset;

  async function api(body) {
    const r = await fetch(FN, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    let j = {}; try { j = await r.json(); } catch (e) { }
    if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
    return j;
  }
  async function fetchMatch(code) {
    const r = await fetch(PUB + encodeURIComponent(code) + '.json?t=' + Math.floor(Date.now() / 1000), { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  // ---------- small helpers ----------
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function ink(hex) { // readable text colour on a team colour
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return '#fff';
    const n = parseInt(m[1], 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) > 160 ? '#111' : '#fff';
  }
  const pad2 = n => String(n).padStart(2, '0');
  const mmss = ms => { ms = Math.max(0, ms); const s = Math.floor(ms / 1000); return pad2(Math.floor(s / 60)) + ':' + pad2(s % 60); };
  const uid = () => Math.random().toString(36).slice(2, 9);
  const other = s => s === 'home' ? 'away' : 'home';
  function parseRoster(txt) {
    return String(txt || '').split(/\n/).map(l => l.trim()).filter(Boolean).slice(0, 30).map(l => {
      const m = /^#?(\d{1,3})[\s.\-)]+(.+)$/.exec(l);
      return m ? { no: m[1], name: m[2].trim().slice(0, 40) } : { no: '', name: l.slice(0, 40) };
    });
  }
  const pname = p => p ? (p.no ? p.no + ' ' : '') + p.name : '';

  // ---------- clocks (count up from base, elapsed in ms) ----------
  function elapsed(c) { if (!c) return 0; return (c.base || 0) + (c.run ? Math.max(0, now() - c.at) : 0); }
  function startClock(c) { if (!c.run) { c.run = true; c.at = now(); } }
  function stopClock(c) { if (c.run) { c.base = elapsed(c); c.run = false; } }
  function resetClock(c) { c.run = false; c.base = 0; c.at = 0; }

  // ---------- football ----------
  const FB_PERIODS = ['pre', '1H', 'HT', '2H', 'FT', 'ET1', 'ETB', 'ET2', 'AET', 'PEN', 'END'];
  const FB_LABEL = { pre: 'Kick-off soon', '1H': '1st half', HT: 'Half-time', '2H': '2nd half', FT: 'Full-time', ET1: 'Extra time 1', ETB: 'ET break', ET2: 'Extra time 2', AET: 'After extra time', PEN: 'Penalties', END: 'Full-time' };
  function fbStart(p, half) { return p === '2H' ? half : p === 'ET1' ? half * 2 : p === 'ET2' ? half * 2 + 15 : 0; }
  function fbLen(p, half) { return (p === 'ET1' || p === 'ET2') ? 15 : half; }
  function fbClock(fb) { // {text, over, minute}
    const p = fb.period, live = ['1H', '2H', 'ET1', 'ET2'].includes(p);
    if (!live) return { text: p === 'pre' ? '00:00' : (p === 'HT' ? 'HT' : p === 'PEN' ? 'PENS' : p === 'ETB' ? 'ET' : 'FT'), over: '', minute: '', live: false };
    const st = fbStart(p, fb.half) * 60000, len = fbLen(p, fb.half) * 60000, e = elapsed(fb.clock);
    if (e <= len) return { text: mmss(st + e), over: '', minute: String(Math.floor((st + e) / 60000) + 1), live: true };
    const o = e - len;
    return { text: mmss(st + len), over: '+' + mmss(o), minute: (st + len) / 60000 + '+' + (Math.floor(o / 60000) + 1), live: true };
  }
  function fbNew() { return { h: 0, a: 0, period: 'pre', half: 45, added: 0, clock: { run: false, base: 0, at: 0 }, events: [], pens: { home: [], away: [] } }; }

  // ---------- netball ----------
  function nbNew(qlen) { return { h: 0, a: 0, q: 0, qlen: qlen || 15, clock: { run: false, base: 0, at: 0 }, cp: 'home', cpFirst: 'home', qs: [], shots: { home: { GS: { g: 0, a: 0 }, GA: { g: 0, a: 0 } }, away: { GS: { g: 0, a: 0 }, GA: { g: 0, a: 0 } } }, done: false }; }
  function nbClock(nb) {
    if (nb.done) return { text: 'FT', label: 'Full-time' };
    if (!nb.q) return { text: mmss(nb.qlen * 60000), label: 'Starts soon' };
    const rem = nb.qlen * 60000 - elapsed(nb.clock);
    return { text: mmss(Math.max(0, rem)), label: 'Q' + nb.q, ended: rem <= 0 };
  }

  // ---------- cricket ----------
  const CK_FMT = { t20: 'T20', odi: 'One Day International', test: 'Test match', custom: 'Limited overs' };
  // fmt: 't20' | 'odi' | 'test' | 'custom'. Test: 2 innings a side, no over limit, no free hits.
  function ckNew(fmt, overs, ppl, batFirst, days) {
    fmt = CK_FMT[fmt] ? fmt : 'custom';
    const lim = fmt !== 'test', ov = fmt === 't20' ? 20 : fmt === 'odi' ? 50 : fmt === 'test' ? null : (overs || 20);
    return { fmt, overs: ov, ppl: ppl || 11, inns: [], cur: -1, batFirst: batFirst || 'home', result: null, freeHit: false, brk: false,
      maxInns: lim ? 2 : 4, freeHitOn: lim, maxBowl: lim ? Math.ceil(ov / 5) : null, day: 1, days: lim ? 1 : (days || 5) };
  }
  const runsOf = (ck, t) => ck.inns.filter(x => x.bat === t).reduce((a, x) => a + x.runs, 0);
  function ckLead(ck) { const I = ck.inns[ck.cur]; if (!I || ck.fmt !== 'test') return null; return runsOf(ck, I.bat) - runsOf(ck, other(I.bat)); }
  function ckFollowOn(ck) { // runs needed for the follow-on, by match length
    return ck.days >= 5 ? 200 : ck.days >= 3 ? 150 : ck.days === 2 ? 100 : 75;
  }
  function ckPP(ck, I) {
    if (!I || ck.fmt === 'test' || ck.fmt === 'custom') return '';
    if (ck.fmt === 't20') return I.balls < 36 ? 'Powerplay' : '';
    return I.balls < 60 ? 'Powerplay 1' : I.balls < 240 ? 'Powerplay 2' : 'Powerplay 3';
  }
  function ckNextBat(ck, followOn) { // who bats in the next innings
    const n = ck.inns.length;
    if (n === 0) return ck.batFirst;
    if (n === 1) return other(ck.inns[0].bat);
    if (n === 2) return followOn ? ck.inns[1].bat : ck.inns[0].bat;
    return other(ck.inns[2].bat);
  }
  function newBatter(name) { return { name: name || 'Batter', r: 0, b: 0, f: 0, s: 0, out: null }; }
  function newBowler(name) { return { name: name || 'Bowler', balls: 0, r: 0, w: 0, m: 0, ov: 0 }; }
  function ckInnings(ck, bat, openers, bowler) {
    const I = { bat, runs: 0, wk: 0, balls: 0, ex: { w: 0, nb: 0, b: 0, lb: 0 }, bt: [newBatter(openers[0]), newBatter(openers[1])], str: 0, non: 1, bw: [newBowler(bowler)], cbw: 0, over: [], overRuns: 0, fow: [], ps: { r: 0, b: 0 }, done: false, target: null, dec: false, fo: false };
    if (ck.inns.length === 2 && ck.fmt === 'test' && bat === ck.inns[1].bat) I.fo = true;
    if (ck.inns.length === (ck.maxInns || 2) - 1) I.target = runsOf(ck, other(bat)) - runsOf(ck, bat) + 1;
    ck.inns.push(I); ck.cur = ck.inns.length - 1; ck.freeHit = false; ck.brk = false;
    return I;
  }
  const ov = balls => Math.floor(balls / 6) + '.' + (balls % 6);
  const ovShort = balls => balls % 6 ? ov(balls) : String(balls / 6);
  function crr(I) { return I.balls ? (I.runs * 6 / I.balls).toFixed(2) : '0.00'; }
  function need(ck, I) {
    if (!I || I.target == null) return null;
    const runs = I.target - I.runs;
    if (!ck.overs) return { runs, balls: null, rrr: null };
    const balls = ck.overs * 6 - I.balls;
    return { runs, balls, rrr: balls > 0 ? (runs * 6 / balls).toFixed(2) : '-' };
  }
  // returns list of popups/events produced by the ball
  // kind: 'run' (runs off bat), 'wd' (wide; runs = extra runs ran, 4 = boundary), 'nb' (runs off bat), 'b', 'lb'
  // wk: {how, who:'str'|'non', fielder, runs} optional
  function ckBall(ck, kind, runs, wk) {
    const I = ck.inns[ck.cur]; if (!I || I.done) return { pops: [], overDone: false, needBatter: false };
    const out = [], S = I.bt[I.str], B = I.bw[I.cbw];
    const legal = !(kind === 'wd' || kind === 'nb');
    let total = 0, ran = 0, label = '';
    const fhBefore = ck.freeHit;
    if (kind === 'run') {
      total = runs; S.r += runs; S.b++; if (runs === 4) S.f++; if (runs === 6) S.s++;
      B.r += runs; ran = (runs === 4 || runs === 6) ? 0 : runs; label = String(runs || '•');
      if (runs === 4) out.push({ kind: 'four', title: 'FOUR', sub: S.name });
      if (runs === 6) out.push({ kind: 'six', title: 'SIX', sub: S.name });
      const before = S.r - runs;
      for (const ms of [50, 100, 150, 200]) if (before < ms && S.r >= ms) out.push({ kind: 'mile', title: ms === 50 ? 'FIFTY' : ms === 100 ? 'HUNDRED' : ms + ' UP', sub: S.name + ' ' + S.r + ' (' + S.b + ')' });
    } else if (kind === 'wd') {
      total = 1 + runs; I.ex.w += total; B.r += total; ran = runs === 4 ? 0 : runs; label = runs ? (runs + 1) + 'wd' : 'wd';
    } else if (kind === 'nb') {
      total = 1 + runs; I.ex.nb += 1; S.r += runs; S.b++; if (runs === 4) S.f++; if (runs === 6) S.s++; B.r += total;
      ran = (runs === 4 || runs === 6) ? 0 : runs; label = runs ? 'nb+' + runs : 'nb';
    } else if (kind === 'b' || kind === 'lb') {
      total = runs; I.ex[kind] += runs; S.b++; ran = runs === 4 ? 0 : runs; label = runs + kind;
    }
    I.runs += total; I.ps.r += total; if (legal) I.ps.b++;
    if (legal) { I.balls++; B.balls++; }
    I.overRuns += (kind === 'b' || kind === 'lb') ? 0 : total;
    // wicket
    if (wk) {
      const credit = !['run out', 'retired', 'obstructing'].includes(wk.how);
      const outIdx = wk.who === 'non' ? I.non : I.str;
      const O = I.bt[outIdx];
      // on a free hit only a run out counts
      if (!(fhBefore && wk.how !== 'run out')) {
        O.out = wk.how === 'bowled' ? 'b ' + B.name : wk.how === 'caught' ? (wk.fielder ? 'c ' + wk.fielder + ' ' : 'c ') + 'b ' + B.name
          : wk.how === 'caught & bowled' ? 'c & b ' + B.name : wk.how === 'lbw' ? 'lbw b ' + B.name : wk.how === 'stumped' ? 'st ' + (wk.fielder || '') + ' b ' + B.name
            : wk.how === 'hit wicket' ? 'hit wicket b ' + B.name : wk.how === 'run out' ? 'run out' + (wk.fielder ? ' (' + wk.fielder + ')' : '') : wk.how;
        I.wk++; if (credit) B.w++;
        I.fow.push({ wk: I.wk, runs: I.runs, name: O.name, ov: ov(I.balls) });
        label = (label && label !== '•' ? label + ' ' : '') + 'W';
        out.push({ kind: 'wicket', title: 'WICKET', sub: O.name + ' ' + O.r + ' (' + O.b + ')', note: O.out });
        I.ps = { r: 0, b: 0 };
        O._needReplace = true;
        if (wk.how === 'caught' || wk.how === 'caught & bowled') I._caught = true;
      }
    }
    I.over.push({ t: label || '•', fh: fhBefore });
    ck.freeHit = kind === 'nb' && ck.freeHitOn !== false;
    if (ck.freeHit) out.push({ kind: 'fh', title: 'FREE HIT', sub: '' });
    // strike rotation for runs ran
    if (ran % 2 === 1) { const t = I.str; I.str = I.non; I.non = t; }
    // end of over
    let overDone = false;
    if (legal && I.balls % 6 === 0) {
      overDone = true;
      if (I.overRuns === 0) B.m++;
      B.ov++; I.over = []; I.overRuns = 0;
      const t = I.str; I.str = I.non; I.non = t;
    }
    ckCheckEnd(ck, I, out);
    return { pops: out, overDone, needBatter: I.bt.some(b => b._needReplace) && !I.done };
  }
  function ckReplace(ck, name) {
    const I = ck.inns[ck.cur]; const idx = I.bt.findIndex(b => b._needReplace); if (idx < 0) return;
    delete I.bt[idx]._needReplace;
    I.bt.push(newBatter(name));
    const ni = I.bt.length - 1;
    // caught: new batter takes strike unless the over just ended (laws since 2022)
    if (I.str === idx) I.str = ni; else if (I.non === idx) I.non = ni;
    if (I._caught && I.balls % 6 !== 0 && I.non === ni) { I.non = I.str; I.str = ni; }
    delete I._caught;
  }
  function ckBowler(ck, name) {
    const I = ck.inns[ck.cur]; let i = I.bw.findIndex(b => b.name.toLowerCase() === String(name).toLowerCase());
    if (i < 0) { I.bw.push(newBowler(name)); i = I.bw.length - 1; }
    I.cbw = i;
  }
  function ckCheckEnd(ck, I, out) {
    const allOut = I.wk >= ck.ppl - 1, oversDone = !!ck.overs && I.balls >= ck.overs * 6, chased = I.target != null && I.runs >= I.target;
    if (!(allOut || oversDone || chased || I.dec)) return;
    ckFinish(ck, I, out);
  }
  function ckFinish(ck, I, out) {
    I.done = true; I.bt.forEach(b => delete b._needReplace);
    const n = ck.cur + 1;
    if (I.target != null) { ck.result = ckResult(ck); out.push({ kind: 'result', title: ck.result.text, sub: '' }); return; }
    if (ck.fmt === 'test' && n === 3 && runsOf(ck, I.bat) < runsOf(ck, other(I.bat))) {
      const m = runsOf(ck, other(I.bat)) - runsOf(ck, I.bat);
      ck.result = { winner: other(I.bat), text: '{' + other(I.bat) + '} won by an innings and ' + m + ' run' + (m === 1 ? '' : 's') };
      out.push({ kind: 'result', title: ck.result.text, sub: '' }); return;
    }
    ck.brk = true;
    out.push({ kind: 'inns', title: I.dec ? 'DECLARED' : 'END OF INNINGS', sub: I.runs + '/' + I.wk + (I.dec ? ' dec' : '') + ' (' + ovShort(I.balls) + ' ov)' });
  }
  function ckResult(ck) {
    const I = ck.inns[ck.cur], tgt = I.target;
    if (I.runs >= tgt) return { winner: I.bat, text: '{' + I.bat + '} won by ' + (ck.ppl - 1 - I.wk) + ' wicket' + (ck.ppl - 1 - I.wk === 1 ? '' : 's') };
    if (I.runs === tgt - 1) return { winner: null, text: 'Match tied' };
    const m = tgt - 1 - I.runs; return { winner: other(I.bat), text: '{' + other(I.bat) + '} won by ' + m + ' run' + (m === 1 ? '' : 's') };
  }

  function ckDeclare(ck) { const I = ck.inns[ck.cur]; if (!I || I.done) return []; I.dec = true; const out = []; ckCheckEnd(ck, I, out); return out; }
  function ckEnd(ck) { const I = ck.inns[ck.cur]; const out = []; if (I && !I.done) ckFinish(ck, I, out); return out; }
  function ckDraw(ck) { const I = ck.inns[ck.cur]; if (I) I.done = true; ck.brk = false; ck.result = { winner: null, text: 'Match drawn' }; }
  const ckInnsTxt = (ck, x) => x.runs + (x.wk >= ck.ppl - 1 ? '' : '/' + x.wk) + (x.dec ? ' dec' : '');
  window.SP = { FN, PUB, syncTime, now, api, fetchMatch, esc, ink, mmss, pad2, uid, other, parseRoster, pname, elapsed, startClock, stopClock, resetClock,
    FB_PERIODS, FB_LABEL, fbClock, fbNew, fbStart, fbLen, nbNew, nbClock, ckNew, ckInnings, ckBall, ckReplace, ckBowler, ckResult, ckDeclare, ckDraw, ckEnd, ckLead, ckFollowOn, ckPP, ckNextBat, ckInnsTxt, runsOf, CK_FMT, crr, need, ov, ovShort, isSynced: () => synced };
})();
