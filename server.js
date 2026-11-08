/* Fokionas Arena — live server (WebSocket). Start with: node server.js */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('./mini-ws.js');
const SH = require('./shared.js');
const VERSION = 15;   // shown at the server address, so you can check which version is running

let CFG = {};
try { CFG = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')); } catch (e) {}
const PORT = process.env.PORT || CFG.port || 3000;
const USERS_FILE = process.env.USERS_FILE || CFG.usersFile || '';
// When the live server runs on another host (e.g. Render), it checks accounts through the site's api.php.
const API_URL = process.env.API_URL || CFG.apiUrl || 'https://www.fokionas.gr/game/api.php';
const TICK = 1 / 20;            // 20 updates per second
const FILL_WAIT = 20000;        // after 20 s of waiting, empty seats get bots
const VOTE_TIME = 7000;
const TOUR_KEY = process.env.TOUR_KEY || '';   // Render → Environment → TOUR_KEY (the same value as in api.php)

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
  res.end(`Fokionas Arena live server: OK\nVersion: ${VERSION}\nConnected: ${clients.size} · Battles: ${rooms.size}\n`);
});
const wss = new WebSocketServer({ server, maxPayload: 4096 });
const clients = new Set();
const queues = { 1: [], 2: [], 3: [] };
const rooms = new Set();
const parties = new Map();   // friend invites: code -> { members, kind, mode }
const clanGroups = new Map(); // clan practice: clan id -> { members, t }
const CLAN_GATHER = 12000, CLAN_WAIT_FOE = 8000;
let T = null;                 // the Sunday tournament while it runs
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
    c.nick = u.nick; c.token = m.token; c.ustate = u.state; c.pro = !!(u.state && u.state.pro); c.w = SH.wCount(u.state); c.state = 'idle';
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
      wins = st.wins || 0; c.pro = !!st.pro; c.w = SH.wCount(st);
    }
    const clanId = typeof m.clan === 'string' && /^[a-f0-9]{8}$/.test(m.clan) ? m.clan : null;
    if (clanId) {   // clan practice: everyone available, all at level 30, no entry fee
      bid = SH.ROSTER[+m.bid] ? +m.bid : 0;
      Object.assign(c, { mode: 3, bid, lvl: 30, wins, state: 'queue', joinedAt: Date.now(), vkey: 'c:' + clanId });   // clan-mates can talk
      let P = clanGroups.get(clanId);
      if (!P) { P = { id: clanId, name: String(m.clanName || 'Clan').slice(0, 16), members: [], t: Date.now(), ready: 0 }; clanGroups.set(clanId, P); }
      if (P.members.length < 3) P.members.push(c); c.clanGroup = clanId;
      for (const x of P.members) send(x, { t: 'clan', count: P.members.length, wait: Math.max(0, Math.ceil((P.t + CLAN_GATHER - Date.now()) / 1000)) });
      return;
    }
    Object.assign(c, { mode, bid, lvl, wins, state: 'queue', joinedAt: Date.now(), vkey: null });
    const party = typeof m.party === 'string' && /^[a-f0-9]{6,16}$/.test(m.party) ? m.party : null;
    if (party) {   // playing with a friend: wait for them, not for strangers
      let P = parties.get(party);
      if (!P) { P = { members: [], kind: m.kind === 'vs' ? 'vs' : 'team', mode, t: Date.now() }; parties.set(party, P); }
      c.party = party; P.members.push(c);
      if (P.members.length >= 2) {
        parties.delete(party);
        const [a, b] = P.members, n = P.kind === 'team' ? Math.max(2, P.mode) : P.mode;
        for (const x of P.members) { x.party = null; x.vkey = 'p:' + party; }   // friends can talk
        makeRoom(n, [a, b], P.kind === 'team' ? [0, 0] : [0, 1]);
      } else send(c, { t: 'party', waiting: true });
      return;
    }
    queues[mode].push(c);
    return queueStatus();
  }
  if (m.t === 'tour_hello') return tourHello(c, m);
  if (m.t === 'leave') return leave(c);
  const r = c.room; if (!r) return;
  if (m.t === 'rtc') {   // voice chat: pass the message on, only between friends / clan-mates in the same game
    const to = r.humans.find(h => h.id === +m.to);
    if (!to || to === c || !c.vkey || to.vkey !== c.vkey) return;
    const sdp = m.sdp && typeof m.sdp.sdp === 'string' && m.sdp.sdp.length < 20000 && ['offer', 'answer'].includes(m.sdp.type) ? { type: m.sdp.type, sdp: m.sdp.sdp } : null;
    const ice = m.ice && typeof m.ice.candidate === 'string' && m.ice.candidate.length < 2000 ? { candidate: m.ice.candidate, sdpMid: m.ice.sdpMid, sdpMLineIndex: m.ice.sdpMLineIndex } : null;
    if (sdp || ice) send(to, { t: 'rtc', from: c.id, sdp, ice });
    return;
  }
  if (m.t === 'vote' && r.phase === 'vote' && SH.MAP_NAMES[m.map]) {
    r.votes.set(c.id, m.map);
    broadcast(r, { t: 'votes', votes: voteList(r) });
    if (r.votes.size === r.humans.length) endVote(r);
    return;
  }
  if (r.phase !== 'play') return;
  const G = r.G, e = G.ents.find(x => x.pid === c.id); if (!e) return;
  if (m.t === 'pos') {
    if (!e.alive || G.start > 0 || !isFinite(m.x) || !isFinite(m.y) || (G.bomb && G.bomb.ph === 'buy') || (G.soc && G.soc.pause > 0) || e.jump) return;
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
  else if (m.t === 'jump' && G.hoop) SH.jumpStart(G, e);
  else if (m.t === 'release' && G.hoop) SH.jumpRelease(G, e);
  else if (m.t === 'buy' && G.bomb) SH.buy(G, e, String(m.item));
  else if (m.t === 'act' && G.bomb) e.act = !!m.on;
  else if (m.t === 'nade' && G.bomb && isFinite(m.a)) SH.throwNade(G, e, m.a, isFinite(m.d) ? m.d : 320);
}

