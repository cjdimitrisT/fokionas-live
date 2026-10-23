/* Fokionas Arena — shared game engine (browser + live server).
   Brawlers, attacks, supers, maps and the battle simulation. */
(function (root) {
'use strict';

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const R = 24;

/* ---------- BRAWLERS ----------
   look: weapon model · hat: hat model
   atk / super acts: k = kind (shot, lob, beam, punch, mine, nova, storm, meteor, heal, shield, rage, minefield)
   shot flags: n, spread, par, ring, jit, bsj, pierce, bounce, boomer, homing, split, chain, slow, drain, zone, boom, burst
   vis (projectile look): 0 team, 1 fire, 2 super, 3 gold, 4 frost, 5 toxic, 6 bomb, 7 blade, 8 electric, 9 orb, 10 rocket */
const BR = [
 { n:'Tasos', hp:3200, spd:175, look:'gun', hat:0,
   atk:{ name:'Quick Shot', desc:'One fast, accurate bullet.', k:'shot', dmg:620, range:430, reload:.5, bs:820, r:6 },
   sup:{ name:'Nova', desc:'Fires 16 bullets in every direction.', acts:[{ k:'shot', ring:1, n:16, dmg:650, range:380, bs:720, r:8, vis:2 }] } },
 { n:'Lena', hp:2900, spd:210, look:'gun', hat:1,
   atk:{ name:'Twin Darts', desc:'Two parallel darts at once.', k:'shot', n:2, par:16, dmg:360, range:390, reload:.42, bs:880, r:5 },
   sup:{ name:'Rage', desc:'Shoots twice as fast and hits harder for 5 seconds.', acts:[{ k:'rage', t:5 }] } },
 { n:'Babis', hp:5400, spd:160, look:'wide', hat:2,
   atk:{ name:'Scatter Blast', desc:'Five pellets in a wide cone. Brutal up close.', k:'shot', n:5, spread:.55, dmg:300, range:260, reload:.7, bs:650, r:6 },
   sup:{ name:'Iron Shield', desc:'Takes 60% less damage for 3.5 seconds.', acts:[{ k:'shield', t:3.5, rad:0 }] } },
 { n:'Kiki', hp:2600, spd:165, look:'long', hat:4,
   atk:{ name:'Long Shot', desc:'A very long range sniper bullet.', k:'shot', dmg:1150, range:620, reload:.95, bs:1150, r:6 },
   sup:{ name:'Mega Laser', desc:'A giant laser that goes through walls and enemies.', acts:[{ k:'beam', dmg:1800, range:900, pierce:1, thru:1, w:26, vis:2 }] } },
 { n:'Stratos', hp:3900, spd:170, look:'wide', hat:3,
   atk:{ name:'Bouncing Shells', desc:'Three shells that bounce off walls twice.', k:'shot', n:3, spread:.35, bounce:2, dmg:380, range:340, reload:.75, bs:700, r:7 },
   sup:{ name:'Shell Barrage', desc:'Rapid-fires 10 bouncing shells.', acts:[{ k:'shot', burst:{ n:10, gap:.08 }, jit:.12, bounce:1, dmg:420, range:450, bs:850, r:7, vis:2 }] } },
 { n:'Rena', hp:3300, spd:180, look:'blade', hat:1,
   atk:{ name:'Boomerang', desc:'Flies out and comes back, hitting on both ways.', k:'shot', boomer:1, pierce:1, dmg:560, range:400, reload:.85, bs:650, r:9, vis:7 },
   sup:{ name:'Whirlwind', desc:'Three spinning rings of blades.', acts:[{ k:'shot', ring:1, n:12, burst:{ n:3, gap:.25 }, dmg:450, range:300, bs:600, r:8, vis:7 }] } },
 { n:'Jimmy', hp:6000, spd:205, look:'fist', hat:2,
   atk:{ name:'Haymaker', desc:'A huge punch that hits everyone in front of him.', k:'punch', dmg:1300, range:125, arc:.8, reload:.6 },
   sup:{ name:'Ground Quake', desc:'Smashes the ground, damaging and slowing everyone nearby.', acts:[{ k:'nova', dmg:1600, rad:260, slow:2 }] } },
 { n:'Fofo', hp:4200, spd:185, look:'wide', hat:3,
   atk:{ name:'Flamethrower', desc:'Short range fire that burns through enemies.', k:'shot', n:5, spread:.5, jit:.08, bsj:.35, pierce:1, dmg:150, range:230, reload:.45, bs:560, r:10, vis:1 },
   sup:{ name:'Firestorm', desc:'Throws a fire bomb that leaves a burning area.', acts:[{ k:'lob', dmg:600, range:520, boom:120, zone:{ r:170, dps:700, t:4 }, r:12, vis:1 }] } },
 { n:'Makis', hp:2800, spd:170, look:'bomb', hat:0,
   atk:{ name:'Lob Bomb', desc:'Throws a bomb over walls that explodes on landing.', k:'lob', dmg:950, range:420, reload:1, boom:90, r:10, vis:6 },
   sup:{ name:'Mega Bomb', desc:'One enormous bomb with a huge blast.', acts:[{ k:'lob', dmg:2200, range:540, boom:220, r:18, flight:.9, vis:6 }] } },
 { n:'Niki', hp:3000, spd:175, look:'staff', hat:4,
   atk:{ name:'Chain Lightning', desc:'A bolt that jumps to two more enemies.', k:'shot', chain:{ n:2, f:.7, rad:230 }, dmg:560, range:430, reload:.7, bs:1000, r:6, vis:8 },
   sup:{ name:'Thunderstorm', desc:'Six lightning strikes rain on enemies.', acts:[{ k:'storm', n:6, dmg:900, rad:90, range:540 }] } },
 { n:'Spyros', hp:3400, spd:175, look:'gun', hat:2,
   atk:{ name:'Split Shot', desc:'A shell that bursts into 5 fragments.', k:'shot', split:{ n:5, dmg:150, range:170 }, dmg:480, range:360, reload:.7, bs:700, r:8 },
   sup:{ name:'Missile Swarm', desc:'Six missiles that chase enemies.', acts:[{ k:'shot', n:6, spread:1.4, homing:4, dmg:520, range:620, bs:520, r:8, vis:10 }] } },
 { n:'Elpida', hp:3200, spd:180, look:'staff', hat:1,
   atk:{ name:'Drain Bolt', desc:'Steals life: heals her for half the damage.', k:'shot', drain:.5, dmg:600, range:420, reload:.6, bs:780, r:7, vis:9 },
   sup:{ name:'Healing Wave', desc:'Heals her and nearby teammates.', acts:[{ k:'heal', frac:.6, rad:350 }] } },
 { n:'Lakis', hp:3600, spd:170, look:'bomb', hat:3,
   atk:{ name:'Mine Layer', desc:'Places hidden mines (max 3) that blow up on contact.', k:'mine', dmg:1100, rad:90, range:300, reload:.9, max:3 },
   sup:{ name:'Minefield', desc:'Drops six mines all around him.', acts:[{ k:'minefield', n:6, dmg:1100, rad:90, ring:130 }] } },
 { n:'Voula', hp:3300, spd:175, look:'staff', hat:4,
   atk:{ name:'Frost Shot', desc:'Icy bullet that slows enemies.', k:'shot', slow:1.5, dmg:520, range:450, reload:.55, bs:760, r:7, vis:4 },
   sup:{ name:'Blizzard', desc:'Freezing blast that slows everyone around her.', acts:[{ k:'nova', dmg:900, rad:330, slow:3, vis:4 }] } },
 { n:'Thanasis', hp:2800, spd:165, look:'long', hat:0,
   atk:{ name:'Rail Beam', desc:'An instant laser beam.', k:'beam', dmg:950, range:560, reload:1.05, w:8 },
   sup:{ name:'Meteor', desc:'Calls a meteor from the sky after 1 second.', acts:[{ k:'meteor', dmg:2400, rad:170, range:600, delay:1 }] } },
 { n:'Zoe', hp:3100, spd:185, look:'staff', hat:1,
   atk:{ name:'Homing Orbs', desc:'Two orbs that curve towards enemies.', k:'shot', n:2, spread:.5, homing:3.5, dmg:420, range:500, reload:.6, bs:560, r:8, vis:9 },
   sup:{ name:'Orb Storm', desc:'Ten homing orbs in every direction.', acts:[{ k:'shot', ring:1, n:10, homing:3, dmg:500, range:620, bs:480, r:8, vis:9 }] } },
 { n:'Pavlos', hp:5200, spd:160, look:'wide', hat:2,
   atk:{ name:'Tidal Wave', desc:'A big slow wave that goes through enemies.', k:'shot', pierce:1, dmg:800, range:400, reload:1, bs:450, r:22, vis:4 },
   sup:{ name:'Fortress', desc:'Shields him and nearby teammates for 3 seconds.', acts:[{ k:'shield', t:3, rad:300 }] } },
 { n:'Dafni', hp:3000, spd:205, look:'gun', hat:3,
   atk:{ name:'Burst Fire', desc:'Three quick bullets in a row.', k:'shot', burst:{ n:3, gap:.09 }, dmg:330, range:460, reload:.7, bs:900, r:5 },
   sup:{ name:'Overdrive', desc:'Shoots twice as fast and hits harder for 5 seconds.', acts:[{ k:'rage', t:5 }] } },
 { n:'Giannakis', hp:3200, spd:180, look:'gun', hat:4,
   atk:{ name:'Toxic Dart', desc:'Leaves a poison cloud where it lands.', k:'shot', zone:{ r:80, dps:400, t:2.5 }, dmg:380, range:430, reload:.75, bs:750, r:6, vis:5 },
   sup:{ name:'Toxic Cloud', desc:'Throws a huge cloud of poison.', acts:[{ k:'lob', dmg:300, range:520, boom:80, zone:{ r:200, dps:650, t:5 }, r:12, vis:5 }] } },
 { n:'Myrto', hp:2700, spd:170, look:'long', hat:1,
   atk:{ name:'Piercing Arrow', desc:'A long arrow that goes through enemies.', k:'shot', pierce:1, dmg:850, range:580, reload:.9, bs:1000, r:6 },
   sup:{ name:'Arrow Rain', desc:'Eight arrows fall on enemies from the sky.', acts:[{ k:'storm', n:8, dmg:650, rad:80, range:560 }] } },
 { n:'Keravnos', hp:3300, spd:180, look:'gun', hat:3,
   atk:{ name:'Gatling', desc:'A stream of small, very fast bullets.', k:'shot', jit:.12, dmg:160, range:420, reload:.12, bs:950, r:4 },
   sup:{ name:'Thunder Nova', desc:'20 electric bullets that jump between enemies.', acts:[{ k:'shot', ring:1, n:20, chain:{ n:1, f:.6, rad:200 }, dmg:500, range:420, bs:800, r:7, vis:8 }] } },
 { n:'Iraklis', hp:6200, spd:200, look:'fist', hat:0,
   atk:{ name:'Mighty Slam', desc:'Slams the ground in front of him, hitting an area.', k:'punch', slam:110, dmg:1100, range:150, arc:.6, reload:.9 },
   sup:{ name:'Hero Mode', desc:'Shield and rage together for 4 seconds.', acts:[{ k:'shield', t:4, rad:0 }, { k:'rage', t:4 }] } },
 { n:'Athena', hp:3400, spd:180, look:'blade', hat:4,
   atk:{ name:'Shuriken Fan', desc:'Three stars that pierce through enemies.', k:'shot', n:3, spread:.4, pierce:1, dmg:450, range:440, reload:.65, bs:800, r:7, vis:7 },
   sup:{ name:'Aegis', desc:'Shields and heals the whole nearby team.', acts:[{ k:'shield', t:3, rad:350 }, { k:'heal', frac:.25, rad:350 }] } },
 { n:'Titan', hp:5600, spd:160, look:'bomb', hat:2,
   atk:{ name:'Rocket', desc:'A rocket that explodes on impact.', k:'shot', boom:80, dmg:800, range:480, reload:1, bs:620, r:10, vis:10 },
   sup:{ name:'Titan Fall', desc:'A giant meteor crashes down after 1 second.', acts:[{ k:'meteor', dmg:2600, rad:180, range:600, delay:1 }] } },
 { n:'Kentavros', hp:3600, spd:200, look:'long', hat:3,
   atk:{ name:'Ricochet', desc:'A long shot that bounces off walls 3 times.', k:'shot', bounce:3, dmg:650, range:620, reload:.7, bs:900, r:6 },
   sup:{ name:'Stampede', desc:'Fires 16 bullets in fast pairs.', acts:[{ k:'shot', burst:{ n:8, gap:.07 }, n:2, spread:.3, dmg:400, range:500, bs:900, r:6, vis:2 }] } },
 { n:'Medusa', hp:3200, spd:175, look:'staff', hat:1,
   atk:{ name:'Stone Gaze', desc:'An instant beam that slows enemies.', k:'beam', slow:1.2, dmg:700, range:480, reload:.8, w:6, vis:5 },
   sup:{ name:'Petrify', desc:'Turns everyone around her almost to stone.', acts:[{ k:'nova', dmg:700, rad:400, slow:3.5, vis:5 }] } },
 { n:'Kyklopas', hp:4400, spd:165, look:'bomb', hat:0,
   atk:{ name:'Cluster Bomb', desc:'A lobbed bomb that splits into 4 smaller blasts.', k:'lob', dmg:600, range:440, boom:70, split:{ n:4, dmg:300, range:140 }, reload:1.1, r:11, vis:6 },
   sup:{ name:'Cyclops Eye', desc:'A massive eye laser through everything.', acts:[{ k:'beam', dmg:2000, range:850, pierce:1, thru:1, w:30, vis:1 }] } },
 { n:'Pegasus', hp:3100, spd:215, look:'blade', hat:2,
   atk:{ name:'Spin Storm', desc:'Eight feathers spin out all around.', k:'shot', ring:1, n:8, dmg:300, range:260, reload:.6, bs:700, r:6, vis:7 },
   sup:{ name:'Wing Gust', desc:'Nine giant feathers that go through everything.', acts:[{ k:'shot', n:9, spread:1.2, pierce:1, dmg:500, range:540, bs:900, r:10, vis:2 }] } },
 { n:'Phoenix', hp:3400, spd:185, look:'staff', hat:3,
   atk:{ name:'Phoenix Fire', desc:'A fireball that explodes and keeps burning.', k:'shot', boom:60, zone:{ r:90, dps:450, t:2 }, dmg:450, range:450, reload:.8, bs:700, r:8, vis:1 },
   sup:{ name:'Rebirth', desc:'Fully heals and bursts into 16 fireballs.', acts:[{ k:'heal', frac:1, rad:0 }, { k:'shot', ring:1, n:16, dmg:500, range:350, bs:650, r:9, vis:1 }] } }
];
const FOKIONAS = { n:'Fokionas', hp:11000, spd:222, look:'gold', hat:5, legend:true, color:'#ffc93c', pw:1, cost:6000,
  atk:{ name:'Golden Storm', desc:'Three golden bolts that chase and pierce enemies.', k:'shot', n:3, spread:.22, homing:2.5, pierce:1, dmg:950, range:500, reload:.42, bs:950, r:8, vis:3 },
  sup:{ name:'Fokionas Fury', desc:'28 golden bolts in every direction and heals 40%.', acts:[{ k:'shot', ring:1, n:28, pierce:1, dmg:1500, range:450, bs:800, r:10, vis:3 }, { k:'heal', frac:.4, rad:0 }] } };
const MONTHLY = ['Zenon','Alkmini','Triton','Iris','Orfeas','Kassandra','Talos','Nefeli','Aiolos','Selini','Kirki','Achilleas','Pandora','Ikaros','Eos','Voreas','Kalypso','Perseas','Ariadni','Odysseas'];
const LAUNCH = { y: 2026, m: 9 }; // October 2026: 30 brawlers, then +1 every month
const FOK = 29;

function monthsSince(d) { d = d || new Date(); return Math.max(0, (d.getFullYear() - LAUNCH.y) * 12 + (d.getMonth() - LAUNCH.m)); }
function buildRoster() {
  const out = BR.map((b, i) => Object.assign({}, b, { id: i, pw: 1 + i * .035, color: `hsl(${(i * 47 + 10) % 360}, 72%, 56%)`, cost: i < 3 ? 0 : Math.round((80 + i * 55) / 10) * 10 }));
  out.push(Object.assign({ id: FOK }, FOKIONAS));
  const extra = monthsSince();
  for (let k = 0; k < extra; k++) {
    const A = BR[(k * 7 + 3) % BR.length], S = BR[(k * 11 + 5) % BR.length];
    out.push({ id: 30 + k, n: MONTHLY[k % MONTHLY.length] + (k >= MONTHLY.length ? ' ' + (Math.floor(k / MONTHLY.length) + 1) : ''),
      hp: A.hp, spd: A.spd, look: A.look, hat: (k + 2) % 5, atk: A.atk, sup: S.sup, pw: 1.75 + (k % 5) * .04,
      color: `hsl(${(k * 67 + 200) % 360}, 70%, 58%)`, cost: 2500, isNew: k === extra - 1 });
  }
  for (const b of out) b.name = b.n;
  return out;
}
const ROSTER = buildRoster();
const mult = l => 1 + (l - 1) * .06;
const enemyLvl = wins => Math.min(30, 1 + Math.floor(wins / 2));
const enemySkill = wins => Math.min(.95, .2 + wins * .025);
const isPro = st => !!(st && (st.pro || ROSTER.every(b => ((st.lvl || {})[b.id] || 1) >= 30)));

/* ---------- MAPS ---------- */
const COIN_WALLS = [{x:180,y:380,w:240,h:50},{x:980,y:380,w:240,h:50},{x:180,y:970,w:240,h:50},{x:980,y:970,w:240,h:50},{x:540,y:510,w:50,h:130},{x:810,y:510,w:50,h:130},{x:540,y:760,w:50,h:130},{x:810,y:760,w:50,h:130},{x:640,y:240,w:120,h:50},{x:640,y:1110,w:120,h:50},{x:60,y:660,w:120,h:80},{x:1220,y:660,w:120,h:80}];
const MAPS = {
  coins: { name: 'Cash Grab', W: 1400, H: 1400, time: 90, walls: COIN_WALLS, desc: 'Coins appear in the middle. The team holding the most coins at the end wins. Die and you drop them.' },
  open: { name: 'Open Arena', W: 1400, H: 1400, time: 120, walls: [], desc: 'Completely open, no walls. First team to reach the kill target wins.' },
  rush: { name: 'Crusher Run', W: 1000, H: 2600, time: 120, walls: [], desc: 'Race to the other side! Moving walls push you, and if they squash you against the edge you start over. First to cross wins.' }
};
const MAP_NAMES = { coins: MAPS.coins.name, open: MAPS.open.name, rush: MAPS.rush.name };
const RUSH_GOAL = 110;

/* Crusher Run walls: rows that slide left and right; their position depends only on match time. */
function rushRows(W, H) {
  // symmetric: row i and row N-1-i mirror each other, so both teams face the same run
  const rows = [], N = 10, top = 340, bot = H - 340, hh = 100;
  for (let i = 0; i < N; i++) {
    const j = Math.min(i, N - 1 - i), m = i !== j;
    rows.push({ y: top + i * (bot - top) / (N - 1) - hh / 2, h: hh, w: 380 + ((j * 53) % 3) * 70, speed: 230 + ((j * 7) % 5) * 35, phase: ((j * .618) + (m ? .5 : 0)) % 1 });
  }
  return rows;
}
function rushPush(map, W, H, t, rows) {
  if (map !== 'rush') return [];
  rows = rows || rushRows(W, H);
  return rows.map(r => {
    const travel = W - r.w, per = 2 * travel / r.speed, u = (((t / per + r.phase) % 1) + 1) % 1 * 2 * travel;
    const fwd = u < travel;
    return { x: fwd ? u : 2 * travel - u, y: r.y, w: r.w, h: r.h, dir: fwd ? 1 : -1, speed: r.speed };
  });
}

/* ---------- MATCH ---------- */
/* members: [{bid, lvl, team, ctrl:'input'|'remote'|'ai', skill, nick, pro, pid}] */
function createMatch(n, map, members) {
  const M = MAPS[map] || MAPS.open, W = M.W, H = M.H, ents = [], slots = [0, 0];
  members.forEach((m, i) => {
    const b = ROSTER[m.bid] || ROSTER[0], slot = slots[m.team]++, dm = mult(m.lvl) * b.pw;
    const sx = W / 2 + (slot - (n - 1) / 2) * 170, sy = map === 'rush' ? (m.team ? 90 : H - 90) : (m.team ? 150 : H - 150);
    ents.push({ id: i, pid: m.pid || null, b, bid: b.id, lvl: m.lvl, team: m.team, ctrl: m.ctrl, skill: m.skill || .5,
      name: m.nick || b.name, pro: !!m.pro, human: m.ctrl !== 'ai',
      maxhp: Math.round(b.hp * dm), hp: Math.round(b.hp * dm), dm, spd: b.spd, range: b.atk.range,
      supNeed: 3600 * dm, x: sx, y: sy, sx, sy, ang: m.team ? Math.PI / 2 : -Math.PI / 2,
      cd: 0, alive: true, resp: 0, sup: 0, coins: 0, kills: 0, lastHit: -9, lastShot: -9,
      slow: 0, shield: 0, rage: 0, bursts: [], mx: 0, my: 0, _vx: 0, _vy: 0,
      ai: { strafe: 1, st: 0, unstick: 0, ux: 0, uy: 0, px: sx, py: sy, react: 0, side: Math.random() < .5 ? -1 : 1 } });
  });
  const G = { n, map, W, H, walls: M.walls, rows: map === 'rush' ? rushRows(W, H) : null, push: [], ents, bul: [], coins: [], zones: [], mines: [], strikes: [], ev: [],
    time: M.time, t: 0, kills: [0, 0], target: { 1: 5, 2: 8, 3: 10 }[n], coinT: 0, over: false, start: 2.2, bid: 0, coinId: 0, winner: -1 };
  G.push = rushPush(map, W, H, 0, G.rows);
  return G;
}
const flags = e => (e.slow > 0 ? 1 : 0) | (e.shield > 0 ? 2 : 0) | (e.rage > 0 ? 4 : 0);
const speedOf = e => e.spd * (e.slow > 0 ? .6 : 1);

function inRect(w, x, y) { return x > w.x && x < w.x + w.w && y > w.y && y < w.y + w.h; }
function hitWall(G, x, y) { for (const w of G.walls) if (inRect(w, x, y)) return true; for (const w of G.push) if (inRect(w, x, y)) return true; return false; }
function los(G, a, b) { const d = dist(a, b), n = Math.ceil(d / 20); for (let i = 1; i < n; i++) { const t = i / n; if (hitWall(G, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) return false; } return true; }
function resolve(G, e) {
  e.x = clamp(e.x, R, G.W - R); e.y = clamp(e.y, R, G.H - R);
  for (const w of G.walls) {
    const px = clamp(e.x, w.x, w.x + w.w), py = clamp(e.y, w.y, w.y + w.h), dx = e.x - px, dy = e.y - py, d = Math.hypot(dx, dy);
    if (d < R) { if (d === 0) e.y = w.y - R; else { e.x += dx / d * (R - d); e.y += dy / d * (R - d); } }
  }
}
/* Moving walls push players sideways. Returns true if the player got squashed against the edge. */
function pushResolve(G, e) {
  let crushed = false;
  for (const w of G.push) {
    const px = clamp(e.x, w.x, w.x + w.w), py = clamp(e.y, w.y, w.y + w.h), dx = e.x - px, dy = e.y - py, d = Math.hypot(dx, dy);
    if (d >= R) continue;
    if (e.y > w.y - 4 && e.y < w.y + w.h + 4) {
      e.x = e.x < w.x + w.w / 2 ? w.x - R : w.x + w.w + R;
      if (e.x < R - 1 || e.x > G.W - R + 1) crushed = true;
    } else if (d > 0) { e.x += dx / d * (R - d); e.y += dy / d * (R - d); }
  }
  e.x = clamp(e.x, R, G.W - R);
  return crushed;
}
function enemiesOf(G, team) { return G.ents.filter(o => o.alive && o.team !== team); }
function nearestEnemy(G, e, maxd) { let best = null, bd = maxd || 1e9; for (const o of G.ents) if (o.alive && o.team !== e.team) { const d = dist(e, o); if (d < bd) { bd = d; best = o; } } return best; }
function superRange(e) { const a = e.b.sup.acts.find(x => x.range); return a ? a.range : e.b.atk.range; }

/* ---------- COMBAT ---------- */
function hurt(G, t, amount, own, noCharge) {
  if (!t.alive || G.over) return;
  if (t.shield > 0) amount *= .4;
  amount = Math.round(amount);
  t.hp -= amount; t.lastHit = G.t;
  G.ev.push({ k: 'hit', x: Math.round(t.x), y: Math.round(t.y), v: amount, id: t.id, team: t.team });
  if (own && !noCharge) own.sup = Math.min(1, own.sup + amount / own.supNeed);
  if (t.hp <= 0) kill(G, t, own);
}
function kill(G, t, k, crushed) {
  t.alive = false; t.hp = 0; t.resp = crushed ? 2 : 3; t.bursts = []; t.slow = t.shield = t.rage = 0;
  if (k) { k.kills++; G.kills[k.team]++; }
  G.ev.push({ k: 'burst', x: Math.round(t.x), y: Math.round(t.y), c: t.b.color, n: 30 });
  G.ev.push({ k: crushed ? 'crush' : 'kill', by: k ? k.id : -1, of: t.id, x: Math.round(t.x), y: Math.round(t.y) });
  for (let i = 0; i < t.coins; i++) { const a = rand(0, 6.283), r = rand(20, 70); G.coins.push({ id: ++G.coinId, x: clamp(t.x + Math.cos(a) * r, 30, G.W - 30), y: clamp(t.y + Math.sin(a) * r, 30, G.H - 30) }); }
  t.coins = 0;
}
function explode(G, x, y, rad, dmg, team, own, noCharge, slow, vis) {
  for (const o of enemiesOf(G, team)) if (Math.hypot(o.x - x, o.y - y) < rad + R * .6) { if (slow) o.slow = Math.max(o.slow, slow); hurt(G, o, dmg, own, noCharge); }
  G.ev.push({ k: 'boom', x: Math.round(x), y: Math.round(y), r: rad, v: vis || 0 });
}
function aimPoint(G, e, a, d, range) {
  const dd = clamp(d == null ? range : d, 40, range);
  return { x: clamp(e.x + Math.cos(a) * dd, 20, G.W - 20), y: clamp(e.y + Math.sin(a) * dd, 20, G.H - 20) };
}

function spawnShots(G, e, A, a, dmg, isSup) {
  const n = A.n || 1;
  for (let i = 0; i < n; i++) {
    let aa = a, ox = 0, oy = 0;
    if (A.ring) aa = a + i / n * Math.PI * 2;
    else if (A.par) { const o = (i - (n - 1) / 2) * A.par; ox = Math.cos(a + Math.PI / 2) * o; oy = Math.sin(a + Math.PI / 2) * o; }
    else if (n > 1) aa = a + (i / (n - 1) - .5) * (A.spread || 0);
    if (A.jit) aa += rand(-A.jit, A.jit);
    const bs = A.bs * (A.bsj ? rand(1 - A.bsj, 1) : 1), start = A.ring ? R * .5 : R;
    const b = { id: ++G.bid, x: e.x + Math.cos(aa) * start + ox, y: e.y + Math.sin(aa) * start + oy, vx: Math.cos(aa) * bs, vy: Math.sin(aa) * bs, bs,
      life: A.range / bs, dmg, team: e.team, own: e, r: A.r || 6, vis: A.vis || 0, sup: isSup ? 1 : 0, h: 0 };
    if (A.pierce || A.boomer) b.hit = new Set();
    if (A.pierce) b.pierce = 1;
    if (A.bounce) b.bounce = A.bounce;
    if (A.boomer) { b.boomer = 1; b.out = A.range / bs; b.age = 0; }
    if (A.homing) b.homing = A.homing;
    for (const k of ['split', 'chain', 'slow', 'drain', 'zone', 'boom']) if (A[k]) b[k] = A[k];
    G.bul.push(b);
  }
}
function beam(G, e, a, A, dmg, isSup) {
  const cos = Math.cos(a), sin = Math.sin(a);
  let len = A.range;
  if (!A.thru) for (let s = R; s < A.range; s += 10) { const x = e.x + cos * s, y = e.y + sin * s; if (x < 0 || y < 0 || x > G.W || y > G.H || hitWall(G, x, y)) { len = s; break; } }
  const hits = [];
  for (const o of enemiesOf(G, e.team)) {
    const dx = o.x - e.x, dy = o.y - e.y, t = dx * cos + dy * sin, p = Math.abs(-dx * sin + dy * cos);
    if (t > 0 && t < len + R && p < R + (A.w || 8) / 2) hits.push({ o, t });
  }
  hits.sort((p, q) => p.t - q.t);
  const list = A.pierce ? hits : hits.slice(0, 1);
  if (!A.pierce && list.length) len = list[0].t;
  for (const h of list) { if (A.slow) h.o.slow = Math.max(h.o.slow, A.slow); hurt(G, h.o, dmg, e, isSup); }
  G.ev.push({ k: 'beam', x1: Math.round(e.x), y1: Math.round(e.y), x2: Math.round(e.x + cos * len), y2: Math.round(e.y + sin * len), w: A.w || 8, v: A.vis || 0, team: e.team });
}
function fireSpec(G, e, A, a, d, isSup) {
  const dmg = Math.round((A.dmg || 0) * e.dm * (e.rage > 0 ? 1.25 : 1));
  switch (A.k) {
  case 'lob': {
    const p = aimPoint(G, e, a, d, A.range), dd = Math.hypot(p.x - e.x, p.y - e.y), T = A.flight || (.4 + dd / 1300);
    G.bul.push({ id: ++G.bid, lob: 1, sx: e.x, sy: e.y, tx: p.x, ty: p.y, t: 0, T, top: 70 + dd * .3, x: e.x, y: e.y, vx: (p.x - e.x) / T, vy: (p.y - e.y) / T,
      dmg, team: e.team, own: e, r: A.r || 10, vis: A.vis || 6, sup: isSup ? 1 : 0, h: 0, boom: A.boom, split: A.split, zone: A.zone });
    break; }
  case 'beam': beam(G, e, a, A, dmg, isSup); break;
  case 'punch': {
    for (const o of enemiesOf(G, e.team)) {
      const dx = o.x - e.x, dy = o.y - e.y, dd = Math.hypot(dx, dy);
      let da = Math.atan2(dy, dx) - a; da = Math.atan2(Math.sin(da), Math.cos(da));
      if (dd < A.range + R && (Math.abs(da) < A.arc || dd < R * 1.6)) hurt(G, o, dmg, e, isSup);
    }
    G.ev.push({ k: 'swing', x: Math.round(e.x), y: Math.round(e.y), a: Math.round(a * 100) / 100, r: A.range, arc: A.arc });
    if (A.slam) explode(G, e.x + Math.cos(a) * A.range * .75, e.y + Math.sin(a) * A.range * .75, A.slam, Math.round(dmg * .5), e.team, e, isSup, 0, 0);
    break; }
  case 'mine': {
    const mine = G.mines.filter(m => m.own === e);
    if (mine.length >= (A.max || 3)) G.mines.splice(G.mines.indexOf(mine[0]), 1);
    const p = aimPoint(G, e, a, d, A.range);
    G.mines.push({ id: ++G.bid, x: p.x, y: p.y, team: e.team, own: e, arm: .6, life: 14, dmg, rad: A.rad, sup: isSup ? 1 : 0 });
    break; }
  case 'minefield':
    for (let i = 0; i < A.n; i++) { const aa = i / A.n * Math.PI * 2; G.mines.push({ id: ++G.bid, x: clamp(e.x + Math.cos(aa) * A.ring, 20, G.W - 20), y: clamp(e.y + Math.sin(aa) * A.ring, 20, G.H - 20), team: e.team, own: e, arm: .4, life: 14, dmg, rad: A.rad, sup: 1 }); }
    break;
  case 'nova': explode(G, e.x, e.y, A.rad, dmg, e.team, e, isSup, A.slow, A.vis); break;
  case 'storm': {
    const foes = enemiesOf(G, e.team).filter(o => dist(o, e) < A.range);
    for (let i = 0; i < A.n; i++) {
      const f = foes.length ? foes[i % foes.length] : null, p = f ? { x: f.x + rand(-60, 60), y: f.y + rand(-60, 60) } : aimPoint(G, e, a + rand(-.5, .5), rand(.3, 1) * A.range, A.range);
      G.strikes.push({ x: clamp(p.x, 0, G.W), y: clamp(p.y, 0, G.H), t: .35 + i * .18, T: .35 + i * .18, rad: A.rad, dmg, team: e.team, own: e, vis: 8 });
    }
    break; }
  case 'meteor': { const p = aimPoint(G, e, a, d, A.range); G.strikes.push({ x: p.x, y: p.y, t: A.delay, T: A.delay, rad: A.rad, dmg, team: e.team, own: e, vis: 1, big: 1 }); break; }
  case 'heal':
    for (const o of G.ents) if (o.alive && o.team === e.team && (o === e || (A.rad && dist(o, e) < A.rad))) { o.hp = Math.min(o.maxhp, o.hp + o.maxhp * A.frac); G.ev.push({ k: 'heal', id: o.id, x: Math.round(o.x), y: Math.round(o.y) }); }
    break;
  case 'shield': for (const o of G.ents) if (o.alive && o.team === e.team && (o === e || (A.rad && dist(o, e) < A.rad))) o.shield = Math.max(o.shield, A.t); break;
  case 'rage': e.rage = A.t; break;
  default: spawnShots(G, e, A, a, dmg, isSup);
  }
  if (A.burst) e.bursts.push({ A, a, d, left: A.burst.n - 1, t: A.burst.gap, isSup });
}
function attack(G, e, a, d) {
  if (e.cd > 0 || !e.alive || G.start > 0 || G.over) return false;
  e.cd = e.b.atk.reload; e.lastShot = G.t; e.ang = a;
  fireSpec(G, e, e.b.atk, a, d, false);
  return true;
}
function useSuper(G, e, a, d) {
  if (!e.alive || e.sup < 1 || G.start > 0 || G.over) return false;
  e.sup = 0; e.lastShot = G.t; if (a != null) e.ang = a;
  G.ev.push({ k: 'super', id: e.id, x: Math.round(e.x), y: Math.round(e.y), c: e.b.color });
  for (const A of e.b.sup.acts) fireSpec(G, e, A, a == null ? e.ang : a, d, true);
  return true;
}
/* Auto aim used by the super button and by bots: nearest enemy in range, otherwise straight ahead. */
function autoAim(G, e, range) {
  const t = nearestEnemy(G, e, range * 1.1);
  return t ? { a: Math.atan2(t.y - e.y, t.x - e.x), d: dist(e, t) } : { a: e.ang, d: range * .8 };
}

function bulletEnd(G, b) {
  if (b.boom) explode(G, b.x, b.y, b.boom, b.dmg, b.team, b.own, b.sup, 0, b.vis);
  if (b.split) for (let i = 0; i < b.split.n; i++) {
    const aa = i / b.split.n * Math.PI * 2 + rand(0, .5);
    G.bul.push({ id: ++G.bid, x: b.x, y: b.y, vx: Math.cos(aa) * 600, vy: Math.sin(aa) * 600, bs: 600, life: b.split.range / 600, dmg: Math.round(b.split.dmg * b.own.dm), team: b.team, own: b.own, r: 5, vis: b.vis, sup: b.sup, h: 0 });
  }
  if (b.zone) G.zones.push({ x: b.x, y: b.y, r: b.zone.r, dps: b.zone.dps * b.own.dm, t: b.zone.t, tick: 0, team: b.team, own: b.own, vis: b.vis });
}
function onHit(G, b, o) {
  if (b.slow) o.slow = Math.max(o.slow, b.slow);
  hurt(G, o, b.dmg, b.own, b.sup);
  if (b.drain && b.own.alive) b.own.hp = Math.min(b.own.maxhp, b.own.hp + b.dmg * b.drain);
  if (b.chain) {
    const seen = new Set([o.id]); let cur = o, dmg = b.dmg;
    for (let j = 0; j < b.chain.n; j++) {
      let nx = null, bd = b.chain.rad;
      for (const q of enemiesOf(G, b.team)) if (!seen.has(q.id)) { const d = dist(q, cur); if (d < bd) { bd = d; nx = q; } }
      if (!nx) break;
      dmg *= b.chain.f; seen.add(nx.id);
      G.ev.push({ k: 'beam', x1: Math.round(cur.x), y1: Math.round(cur.y), x2: Math.round(nx.x), y2: Math.round(nx.y), w: 5, v: 8, team: b.team });
      hurt(G, nx, dmg, b.own, b.sup); cur = nx;
    }
  }
}

/* ---------- BOTS ---------- */
function aiUpdate(G, e, dt) {
  const a = e.ai, t = nearestEnemy(G, e); let mx = 0, my = 0;
  const d = t ? dist(e, t) : 1e9, range = e.b.atk.range;
  let goal = null;
  if (G.map === 'coins') {
    const myTeam = G.ents.filter(o => o.team === e.team).reduce((s, o) => s + o.coins, 0);
    if (e.coins >= 5 && e.hp < e.maxhp * .55) goal = { x: e.sx, y: e.sy };
    else if (G.coins.length && (!t || d > range * 1.1 || myTeam < 3)) { let bc = null, bd = 1e9; for (const c of G.coins) { const cd = dist(e, c); if (cd < bd) { bd = cd; bc = c; } } goal = bc; }
  }
  a.st -= dt; if (a.st <= 0) { a.st = rand(.8, 2); a.strafe = Math.random() < .5 ? -1 : 1; }
  if (G.map === 'rush') {
    // race forward, dodge the sliding walls
    const fwd = e.team ? 1 : -1; mx = 0; my = fwd;
    a.ct = (a.ct || 0) - dt; if (a.ct <= 0) { a.ct = 1; a.careless = Math.random() > e.skill * .9 + .1; }
    const near = a.careless ? [] : G.push.map(w => ({ w, ahead: (w.y + w.h / 2 - e.y) * fwd })).sort((p, q) => p.ahead - q.ahead);
    for (const { w, ahead } of near) {
      const inRow = e.y > w.y - R - 6 && e.y < w.y + w.h + R + 6;
      if (ahead < -R - 30 || ahead > 170) continue;
      const fx = w.x + w.dir * w.speed * .7, lo = Math.min(w.x, fx) - R - 25, hi = Math.max(w.x, fx) + w.w + R + 25;
      if (e.x > lo && e.x < hi) {
        if (inRow) { my = fwd; mx = 0; break; }               // already in the lane: rush through
        my = ahead > 0 ? -fwd * .25 : fwd;                    // wait before the lane
        mx = w.dir > 0 ? -1 : 1;                              // go behind the wall
        if ((mx < 0 && e.x < 90) || (mx > 0 && e.x > G.W - 90)) mx = -mx;
        break;
      }
    }
    if (a.careless) { mx = 0; my = fwd; }
    if (t && d < range * .8 && e.hp < e.maxhp * .4) my *= .5;
  } else if (goal) { const ga = Math.atan2(goal.y - e.y, goal.x - e.x); mx = Math.cos(ga); my = Math.sin(ga); }
  else if (t) {
    if (e.hp < e.maxhp * .3 && e.skill > .45 && d < range) { const ga = Math.atan2(e.sy - e.y, e.sx - e.x); mx = Math.cos(ga); my = Math.sin(ga); }
    else {
      const melee = e.b.atk.k === 'punch' || range < 280, ta = Math.atan2(t.y - e.y, t.x - e.x), want = melee ? range * .5 : range * .72, see = los(G, e, t) || e.b.atk.k === 'lob';
      let f = 0; if (!see || d > want + 40) f = 1; else if (d < want - 80) f = -1;
      if (melee && d > want) { mx = Math.cos(ta); my = Math.sin(ta); }
      else { mx = Math.cos(ta) * f + Math.cos(ta + Math.PI / 2) * a.strafe * .7; my = Math.sin(ta) * f + Math.sin(ta + Math.PI / 2) * a.strafe * .7; }
    }
  }
  if (a.unstick > 0) { a.unstick -= dt; mx = a.ux; my = a.uy; }
  const l = Math.hypot(mx, my); if (l > 0) { mx /= l; my /= l; }
  const sp = speedOf(e);
  e.x += mx * sp * dt; e.y += my * sp * dt; resolve(G, e);
  if (l > 0 && G.map !== 'rush' && Math.hypot(e.x - a.px, e.y - a.py) < sp * dt * .3) { const r = rand(0, 6.283); a.unstick = .5; a.ux = Math.cos(r); a.uy = Math.sin(r); }
  a.px = e.x; a.py = e.y;
  if (l > 0) e.ang = Math.atan2(my, mx);
  a.react -= dt;
  const k = e.b.atk.k, overWalls = k === 'lob' || k === 'mine';
  if (t && d < range * .95 && (overWalls || los(G, e, t))) {
    e.ang = Math.atan2(t.y - e.y, t.x - e.x);
    if (a.react <= 0 && e.cd <= 0) {
      const sp2 = e.b.atk.bs || 900, tt = (k === 'lob' ? .6 : k === 'beam' || k === 'punch' ? 0 : d / sp2) * e.skill, tx = t.x + (t._vx || 0) * tt, ty = t.y + (t._vy || 0) * tt;
      const ang = Math.atan2(ty - e.y, tx - e.x) + rand(-1, 1) * (1 - e.skill) * .45;
      if (attack(G, e, ang, Math.hypot(tx - e.x, ty - e.y))) a.react = rand(0, (1 - e.skill) * .7);
    }
  }
  if (e.sup >= 1) {
    const heals = e.b.sup.acts.some(x => x.k === 'heal' && x.rad === 0);
    const sr = superRange(e);
    if ((heals && e.hp < e.maxhp * .45) || (!heals && t && d < Math.min(sr, 520) * .85)) { const aim = autoAim(G, e, sr); useSuper(G, e, aim.a, aim.d); }
  }
}

function scores(G) {
  if (G.map === 'open') return G.kills.slice();
  if (G.map === 'rush') {
    const s = [0, 0];
    for (const e of G.ents) if (e.alive) { const p = Math.round(clamp((e.sy - e.y) / (e.sy - (e.team ? G.H - RUSH_GOAL : RUSH_GOAL)), 0, 1) * 100); if (p > s[e.team]) s[e.team] = p; }
    if (G.winner >= 0) s[G.winner] = 100;
    return s;
  }
  const s = [0, 0]; for (const e of G.ents) s[e.team] += e.coins; return s;
}

/* One simulation step. Returns true when the match is over. */
function step(G, dt) {
  if (G.over) return true;
  G.t += dt;
  if (G.rows) G.push = rushPush(G.map, G.W, G.H, G.t, G.rows);
  if (G.start > 0) { G.start -= dt; return false; }
  G.time -= dt;
  for (const e of G.ents) {
    const ox = e.x, oy = e.y;
    if (!e.alive) { e.resp -= dt; if (e.resp <= 0) { e.alive = true; e.hp = e.maxhp; e.x = e.sx; e.y = e.sy; e.lastHit = G.t; G.ev.push({ k: 'spawn', id: e.id }); } continue; }
    e.cd = Math.max(0, e.cd - dt * (e.rage > 0 ? 2 : 1));
    e.slow = Math.max(0, e.slow - dt); e.shield = Math.max(0, e.shield - dt); e.rage = Math.max(0, e.rage - dt);
    for (let i = e.bursts.length - 1; i >= 0; i--) { const q = e.bursts[i]; q.t -= dt; if (q.t <= 0) { const A = Object.assign({}, q.A, { burst: null }); fireSpec(G, e, A, q.a, q.d, q.isSup); q.left--; q.t = q.A.burst.gap; if (q.left <= 0) e.bursts.splice(i, 1); } }
    if (e.ctrl === 'ai') aiUpdate(G, e, dt);
    else if (e.ctrl === 'input') { const sp = speedOf(e); e.x += e.mx * sp * dt; e.y += e.my * sp * dt; resolve(G, e); }
    if (G.push.length && e.alive && pushResolve(G, e)) { kill(G, e, null, true); continue; }
    if (e.ctrl !== 'remote') { e._vx = (e.x - ox) / dt; e._vy = (e.y - oy) / dt; }
    if (G.t - e.lastHit > 3 && G.t - e.lastShot > 2.5 && e.hp < e.maxhp) e.hp = Math.min(e.maxhp, e.hp + e.maxhp * .13 * dt);
    if (G.map === 'rush' && G.winner < 0 && (e.team === 0 ? e.y <= RUSH_GOAL : e.y >= G.H - RUSH_GOAL)) G.winner = e.team;
  }
  // projectiles
  for (let i = G.bul.length - 1; i >= 0; i--) {
    const b = G.bul[i];
    if (b.lob) {
      b.t += dt; const f = Math.min(1, b.t / b.T);
      b.x = b.sx + (b.tx - b.sx) * f; b.y = b.sy + (b.ty - b.sy) * f; b.h = Math.sin(Math.PI * f) * b.top;
      if (f >= 1) { if (!b.boom) b.boom = 50; bulletEnd(G, b); G.bul.splice(i, 1); }
      continue;
    }
    if (b.homing) {
      let tg = null, bd = 420; for (const o of G.ents) if (o.alive && o.team !== b.team) { const d = Math.hypot(o.x - b.x, o.y - b.y); if (d < bd) { bd = d; tg = o; } }
      if (tg) { const cur = Math.atan2(b.vy, b.vx); let df = Math.atan2(tg.y - b.y, tg.x - b.x) - cur; df = Math.atan2(Math.sin(df), Math.cos(df)); const na = cur + clamp(df, -b.homing * dt, b.homing * dt); b.vx = Math.cos(na) * b.bs; b.vy = Math.sin(na) * b.bs; }
    }
    if (b.boomer) {
      b.age += dt;
      if (!b.back && b.age >= b.out) { b.back = 1; b.hit.clear(); }
      if (b.back) { const o = b.own, dx = o.x - b.x, dy = o.y - b.y, l = Math.hypot(dx, dy); if (!o.alive || l < R || b.age > b.out * 3) { G.bul.splice(i, 1); continue; } b.vx = dx / l * b.bs; b.vy = dy / l * b.bs; }
    }
    const ox = b.x, oy = b.y; b.x += b.vx * dt; b.y += b.vy * dt;
    let dead = false;
    if (!b.boomer) { b.life -= dt; if (b.life <= 0) dead = true; }
    const out = b.x < 0 || b.y < 0 || b.x > G.W || b.y > G.H;
    if (!dead && (out || hitWall(G, b.x, b.y))) {
      if (b.boomer) { if (!b.back) { b.back = 1; b.hit.clear(); } b.x = ox; b.y = oy; }
      else if (b.bounce > 0) {
        b.bounce--;
        const hx = out ? (b.x < 0 || b.x > G.W) : hitWall(G, b.x, oy), hy = out ? (b.y < 0 || b.y > G.H) : hitWall(G, ox, b.y);
        if (hx || !hy) b.vx = -b.vx; if (hy || !hx) b.vy = -b.vy;
        b.x = ox; b.y = oy; G.ev.push({ k: 'wall', x: Math.round(b.x), y: Math.round(b.y) });
      } else { dead = true; G.ev.push({ k: 'wall', x: Math.round(b.x), y: Math.round(b.y) }); }
    }
    if (!dead) for (const o of G.ents) {
      if (!o.alive || o.team === b.team || (b.hit && b.hit.has(o.id))) continue;
      if (Math.hypot(o.x - b.x, o.y - b.y) < R + b.r) {
        if (b.boom) { dead = true; break; }
        onHit(G, b, o);
        if (b.hit) b.hit.add(o.id); else { dead = true; break; }
      }
    }
    if (dead) { bulletEnd(G, b); G.bul.splice(i, 1); }
  }
  for (let i = G.zones.length - 1; i >= 0; i--) {
    const z = G.zones[i]; z.t -= dt; z.tick -= dt;
    if (z.tick <= 0) { z.tick = .5; for (const o of enemiesOf(G, z.team)) if (Math.hypot(o.x - z.x, o.y - z.y) < z.r + R * .5) hurt(G, o, z.dps * .5, z.own, true); }
    if (z.t <= 0) G.zones.splice(i, 1);
  }
  for (let i = G.mines.length - 1; i >= 0; i--) {
    const m = G.mines[i]; m.arm -= dt; m.life -= dt;
    let boom = false;
    if (m.arm <= 0) for (const o of enemiesOf(G, m.team)) if (Math.hypot(o.x - m.x, o.y - m.y) < R + 26) { boom = true; break; }
    if (boom) explode(G, m.x, m.y, m.rad, m.dmg, m.team, m.own, m.sup, 0, 6);
    if (boom || m.life <= 0) G.mines.splice(i, 1);
  }
  for (let i = G.strikes.length - 1; i >= 0; i--) {
    const s = G.strikes[i]; s.t -= dt;
    if (s.t <= 0) { explode(G, s.x, s.y, s.rad, s.dmg, s.team, s.own, true, 0, s.vis); G.strikes.splice(i, 1); }
  }
  if (G.map === 'coins') {
    G.coinT -= dt;
    if (G.coinT <= 0 && G.coins.length < 12) { G.coinT = 2.2; const a = rand(0, 6.283), r = rand(0, 70); G.coins.push({ id: ++G.coinId, x: G.W / 2 + Math.cos(a) * r, y: G.H / 2 + Math.sin(a) * r }); }
    for (let i = G.coins.length - 1; i >= 0; i--) { const c = G.coins[i]; for (const e of G.ents) if (e.alive && Math.hypot(e.x - c.x, e.y - c.y) < R + 14) { e.coins++; G.coins.splice(i, 1); break; } }
  }
  const sc = scores(G);
  if ((G.map === 'open' && (sc[0] >= G.target || sc[1] >= G.target)) || (G.map === 'rush' && G.winner >= 0) || G.time <= 0) { G.over = true; G.result = scores(G); return true; }
  return false;
}

/* Rewards for one player after a match. */
function rewards(res, kills, coinsHeld, map, wins, lvl) {
  let coins = res === 'w' ? 50 + kills * 8 + Math.min(60, wins * 2) : res === 'd' ? 25 + kills * 5 : 15 + kills * 5;
  if (map === 'coins') coins += coinsHeld * 3;
  if (map === 'rush' && res === 'w') coins += 20;
  const troph = lvl >= 30 ? (res === 'w' ? 10 : res === 'd' ? 2 : -4) : 0;
  return { coins, troph };
}
function pickBot(wins) {
  if (wins >= 35 && Math.random() < .25) return ROSTER[FOK];
  const hi = Math.min(28, 3 + wins), lo = Math.max(0, hi - 8);
  return ROSTER[Math.floor(rand(lo, hi + 1))];
}

const SHARED = { ROSTER, FOK, MAPS, MAP_NAMES, RUSH_GOAL, R, mult, enemyLvl, enemySkill, isPro, rand, clamp, dist, monthsSince,
  pickBot, createMatch, step, attack, useSuper, autoAim, superRange, resolve, pushResolve, rushPush, rushRows, nearestEnemy, scores, rewards, flags, speedOf };
if (typeof module !== 'undefined' && module.exports) module.exports = SHARED; else root.SHARED = SHARED;
})(typeof self !== 'undefined' ? self : this);
