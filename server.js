/* Fokionas Arena — live server (WebSocket). Start with: node server.js */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('./mini-ws.js');
const SH = require('./shared.js');

let CFG = {};
try { CFG = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')); } catch (e) {}
const PORT = process.env.PORT || CFG.port || 3000;
const USERS_FILE = process.env.USERS_FILE || CFG.usersFile || '';
// When the live server runs on another host (e.g. Render), it checks accounts through the site's api.php.
const API_URL = process.env.API_URL || CFG.apiUrl || 'https://www.fokionas.gr/game/api.php';
const TICK = 1 / 20;            // 20 updates per second
const FILL_WAIT = 20000;        // after 20 s of waiting, empty seats get bots
const VOTE_TIME = 7000;

/* ---------- accounts (reads the file written by api.php) ---------- */
async function readUser(nick, token) {
  if (!USERS_FILE) {
    if (!API_URL) return { ok: true, nick: String(nick || 'Player').slice(0, 16), state: null };
    try {
      const r = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 FokionasLive/1.0' }, body: JSON.stringify({ action: 'load', nick, token }), signal: AbortSignal.timeout(8000) });
      const j = await r.json();
      if (r.status === 401) return { ok: false };
      if (!r.ok || j.error) throw new Error(j.error || 'HTTP ' + r.status);
      return { ok: true, nick: j.nick, state: j.state || null };
    } catch (e) {
      console.error('Could not reach api.php:', e.message);
      return { ok: false, err: 'The live server cannot reach the game site to check your account. Try again in a moment.' };
    }
  }
  try {
    const raw = fs.readFileSync(USERS_FILE, 'utf8');
    const db = JSON.parse(raw.slice(raw.indexOf('\n') + 1));
    const u = Object.values(db).find(x => x && x.nick === nick);
    if (!u || u.token !== token) return { ok: false };
    return { ok: true, nick: u.nick, state: u.state || null };
  } catch (e) {
    console.error('Could not read the accounts file:', e.message);
    return { ok: false, err: 'The live server cannot find the accounts. Check usersFile in config.json.' };
  }
}

/* ---------- connections ---------- */
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(`Fokionas Arena live server: OK\nConnected: ${clients.size} · Battles: ${rooms.size}\n`);
});
const wss = new WebSocketServer({ server, maxPayload: 4096 });
const clients = new Set();
const queues = { 1: [], 2: [], 3: [] };
const rooms = new Set();
let nextId = 1;

const send = (c, m) => { if (c.ws.readyState === 1) c.ws.send(JSON.stringify(m)); };

wss.on('connection', ws => {
  const c = { ws, id: nextId++, nick: null, state: 'new', room: null, alive: true, lastPos: 0, wins: 0 };
  clients.add(c);
  ws.on('pong', () => { c.alive = true; });
  ws.on('message', data => {
    let m; try { m = JSON.parse(data); } catch (e) { return; }
    Promise.resolve().then(() => onMessage(c, m)).catch(e => console.error(e));
  });
  ws.on('close', () => { clients.delete(c); leave(c); });
});
setInterval(() => { for (const c of clients) { if (!c.alive) { c.ws.terminate(); continue; } c.alive = false; try { c.ws.ping(); } catch (e) {} } }, 30000);