function leave(c) {
  if (c.clanGroup) { const P = clanGroups.get(c.clanGroup); if (P) { P.members = P.members.filter(x => x !== c); if (!P.members.length) clanGroups.delete(c.clanGroup); } c.clanGroup = null; }
  if (T) T.clients.delete(c);
  if (c.party) { const P = parties.get(c.party); if (P) { P.members = P.members.filter(x => x !== c); if (!P.members.length) parties.delete(c.party); } c.party = null; }
  if (c.state === 'queue') { const q = queues[c.mode]; const i = q.indexOf(c); if (i >= 0) q.splice(i, 1); queueStatus(); }
  const r = c.room;
  if (r) {
    r.humans = r.humans.filter(h => h !== c);
    if (c.vkey) for (const h of r.humans) if (h.vkey === c.vkey) send(h, { t: 'voicegone', id: c.id });
    r.votes && r.votes.delete(c.id);
    if (r.G) { const e = r.G.ents.find(x => x.pid === c.id); if (e) { e.pid = null; e.ctrl = 'ai'; e.skill = .5; e.name += ' (bot)'; } }
    if (!r.humans.length && !r.tour) { clearTimeout(r.voteTimer); rooms.delete(r); }   // tournament games go on with bots
    else if (r.phase === 'vote') { broadcast(r, { t: 'votes', votes: voteList(r) }); if (r.votes.size === r.humans.length) endVote(r); }
  }
  c.room = null; c.state = c.nick ? 'idle' : 'new'; c.tourClan = null;
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
  for (const [code, P] of parties) if (now - P.t > 75000) {
    parties.delete(code);
    for (const x of P.members) { x.party = null; x.state = 'idle'; send(x, { t: 'error', msg: 'Your friend did not join in time. Invite them again.' }); }
  }
  // clan practice: gather the clan for a few seconds, then play another clan if one is ready, otherwise bots
  const ready = [];
  for (const P of clanGroups.values()) if (now - P.t > CLAN_GATHER && P.members.length) ready.push(P);
  while (ready.length >= 2) {
    const A = ready.shift(), B = ready.shift(); clanGroups.delete(A.id); clanGroups.delete(B.id);
    for (const x of [...A.members, ...B.members]) x.clanGroup = null;
    makeRoom(3, [...A.members, ...B.members], [...A.members.map(() => 0), ...B.members.map(() => 1)], { lvl30: true });
  }
  for (const P of ready) if (now - P.t > CLAN_GATHER + CLAN_WAIT_FOE) {
    clanGroups.delete(P.id); for (const x of P.members) x.clanGroup = null;
    makeRoom(3, P.members, P.members.map(() => 0), { lvl30: true });
  } else for (const x of P.members) send(x, { t: 'clan', count: P.members.length, wait: 0, foe: true });
  queueStatus();
}, 1000);