async function onMessage(c, m) {
  if (m.t === 'hello') {
    if (c.checking) return; c.checking = true;
    const u = await readUser(m.nick, m.token); c.checking = false;
    if (!u.ok) { send(c, { t: 'error', msg: u.err || 'Your session expired. Log out and log in again.' }); return c.ws.close(); }
    c.nick = u.nick; c.token = m.token; c.ustate = u.state; c.pro = !!(u.state && u.state.pro); c.state = 'idle';
    return send(c, { t: 'welcome', nick: c.nick, online: clients.size });
  }
  if (!c.nick) return;
  if (m.t === 'queue' && c.state === 'idle') {
    const mode = [1, 2, 3].includes(m.mode) ? m.mode : 1;
    let bid = +m.bid || 0, lvl = Math.max(1, Math.min(30, +m.lvl || 1)), wins = Math.max(0, +m.wins || 0);
    if (USERS_FILE || API_URL) { c.state = 'checking'; const u = await readUser(c.nick, c.token); c.state = 'idle'; if (u.ok) c.ustate = u.state || {}; }
    if (!clients.has(c) || c.state !== 'idle') return;
    if (c.ustate) { // trust the saved progress, not the browser
      const st = c.ustate, owned = st.all || (st.owned && st.owned[bid]) || bid < 3;
      if (!owned || !SH.ROSTER[bid]) bid = 0;
      lvl = Math.max(1, Math.min(30, (st.lvl && st.lvl[bid]) || 1));
      wins = st.wins || 0; c.pro = !!st.pro;
    }
    Object.assign(c, { mode, bid, lvl, wins, state: 'queue', joinedAt: Date.now() });
    queues[mode].push(c);
    return queueStatus();
  }
  if (m.t === 'leave') return leave(c);
  const r = c.room; if (!r) return;
  if (m.t === 'vote' && r.phase === 'vote' && SH.MAP_NAMES[m.map]) {
    r.votes.set(c.id, m.map);
    broadcast(r, { t: 'votes', votes: voteList(r) });
    if (r.votes.size === r.humans.length) endVote(r);
    return;
  }
  if (r.phase !== 'play') return;
  const G = r.G, e = G.ents.find(x => x.pid === c.id); if (!e) return;
  if (m.t === 'pos') {
    if (!e.alive || G.start > 0 || !isFinite(m.x) || !isFinite(m.y) || (G.bomb && G.bomb.ph === 'buy') || (G.soc && G.soc.pause > 0)) return;
    const now = Date.now(), el = Math.min(.5, (now - (c.lastPos || now)) / 1000); c.lastPos = now;
    const allow = SH.speedOf(e) * el * 1.5 + 8 + (G.push.length ? 20 : 0), dx = m.x - e.x, dy = m.y - e.y, d = Math.hypot(dx, dy);
    const ox = e.x, oy = e.y;
    if (d > allow) { e.x += dx / d * allow; e.y += dy / d * allow; } else { e.x = m.x; e.y = m.y; }
    SH.resolve(G, e);
    if (d > allow + 30) send(c, { t: 'snap', x: e.x, y: e.y });
    e._vx = (e.x - ox) / Math.max(.03, el); e._vy = (e.y - oy) / Math.max(.03, el);
    if (isFinite(m.a)) e.ang = m.a;
  } else if (m.t === 'fire' && isFinite(m.a)) SH.attack(G, e, m.a, isFinite(m.d) ? m.d : null);
  else if (m.t === 'super') SH.useSuper(G, e, isFinite(m.a) ? m.a : e.ang, isFinite(m.d) ? m.d : null);
  else if (m.t === 'buy' && G.bomb) SH.buy(G, e, String(m.item));
  else if (m.t === 'act' && G.bomb) e.act = !!m.on;
  else if (m.t === 'nade' && G.bomb && isFinite(m.a)) SH.throwNade(G, e, m.a, isFinite(m.d) ? m.d : 320);
}

function leave(c) {
  if (c.state === 'queue') { const q = queues[c.mode]; const i = q.indexOf(c); if (i >= 0) q.splice(i, 1); queueStatus(); }
  const r = c.room;
  if (r) {
    r.humans = r.humans.filter(h => h !== c);
    r.votes && r.votes.delete(c.id);
    if (r.G) { const e = r.G.ents.find(x => x.pid === c.id); if (e) { e.pid = null; e.ctrl = 'ai'; e.skill = .5; e.name += ' (bot)'; } }
    if (!r.humans.length) { clearTimeout(r.voteTimer); rooms.delete(r); }
    else if (r.phase === 'vote') { broadcast(r, { t: 'votes', votes: voteList(r) }); if (r.votes.size === r.humans.length) endVote(r); }
  }
  c.room = null; c.state = c.nick ? 'idle' : 'new';
}

/* ---------- matchmaking ---------- */
function queueStatus() {
  const now = Date.now();
  for (const mode of [1, 2, 3]) {
    const q = queues[mode];
    for (const c of q) send(c, { t: 'queue', count: q.length, need: mode * 2, wait: Math.max(0, Math.ceil((FILL_WAIT - (now - q[0].joinedAt)) / 1000)) });
  }
}
setInterval(() => {
  const now = Date.now();
  for (const mode of [1, 2, 3]) {
    const q = queues[mode], need = mode * 2;
    while (q.length >= need) makeRoom(mode, q.splice(0, need));
    if (q.length && now - q[0].joinedAt > FILL_WAIT) makeRoom(mode, q.splice(0, q.length));
  }
  queueStatus();
}, 1000);

function broadcast(r, m) { for (const h of r.humans) send(h, m); }
function voteList(r) { const v = {}; for (const k of Object.keys(SH.MAPS)) v[k] = []; for (const h of r.humans) { const x = r.votes.get(h.id); if (x) v[x].push(h.nick); } return v; }

function makeRoom(mode, humans) {
  const r = { mode, humans, phase: 'vote', votes: new Map(), G: null };
  humans.forEach((h, i) => { h.state = 'room'; h.room = r; h.team = i % 2; });
  rooms.add(r);
  broadcast(r, { t: 'room', mode, until: VOTE_TIME, players: humans.map(h => ({ nick: h.nick, pro: !!h.pro, team: h.team, bid: h.bid, lvl: h.lvl })) });
  for (const h of humans) send(h, { t: 'you', team: h.team });
  r.voteTimer = setTimeout(() => endVote(r), VOTE_TIME);
}