function broadcast(r, m) { for (const h of r.humans) send(h, m); }
function voteList(r) { const v = {}; for (const k of Object.keys(SH.MAPS)) v[k] = []; for (const h of r.humans) { const x = r.votes.get(h.id); if (x) v[x].push(h.nick); } return v; }

// voice chat groups: friends who came in together, or members of the same clan
function voiceSetup(r) {
  for (const h of r.humans) send(h, { t: 'voice', me: h.id, peers: h.vkey ? r.humans.filter(x => x !== h && x.vkey === h.vkey).map(x => ({ id: x.id, nick: x.nick })) : [] });
}
function makeRoom(mode, humans, teams, opt) {
  const r = { mode, humans, phase: 'vote', votes: new Map(), G: null, opt: opt || {} };
  humans.forEach((h, i) => { h.state = 'room'; h.room = r; h.team = teams ? teams[i] : i % 2; });
  rooms.add(r);
  broadcast(r, { t: 'room', mode, until: VOTE_TIME, players: humans.map(h => ({ nick: h.nick, pro: !!h.pro, w: h.w || 0, team: h.team, bid: h.bid, lvl: h.lvl })) });
  for (const h of humans) send(h, { t: 'you', team: h.team });
  voiceSetup(r);
  r.voteTimer = setTimeout(() => endVote(r), VOTE_TIME);
}

function endVote(r) {
  if (r.phase !== 'vote' || !rooms.has(r)) return;
  clearTimeout(r.voteTimer);
  const cnt = {}; for (const k of Object.keys(SH.MAPS)) cnt[k] = 0; for (const v of r.votes.values()) cnt[v]++;
  const top = Math.max(...Object.values(cnt)), best = Object.keys(cnt).filter(k => cnt[k] === top);
  const map = best[Math.floor(Math.random() * best.length)], tie = best.length > 1;
  startGame(r, map, tie);
}
function startGame(r, map, tie) {
  const n = r.mode, lvl30 = !!r.opt.lvl30, avgW = r.humans.length ? r.humans.reduce((s, h) => s + h.wins, 0) / r.humans.length : 10;
  const members = r.humans.map(h => ({ bid: h.bid, lvl: lvl30 ? 30 : h.lvl, team: h.team, ctrl: 'remote', nick: h.nick, pro: !!h.pro, w: h.w || 0, pid: h.id }));
  for (const team of [0, 1]) {
    let have = members.filter(m => m.team === team).length;
    while (have++ < n) members.push(lvl30 ? { bid: Math.floor(Math.random() * 30), lvl: 30, team, ctrl: 'ai', skill: .65 }
                                          : { bid: SH.pickBot(avgW).id, lvl: SH.enemyLvl(avgW), team, ctrl: 'ai', skill: SH.enemySkill(avgW) });
  }
  r.G = SH.createMatch(n, map, members);
  if (process.env.FAST) r.G.time = +process.env.FAST;   // testing only: shorter games
  r.phase = 'play';
  for (const h of r.humans) {
    const me = r.G.ents.find(e => e.pid === h.id);
    send(h, { t: 'start', n, map, tie, votes: voteList(r), you: me.id,
      ents: r.G.ents.map(e => ({ id: e.id, bid: e.bid, lvl: e.lvl, team: e.team, name: e.name, pro: e.pro, w: e.w || 0, human: e.ctrl === 'remote', maxhp: e.maxhp, x: e.x, y: e.y })) });
  }
}