function endVote(r) {
  if (r.phase !== 'vote' || !rooms.has(r)) return;
  clearTimeout(r.voteTimer);
  const cnt = {}; for (const k of Object.keys(SH.MAPS)) cnt[k] = 0; for (const v of r.votes.values()) cnt[v]++;
  const top = Math.max(...Object.values(cnt)), best = Object.keys(cnt).filter(k => cnt[k] === top);
  const map = best[Math.floor(Math.random() * best.length)], tie = best.length > 1;
  const n = r.mode, avgW = r.humans.reduce((s, h) => s + h.wins, 0) / r.humans.length;
  const members = r.humans.map(h => ({ bid: h.bid, lvl: h.lvl, team: h.team, ctrl: 'remote', nick: h.nick, pro: !!h.pro, pid: h.id }));
  for (const team of [0, 1]) {
    let have = members.filter(m => m.team === team).length;
    while (have++ < n) members.push({ bid: SH.pickBot(avgW).id, lvl: SH.enemyLvl(avgW), team, ctrl: 'ai', skill: SH.enemySkill(avgW) });
  }
  r.G = SH.createMatch(n, map, members);
  if (process.env.FAST) r.G.time = +process.env.FAST;
  r.phase = 'play';
  for (const h of r.humans) {
    const me = r.G.ents.find(e => e.pid === h.id);
    send(h, { t: 'start', n, map, tie, votes: voteList(r), you: me.id,
      ents: r.G.ents.map(e => ({ id: e.id, bid: e.bid, lvl: e.lvl, team: e.team, name: e.name, pro: e.pro, human: e.ctrl === 'remote', maxhp: e.maxhp, x: e.x, y: e.y })) });
  }
}

/* ---------- main loop ---------- */
const R1 = v => Math.round(v);
setInterval(() => {
  for (const r of rooms) {
    if (r.phase !== 'play') continue;
    const G = r.G, done = SH.step(G, TICK);
    const ents = G.ents.map(e => [e.id, R1(e.x), R1(e.y), Math.round(e.ang * 100), R1(e.hp), e.alive ? 1 : 0, e.coins, e.kills, SH.flags(e), G.bomb ? SH.WEAPON_KEYS.indexOf(e.wpn) : -1, G.bomb ? (e.armor ? 1 : 0) | (e.kit ? 2 : 0) : 0]);
    const bul = G.bul.map(b => [b.id, R1(b.x), R1(b.y), R1(b.vx), R1(b.vy), b.team, b.r, b.vis, R1(b.h || 0)]);
    const coins = G.coins.map(c => [c.id, R1(c.x), R1(c.y)]);
    const zones = G.zones.map(z => [R1(z.x), R1(z.y), z.r, z.vis]);
    const mines = G.mines.map(m => [R1(m.x), R1(m.y), m.team, m.arm <= 0 ? 1 : 0]);
    const strikes = G.strikes.map(s => [R1(s.x), R1(s.y), s.rad, Math.round((1 - s.t / s.T) * 100)]);
    const B = G.bomb, bo = B ? [['buy', 'live', 'planted', 'end'].indexOf(B.ph), Math.round(B.pt * 10) / 10, B.atk, B.round, B.wins[0], B.wins[1], B.carrier,
      B.dropped ? R1(B.dropped.x) : -1, B.dropped ? R1(B.dropped.y) : -1, B.planted ? R1(B.planted.x) : -1, B.planted ? R1(B.planted.y) : -1,
      Math.round(B.prog * 100), Math.round(SH.bombNeed(G) * 10), B.progBy] : null;
    const ba = G.ball ? [R1(G.ball.x), R1(G.ball.y), R1(G.ball.vx), R1(G.ball.vy), G.ball.owner, Math.round(G.ball.bomb * 10)] : null;
    const so = G.soc ? [Math.round(G.soc.el * 10), G.soc.half, G.soc.stop > 0 ? 1 : 0, Math.round(G.soc.pause * 10)] : null;
    const base = { t: 's', bo, ba, so, gt: Math.round(G.t * 1000) / 1000, time: Math.max(0, G.time), st: G.start, sc: SH.scores(G), e: ents, b: bul, c: coins, z: zones, m: mines, k: strikes, ev: G.ev };
    for (const h of r.humans) {
      const me = G.ents.find(e => e.pid === h.id);
      send(h, Object.assign({ me: me ? { sup: Math.round(me.sup * 100) / 100, resp: Math.min(99, Math.max(0, me.resp)), money: G.bomb ? me.money : null, nades: me.nades || 0 } : null }, base));
    }
    G.ev = [];
    if (done) {
      broadcast(r, { t: 'end', sc: G.result, ents: G.ents.map(e => ({ id: e.id, kills: e.kills, coins: e.coins })) });
      for (const h of r.humans) { h.room = null; h.state = 'idle'; }
      rooms.delete(r);
    }
  }
}, TICK * 1000);

server.listen(PORT, () => console.log(`Fokionas Arena live server on port ${PORT}` + (USERS_FILE ? ' (accounts file)' : API_URL ? ' (accounts via ' + API_URL + ')' : ' (no account check)')));