/* ---------- SUNDAY TOURNAMENT ---------- */
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
// For testing only: TOUR_FAKE_START=<ms> makes the tournament start at that moment.
const CHECKIN = +process.env.TOUR_CHECKIN || SH.TOUR.checkin;   // testing: shorter check-in
const ENV_MAPS = process.env.TOUR_MAPS ? process.env.TOUR_MAPS.split(',') : null;   // testing overrides
const ENV_PER = +process.env.TOUR_PER_MAP || 0;
// maps and games per map come from the admin settings of the tournament (api.php), default: every map, 3 games each
const tourMaps = () => ENV_MAPS || (T && T.mapList && T.mapList.length ? T.mapList : SH.TOUR.maps);
const tourPer = () => ENV_PER || (T && T.perMap) || SH.TOUR.perMap;
const fresh = () => tourCache.data && tourCache.data.start && Date.now() - tourCache.at < 120000 ? tourCache.data : null;
const tourStartAt = now => process.env.TOUR_FAKE_START ? +process.env.TOUR_FAKE_START : fresh() ? fresh().start : SH.tourStart(now);
let tourCache = { at: 0, data: null }, tourBusy = false;
async function tourData(force) {
  if (!force && tourCache.data && Date.now() - tourCache.at < 15000) return tourCache.data;
  try {
    const r = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 FokionasLive/1.0' }, body: JSON.stringify({ action: 'tour_get' }), signal: AbortSignal.timeout(8000) });
    tourCache = { at: Date.now(), data: await r.json() };
  } catch (e) { console.error('tour_get failed:', e.message); tourCache.at = Date.now() - 20000; }
  return tourCache.data;
}
function ensureTour() {
  const now = Date.now(), st = tourStartAt(now), d = fresh();
  if (T && ((d && T.tid && d.tid !== T.tid && T.phase === 'checkin') || now > T.start + SH.TOUR.window)) T = null;
  if (T && T.phase === 'checkin') {   // the admin can still move the start or change the maps during check-in
    T.start = st;
    if (d) { T.mapList = d.maps; T.perMap = d.perMap; T.name = d.name; }
  }
  if (!T && now >= st - 5 * 60e3 && now <= st + SH.TOUR.window)
    T = { start: st, tid: d && d.tid, name: d && d.name, mapList: d && d.maps, perMap: d && d.perMap, phase: 'checkin', clients: new Set(), alive: [], rounds: [], byes: [], champion: null, prize: null, msg: '' };
  return T;
}
async function tourHello(c, m) {
  await tourData();
  const t = ensureTour();
  if (!t) return send(c, { t: 'tour', phase: 'closed', start: tourStartAt(Date.now()) });
  const d = await tourData(true);
  const cl = d && d.clans && d.clans.find(x => x.paid.some(n => n.toLowerCase() === c.nick.toLowerCase()));
  if (!cl) return send(c, { t: 'tour', phase: 'notreg', start: t.start });
  c.tourClan = cl.id; c.tourName = cl.name; c.bid = SH.ROSTER[+m.bid] ? +m.bid : 0; c.lvl = 30;
  if (!c.room) c.state = 'tour';
  t.clients.add(c);
  tourBroadcast();
}
function tourPeople(id) { return [...T.clients].filter(c => c.tourClan === id && clients.has(c)); }
function tourStatus(c) {
  const rd = T.rounds.map(r => r.matches.map(x => ({ a: x.a.name, b: x.b.name, w: x.winner ? x.winner.name : null, map: x.plan[Math.min(x.gi, x.plan.length - 1)],
    score: x.wins.join('–'), game: Math.min(x.gi + 1, x.plan.length), total: x.plan.length, maps: x.games.map(g => [g.map, g.w]) })));
  const mine = c && c.tourClan, alive = T.alive.some(x => x.id === mine);
  return { t: 'tour', phase: T.phase, start: T.start, checkinEnd: T.start + CHECKIN, nextAt: T.nextAt || null, round: T.rounds.length,
    name: T.name || 'Sunday Tournament', perMap: tourPer(), maps: tourMaps().length, rounds: rd,
    byes: T.byes, champion: T.champion ? T.champion.name : null, prize: T.prize, msg: T.msg,
    you: c ? { clan: c.tourName, alive, inMatch: !!c.room, here: tourPeople(mine).length } : null,
    clans: T.phase === 'checkin' ? (tourCache.data && tourCache.data.clans || []).map(x => ({ name: x.name, here: tourPeople(x.id).length, paid: x.paid.length })) : null };
}
function tourBroadcast() { if (T) for (const c of T.clients) send(c, tourStatus(c)); }
async function tourDraw() {
  T.phase = 'drawing';
  botClans = 0;
  const d = await tourData(true);
  T.tid = d && d.tid;
  const present = ((d && d.clans) || []).filter(cl => tourPeople(cl.id).length > 0);
  T.alive = shuffle(present.map(cl => ({ id: cl.id, name: cl.name })));
  if (!T.alive.length) { T.phase = 'done'; T.msg = 'No clan was online at 19:00, so there is no tournament this week. Entry fees will be returned.'; return tourBroadcast(); }
  startTourRound();
}
let botClans = 0;
const botClan = () => ({ id: 'bots' + (++botClans), name: botClans > 1 ? 'Bot Clan ' + botClans : 'Bot Clan', bot: true });
function startTourRound() {
  const list = T.alive.slice(), matches = [];
  if (list.length % 2) list.push(botClan());   // a clan left alone plays a clan full of bots
  for (let i = 0; i < list.length; i += 2) {
    const plan = []; for (const k of shuffle(tourMaps().slice())) for (let j = 0; j < tourPer(); j++) plan.push(k);   // every map, a few games each, random order
    matches.push({ a: list[i], b: list[i + 1], winner: null, plan, gi: 0, wins: [0, 0], games: [], extra: 0 });
  }
  T.rounds.push({ matches }); T.byes.push(null); T.phase = 'round'; T.msg = '';
  for (const x of matches) startTourMatch(x);
  tourBroadcast();
}
function decideWinner(G) {
  const sc = G.result || SH.scores(G);
  if (sc[0] !== sc[1]) return sc[0] > sc[1] ? 0 : 1;
  const k = [0, 1].map(t => G.ents.filter(e => e.team === t).reduce((s, e) => s + e.kills, 0));   // draw: more kills goes through
  if (k[0] !== k[1]) return k[0] > k[1] ? 0 : 1;
  return Math.random() < .5 ? 0 : 1;
}
function startTourMatch(x) {
  const map = x.plan[x.gi];
  const A = tourPeople(x.a.id).filter(c => !c.room).slice(0, 3), B = tourPeople(x.b.id).filter(c => !c.room).slice(0, 3);
  const done = G => {
    const sc = G.result || SH.scores(G), w = sc[0] > sc[1] ? 0 : sc[1] > sc[0] ? 1 : -1;
    x.games.push({ map, sc, w }); if (w >= 0) x.wins[w]++; x.gi++;
    const gap = A.length || B.length ? 8000 : 300;
    if (x.gi < x.plan.length) { tourBroadcast(); return setTimeout(() => startTourMatch(x), gap); }
    if (x.wins[0] === x.wins[1] && x.extra < 3) {   // tied after every map: one more game on a random map
      x.extra++; const ms = tourMaps(), next = ms[Math.floor(Math.random() * ms.length)]; x.plan.push(next);
      T.msg = `${x.a.name} and ${x.b.name} are tied ${x.wins.join('–')}, so they play one more game: ${SH.MAP_NAMES[next]}.`;
      tourBroadcast(); return setTimeout(() => startTourMatch(x), gap);
    }
    const win = x.wins[0] !== x.wins[1] ? (x.wins[0] > x.wins[1] ? 0 : 1) : decideWinner(G);
    x.winner = win === 0 ? x.a : x.b; tourRoundCheck();
  };
  if (!A.length && !B.length) {   // nobody from either clan is connected: the bots play it out
    const r = { mode: 3, humans: [], opt: { lvl30: true } }; startGame(r, map, false);
    let s = 0; while (!SH.step(r.G, .05) && s < 20000) s++;
    return setTimeout(() => done(r.G), 300);
  }
  const humans = [...A, ...B], r = { mode: 3, humans, phase: 'vote', votes: new Map(), G: null, opt: { lvl30: true }, tour: x };
  humans.forEach(h => { h.state = 'room'; h.room = r; h.team = A.includes(h) ? 0 : 1; h.vkey = 'c:' + h.tourClan; send(h, { t: 'you', team: h.team }); });
  voiceSetup(r);
  rooms.add(r);
  r.onEnd = done;
  startGame(r, map, false);
  tourBroadcast();
}
function tourRoundCheck() {
  const rd = T.rounds[T.rounds.length - 1];
  if (!rd || rd.matches.some(x => !x.winner)) return tourBroadcast();
  const next = rd.matches.map(x => x.winner);
  T.alive = next;
  if (next.length === 1) return tourFinish(next[0]);
  T.phase = 'break'; T.nextAt = Date.now() + 15000; tourBroadcast();
}
async function tourFinish(champ) {
  T.phase = 'done'; T.champion = champ; T.msg = champ.bot ? 'The bots won, so every player gets the $50 entry fee back.' : '';
  tourBroadcast();
  try {
    const r = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 FokionasLive/1.0' },
      body: JSON.stringify({ action: 'tour_finish', key: TOUR_KEY, tid: T.tid, winner: champ.bot ? 'bots' : champ.id, name: champ.name, bracket: T.rounds.map(r => r.matches.map(x => [x.a.name, x.b.name, x.winner && x.winner.name])) }), signal: AbortSignal.timeout(10000) });
    const j = await r.json();
    if (j.ok) {
      T.prize = { each: j.each, pot: j.pot, players: j.winners };
      if (j.bots && !champ.bot) T.msg = `${champ.name} played for free, so nobody wins money: every player gets the $50 entry fee back.`;
    } else { console.error('tour_finish:', j.error); T.msg = 'The prize could not be paid automatically (' + (j.error || 'error') + '). Check TOUR_KEY on Render.'; }
  } catch (e) { console.error('tour_finish failed:', e.message); T.msg = 'The prize could not be paid: the game site did not answer.'; }
  tourBroadcast();
}
setInterval(() => {
  if (Date.now() - tourCache.at > 30000 && !tourBusy) { tourBusy = true; tourData().finally(() => { tourBusy = false; }); }   // see admin changes (new start time, maps)
  const t = ensureTour(); if (!t) return;
  const now = Date.now();
  if (t.phase === 'checkin' && now >= t.start + CHECKIN) tourDraw();
  else if (t.phase === 'break' && now >= t.nextAt) startTourRound();
  else if (t.phase === 'checkin' && t.clients.size && now % 5000 < 2000) tourBroadcast();
}, 2000);

/* ---------- main loop ---------- */
const R1 = v => Math.round(v);
setInterval(() => {
  for (const r of rooms) {
    if (r.phase !== 'play') continue;
    const G = r.G, done = SH.step(G, TICK);
    const ents = G.ents.map(e => [e.id, R1(e.x), R1(e.y), Math.round(e.ang * 100), R1(e.hp), e.alive ? 1 : 0, e.coins, e.kills, SH.flags(e), G.bomb ? SH.WEAPON_KEYS.indexOf(e.wpn) : -1, G.bomb ? (e.armor ? 1 : 0) | (e.kit ? 2 : 0) : 0, e.baskets || 0, R1(SH.jumpHeight(e)), e.jump ? Math.round(e.jump.t * 100) : null]);
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
    const S = G.siege, sg = S ? [S.atk, S.half, Math.round(S.gate / S.gateMax * 1000), Math.round(S.crown / S.crownMax * 1000)] : null;
    const hb = G.hoop ? G.hoop.balls.map(b => [R1(b.x), R1(b.y), R1(b.h || 0), b.owner]) : null;
    const base = { t: 's', bo, ba, so, hb, sg, gt: Math.round(G.t * 1000) / 1000, time: Math.max(0, G.time), st: G.start, sc: SH.scores(G), e: ents, b: bul, c: coins, z: zones, m: mines, k: strikes, ev: G.ev };
    for (const h of r.humans) {
      const me = G.ents.find(e => e.pid === h.id);
      send(h, Object.assign({ me: me ? { sup: Math.round(me.sup * 100) / 100, resp: Math.min(99, Math.max(0, me.resp)), money: G.bomb ? me.money : null, nades: me.nades || 0 } : null }, base));
    }
    G.ev = [];
    if (done) {
      broadcast(r, { t: 'end', sc: G.result, ents: G.ents.map(e => ({ id: e.id, kills: e.kills, coins: e.coins })) });
      for (const h of r.humans) { h.room = null; h.state = h.tourClan ? 'tour' : 'idle'; }
      rooms.delete(r);
      if (r.onEnd) r.onEnd(G);
    }
  }
}, TICK * 1000);

server.listen(PORT, () => console.log(`Fokionas Arena live server on port ${PORT}` + (USERS_FILE ? ' (accounts file)' : API_URL ? ' (accounts via ' + API_URL + ')' : ' (no account check)')));
