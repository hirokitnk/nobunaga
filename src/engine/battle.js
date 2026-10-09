// 合戦（ヘックス戦術マップ）エンジン。UI に依存せず、AI同士の合戦も同じ処理で自動解決する。
import { rnd, makeRng } from './rng.js';
import { ASHIGARU, CAVALRY, GUNNER } from './const.js';

export const BW = 17;
export const BH = 13;
export const T = { PLAIN: 0, FOREST: 1, HILL: 2, MOUNT: 3, RIVER: 4, CASTLE: 5, HONMARU: 6, WALL: 7, GATE: 8, BREACH: 9 };
export const T_NAMES = ['平地', '森', '丘', '山', '川', '城内', '本丸', '城壁', '城門', '破れ門'];
const MOVE_COST = [
  [1, 2, 2, 3, 3, 1, 1, 99, 1, 1], // 足軽
  [1, 3, 2, 4, 3, 1, 1, 99, 1, 1], // 騎馬
  [1, 2, 2, 3, 3, 1, 1, 99, 1, 1], // 鉄砲
];
export const DEF_MOD = [1.0, 0.85, 0.8, 0.72, 1.2, 0.75, 0.65, 1, 0.7, 0.9];
export const MOVE_POINTS = [4, 6, 3];
export const TURNS_PER_DAY = 10;
export const MAX_TURN = 30;
export const WEATHER_NAMES = { sun: '晴', cloud: '曇', rain: '雨' };

// ── ヘックス座標（odd-r, 尖頂型） ──
export const idx = (c, r) => r * BW + c;
export const colOf = (i) => i % BW;
export const rowOf = (i) => Math.floor(i / BW);
export const CENTER = idx(8, 6);
const DIRS_EVEN = [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]];
const DIRS_ODD = [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]];
const NB = [];
for (let i = 0; i < BW * BH; i++) {
  const c = colOf(i), r = rowOf(i);
  const out = [];
  for (const [dc, dr] of r & 1 ? DIRS_ODD : DIRS_EVEN) {
    const nc = c + dc, nr = r + dr;
    if (nc >= 0 && nc < BW && nr >= 0 && nr < BH) out.push(idx(nc, nr));
  }
  NB.push(out);
}
export const neighbors = (i) => NB[i];
function cube(i) {
  const c = colOf(i), r = rowOf(i);
  const x = c - (r - (r & 1)) / 2;
  return [x, -x - r, r];
}
export function hexDist(a, b) {
  const A = cube(a), B = cube(b);
  return Math.max(Math.abs(A[0] - B[0]), Math.abs(A[1] - B[1]), Math.abs(A[2] - B[2]));
}
export function hexCenter(i) {
  const c = colOf(i), r = rowOf(i);
  return [Math.sqrt(3) * (c + 0.5 * (r & 1)), 1.5 * r];
}

// ── 地形生成（城ごとに固定） ──
export function genTerrain(castle) {
  const R = makeRng(castle.id * 7919 + 1013);
  const gw = 7, gh = 6;
  const g1 = Array.from({ length: gw * gh }, R);
  const g2 = Array.from({ length: gw * gh }, R);
  const sm = (t) => t * t * (3 - 2 * t);
  const sample = (g, c, r) => {
    const fx = (c / (BW - 1)) * (gw - 1), fy = (r / (BH - 1)) * (gh - 1);
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const x1 = Math.min(gw - 1, x0 + 1), y1 = Math.min(gh - 1, y0 + 1);
    const tx = sm(fx - x0), ty = sm(fy - y0);
    const a = g[y0 * gw + x0], b = g[y0 * gw + x1], c2 = g[y1 * gw + x0], d = g[y1 * gw + x1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c2 * (1 - tx) + d * tx) * ty;
  };
  const hilly = castle.def >= 500 ? 0.07 : 0;
  const tiles = new Array(BW * BH);
  for (let i = 0; i < tiles.length; i++) {
    const c = colOf(i), r = rowOf(i);
    const e = sample(g1, c, r) + hilly;
    const v = sample(g2, c, r);
    tiles[i] = e > 0.76 ? T.MOUNT : e > 0.63 ? T.HILL : v > 0.6 ? T.FOREST : T.PLAIN;
  }
  // 川
  if (R() < 0.55) {
    const vertical = R() < 0.5;
    let p = R() < 0.5 ? 1 + Math.floor(R() * 3) : (vertical ? BW : BH) - 2 - Math.floor(R() * 3);
    const len = vertical ? BH : BW;
    for (let k = 0; k < len; k++) {
      const i = vertical ? idx(p, k) : idx(k, p);
      if (hexDist(i, CENTER) >= 4) tiles[i] = T.RIVER;
      const step = R() < 0.3 ? (R() < 0.5 ? -1 : 1) : 0;
      const lim = vertical ? BW - 1 : BH - 1;
      p = Math.max(0, Math.min(lim, p + step));
    }
  }
  // 城郭
  const ring2 = [];
  const [cx, cy] = hexCenter(CENTER);
  for (let i = 0; i < tiles.length; i++) {
    const d = hexDist(i, CENTER);
    if (d === 0) tiles[i] = T.HONMARU;
    else if (d === 1) tiles[i] = T.CASTLE;
    else if (d === 2) {
      tiles[i] = T.WALL;
      ring2.push(i);
    } else if (d === 3 && (tiles[i] === T.MOUNT || tiles[i] === T.RIVER)) tiles[i] = T.HILL;
  }
  ring2.sort((a, b) => {
    const [ax, ay] = hexCenter(a), [bx, by] = hexCenter(b);
    return Math.atan2(ay - cy, ax - cx) - Math.atan2(by - cy, bx - cx);
  });
  // 門は内側の城内マス2つに接する辺の中央に置く（角だと一騎しか通れない隘路になるため）
  const sides = ring2.filter((i) => neighbors(i).filter((n) => hexDist(n, CENTER) === 1).length === 2);
  const off = Math.floor(R() * sides.length);
  const nGates = castle.def < 300 ? 4 : 3;
  const gates = [];
  for (let k = 0; k < nGates; k++) {
    const g = sides[(off + Math.round((k * sides.length) / nGates)) % sides.length];
    if (gates.includes(g)) continue;
    tiles[g] = T.GATE;
    gates.push(g);
  }
  return { tiles, gates };
}

// ── 合戦の生成 ──
// setup: { castle, castleObj, attClan, defClan, attackers:[{g, from, fromXY}], defenders:[g], reinf:[{g, from, fromXY}], playerSide, seed, month, clanColors }
export function createBattle(setup) {
  const castle = setup.castleObj;
  const { tiles, gates } = genTerrain(castle);
  const b = {
    castle: castle.id, castleName: castle.name, castleDef: castle.def,
    attClan: setup.attClan, defClan: setup.defClan,
    tiles, gateHp: {}, gateMax: Math.round(castle.def * 0.8) + 100,
    units: [], turn: 1, phase: 0, maxTurn: MAX_TURN,
    weather: [], rng: setup.seed >>> 0, log: [], captured: [], gateDamage: 0,
    playerSide: setup.playerSide ?? -1, result: null, month: setup.month,
  };
  for (const g of gates) b.gateHp[g] = b.gateMax;
  const rainP = setup.month === 6 || setup.month === 7 ? 0.4 : 0.18;
  for (let d = 0; d < 3; d++) {
    const r = rnd(b);
    b.weather.push(r < rainP ? 'rain' : r < rainP + 0.3 ? 'cloud' : 'sun');
  }

  // 守備側
  const defs = setup.defenders.slice();
  const lordIdx = Math.max(0, defs.findIndex((g) => g.id === castle.lord));
  if (defs.length) {
    const [lord] = defs.splice(lordIdx, 1);
    defs.unshift(lord);
  }
  const inner = [CENTER, ...neighbors(CENTER)];
  const slots = [...inner, ...gates];
  defs.forEach((g, k) => {
    const u = mkUnit(b, g, 1, castle.id);
    if (k === 0) u.leader = true;
    if (k < slots.length) u.tile = slots[k];
    else u.tile = freeNear(b, gates[k % gates.length], (i) => hexDist(i, CENTER) >= 3);
    u.garrison = true;
  });
  // 援軍・攻撃側（出発した城の方角から進入）
  const placeGroup = (list, side) => {
    const groups = new Map();
    for (const e of list) {
      if (!groups.has(e.from)) groups.set(e.from, []);
      groups.get(e.from).push(e);
    }
    for (const [, grp] of groups) {
      const entry = entryTile(b, grp[0].dir);
      for (const e of grp) {
        const u = mkUnit(b, e.g, side, e.from);
        u.tile = freeNear(b, entry, (i) => hexDist(i, CENTER) >= 4 && b.tiles[i] !== T.MOUNT);
      }
    }
  };
  placeGroup(setup.reinf || [], 1);
  placeGroup(setup.attackers, 0);
  const att = b.units.filter((u) => u.side === 0);
  if (att.length) att[0].leader = true;
  if (!b.units.some((u) => u.side === 1 && u.leader)) {
    const d = b.units.find((u) => u.side === 1);
    if (d) d.leader = true;
  }
  startPhase(b);
  return b;
}

function mkUnit(b, g, side, from) {
  const u = {
    id: b.units.length, gid: g.id, name: g.name, side, clan: g.clan, from,
    tile: -1, troops: g.troops, max: Math.max(1, g.troops), morale: g.morale, training: g.training,
    type: g.type, war: g.war, int: g.int, flags: g.flags, leader: false,
    acted: false, moved: false, confused: 0, state: 'alive', dmg: 0, garrison: false,
  };
  b.units.push(u);
  return u;
}

function entryTile(b, dir) {
  const [cx, cy] = hexCenter(CENTER);
  let best = 0, bv = -Infinity;
  const len = Math.hypot(dir[0], dir[1]) || 1;
  const dx = dir[0] / len, dy = dir[1] / len;
  for (let i = 0; i < BW * BH; i++) {
    const c = colOf(i), r = rowOf(i);
    if (c !== 0 && c !== BW - 1 && r !== 0 && r !== BH - 1) continue;
    const [x, y] = hexCenter(i);
    const v = (x - cx) * dx + (y - cy) * dy * 1.3;
    if (v > bv) {
      bv = v;
      best = i;
    }
  }
  return best;
}

function freeNear(b, start, ok) {
  const occ = occupancy(b);
  const seen = new Set([start]);
  const q = [start];
  while (q.length) {
    const i = q.shift();
    if (!occ.has(i) && b.tiles[i] !== T.WALL && b.tiles[i] !== T.GATE && ok(i)) return i;
    for (const n of neighbors(i)) if (!seen.has(n)) { seen.add(n); q.push(n); }
  }
  for (let i = 0; i < BW * BH; i++) if (!occ.has(i) && b.tiles[i] !== T.WALL && b.tiles[i] !== T.GATE) return i;
  return start;
}

// ── 参照 ──
export function occupancy(b) {
  const m = new Map();
  for (const u of b.units) if (u.state === 'alive') m.set(u.tile, u);
  return m;
}
export const unitAt = (b, i) => b.units.find((u) => u.state === 'alive' && u.tile === i);
export const aliveUnits = (b, side) => b.units.filter((u) => u.state === 'alive' && (side === undefined || u.side === side));
export const dayOf = (b) => Math.min(2, Math.floor((b.turn - 1) / TURNS_PER_DAY));
export const weatherNow = (b) => b.weather[dayOf(b)];
export const sideTroops = (b, side) => aliveUnits(b, side).reduce((a, u) => a + u.troops, 0);

function passable(b, u, i) {
  const t = b.tiles[i];
  if (t === T.WALL) return false;
  if (t === T.GATE) return u.side === 1;
  return true;
}

// 移動可能範囲（Dijkstra）。戻り値: Map(tile -> {cost, prev})
export function reachable(b, u) {
  const occ = occupancy(b);
  const zoc = new Set();
  for (const e of b.units) {
    if (e.state !== 'alive' || e.side === u.side) continue;
    for (const n of neighbors(e.tile)) zoc.add(n);
  }
  const mp = MOVE_POINTS[u.type];
  const res = new Map([[u.tile, { cost: 0, prev: -1 }]]);
  const buckets = Array.from({ length: mp + 1 }, () => []);
  buckets[0].push(u.tile);
  for (let cc = 0; cc <= mp; cc++) {
    for (const cur of buckets[cc]) {
      if (res.get(cur).cost !== cc) continue;
      if (cur !== u.tile && zoc.has(cur)) continue;
      for (const n of neighbors(cur)) {
        if (!passable(b, u, n)) continue;
        const o = occ.get(n);
        if (o && o.side !== u.side) continue;
        const c = cc + MOVE_COST[u.type][b.tiles[n]];
        if (c > mp) continue;
        const prev = res.get(n);
        if (!prev || c < prev.cost) {
          res.set(n, { cost: c, prev: cur });
          buckets[c].push(n);
        }
      }
    }
  }
  for (const [i] of res) if (i !== u.tile && occ.has(i)) res.delete(i);
  return res;
}

export function pathTo(reach, to) {
  const path = [];
  let cur = to;
  while (cur !== -1 && reach.has(cur)) {
    path.unshift(cur);
    cur = reach.get(cur).prev;
  }
  return path;
}

export function attackTargets(b, u) {
  const out = [];
  for (const n of neighbors(u.tile)) {
    const o = unitAt(b, n);
    if (o && o.side !== u.side) out.push({ unit: o });
    else if (!o && u.side === 0 && b.tiles[n] === T.GATE) out.push({ gate: n });
  }
  return out;
}

export function shootTargets(b, u) {
  if (u.type !== GUNNER || weatherNow(b) === 'rain') return [];
  return aliveUnits(b, 1 - u.side).filter((e) => hexDist(e.tile, u.tile) <= 2);
}

export const TACTICS = {
  rally: { name: '鼓舞', desc: '自部隊と隣接する味方の士気を回復', ok: (u) => u.war >= 60 },
  confuse: { name: '混乱', desc: '2マス以内の敵を混乱させ行動不能に', ok: (u) => u.int >= 60 },
  fire: { name: '火計', desc: '2マス以内の敵に火を放つ（雨天不可）', ok: (u) => u.int >= 70 },
  charge: { name: '突撃', desc: '騎馬隊の強襲。大打撃を与えるが反撃も大きい', ok: (u) => u.type === CAVALRY && u.war >= 65 },
};

export function tacticTargets(b, u, key) {
  if (!TACTICS[key].ok(u)) return [];
  if (key === 'rally') return [u];
  if (key === 'fire' && weatherNow(b) === 'rain') return [];
  if (key === 'charge') return attackTargets(b, u).filter((t) => t.unit).map((t) => t.unit);
  return aliveUnits(b, 1 - u.side).filter((e) => hexDist(e.tile, u.tile) <= 2);
}

const clampP = (p, a, b2) => Math.max(a, Math.min(b2, p));
export function tacticChance(b, u, key, t) {
  const nin = u.flags.includes('忍') ? 0.12 : 0;
  if (key === 'rally') return clampP(0.55 + u.war / 250, 0.1, 0.95);
  if (key === 'confuse') return clampP(0.35 + (u.int - t.int) / 100 + nin, 0.08, 0.9);
  if (key === 'fire') return clampP(0.4 + (u.int - t.int) / 120 + nin, 0.1, 0.85);
  return 1;
}

// ── 戦闘計算 ──
function power(u) {
  let p = u.troops * (0.6 + u.war / 125) * (0.7 + u.training / 333) * (0.45 + u.morale / 180);
  if (u.type === CAVALRY && u.flags.includes('騎')) p *= 1.15;
  if (u.type === GUNNER && u.flags.includes('鉄')) p *= 1.15;
  return p;
}
function defFactor(b, u) {
  const t = b.tiles[u.tile];
  let m = DEF_MOD[t];
  if (u.side === 1 && (t === T.CASTLE || t === T.HONMARU || t === T.GATE)) m *= 1 - Math.min(0.25, b.castleDef / 3200);
  if (u.confused > 0) m *= 1.2;
  return m;
}
const rr = (b, lo, hi) => lo + rnd(b) * (hi - lo);

function meleeRaw(b, a, d, charge, rand = true) {
  let m = 0.15;
  const td = b.tiles[d.tile];
  if (a.type === CAVALRY) m *= td === T.PLAIN || td === T.HILL ? 1.25 : td === T.FOREST || td === T.MOUNT || td === T.RIVER ? 0.85 : 0.95;
  if (a.type === GUNNER) m *= 0.6;
  if (d.type === GUNNER) m *= 1.25;
  if (a.type === CAVALRY && d.type === ASHIGARU) m *= 0.92;
  if (charge) m *= 1.6;
  return power(a) * m * defFactor(b, d) * (rand ? rr(b, 0.85, 1.15) : 1);
}
function gunRaw(b, a, d, rand = true) {
  return a.troops * 0.16 * (0.7 + a.war / 300 + a.int / 300) * (0.7 + a.training / 333) * (0.6 + a.morale / 250)
    * defFactor(b, d) * (a.flags.includes('鉄') ? 1.2 : 1) * (rand ? rr(b, 0.85, 1.15) : 1);
}

function applyDamage(b, t, dmg, src, melee) {
  dmg = Math.max(1, Math.min(t.troops, Math.round(dmg)));
  t.troops -= dmg;
  if (src) src.dmg += dmg;
  t.morale = Math.max(0, Math.round(t.morale - (dmg / (t.troops + dmg)) * 70 - 1));
  if (t.troops <= 0) {
    t.state = 'dead';
    t.troops = 0;
    if (src) {
      const roll = rnd(b);
      if (roll < 0.04) {
        t.killed = true;
        b.log.push(`${t.name}、討死！`);
      } else if (roll < 0.04 + (melee ? 0.3 + src.int / 500 : 0.15)) {
        b.captured.push({ gid: t.gid, side: src.side, clan: src.clan });
        t.captured = true;
        b.log.push(`${t.name}を捕縛した！`);
      } else b.log.push(`${t.name}隊、壊滅。`);
    }
  } else if (t.morale <= 0) {
    t.state = 'routed';
    b.log.push(`${t.name}隊は潰走した。`);
  }
  return dmg;
}

function done(b, u) {
  u.acted = true;
  u.moved = true;
  checkEnd(b);
}

export function moveUnit(b, u, to) {
  const reach = reachable(b, u);
  if (!reach.has(to) || u.moved || u.acted) return null;
  const path = pathTo(reach, to);
  u.tile = to;
  u.moved = true;
  const ev = { kind: 'move', unit: u.id, path };
  checkEnd(b);
  return ev;
}

export function doAttack(b, u, target, charge = false) {
  if (target.gate !== undefined) {
    const g = target.gate;
    const m = u.type === CAVALRY ? 0.5 : u.type === GUNNER ? 0.3 : 1;
    const dmg = Math.round(power(u) * 0.025 * m * rr(b, 0.85, 1.15));
    damageGate(b, g, dmg);
    u.dmg += Math.round(dmg / 3);
    b.log.push(`${u.name}隊が城門を攻撃（耐久-${dmg}）${b.tiles[g] === T.BREACH ? '　城門が破られた！' : ''}`);
    done(b, u);
    return { kind: 'gate', unit: u.id, tile: g, dmg };
  }
  const d = target.unit ?? target;
  const onGate = b.tiles[d.tile] === T.GATE ? d.tile : -1;
  const dmg = applyDamage(b, d, meleeRaw(b, u, d, charge), u, true);
  if (onGate >= 0 && u.side === 0) damageGate(b, onGate, Math.round(dmg * 0.25));
  let counter = 0;
  if (d.state === 'alive' && d.confused <= 0) {
    counter = applyDamage(b, u, meleeRaw(b, d, u, false) * 0.45 * (charge ? 1.2 : 1), d, true);
  }
  if (u.state === 'alive' && dmg > counter) u.morale = Math.min(100, u.morale + 2);
  b.log.push(`${u.name}隊${charge ? 'の突撃' : 'が攻撃'}　${d.name}隊に${dmg}の損害${counter ? `（反撃${counter}）` : ''}`);
  done(b, u);
  return { kind: 'attack', unit: u.id, target: d.id, dmg, counter, charge };
}

function damageGate(b, g, dmg) {
  if (b.tiles[g] !== T.GATE) return;
  b.gateHp[g] = Math.max(0, b.gateHp[g] - dmg);
  b.gateDamage += dmg;
  if (b.gateHp[g] <= 0) {
    b.tiles[g] = T.BREACH;
    b.log.push('城門が破られた！');
  }
}

export function doShoot(b, u, d) {
  const dmg = applyDamage(b, d, gunRaw(b, u, d), u, false);
  if (d.state === 'alive') d.morale = Math.max(0, d.morale - 4);
  b.log.push(`${u.name}隊の鉄砲射撃　${d.name}隊に${dmg}の損害`);
  done(b, u);
  return { kind: 'shoot', unit: u.id, target: d.id, dmg };
}

export function doTactic(b, u, key, t) {
  if (key === 'charge') return doAttack(b, u, { unit: t }, true);
  const p = tacticChance(b, u, key, t);
  const ok = rnd(b) < p;
  const name = TACTICS[key].name;
  let ev = { kind: 'tactic', key, unit: u.id, target: t.id, ok };
  if (!ok) {
    b.log.push(`${u.name}の${name}は失敗した。`);
  } else if (key === 'rally') {
    const amt = Math.round(12 + u.war / 8);
    const affected = [u, ...neighbors(u.tile).map((n) => unitAt(b, n)).filter((o) => o && o.side === u.side)];
    for (const a of affected) a.morale = Math.min(100, a.morale + amt);
    b.log.push(`${u.name}の鼓舞！　士気が${amt}上がった。`);
  } else if (key === 'confuse') {
    t.confused = u.int - t.int >= 20 ? 2 : 1;
    b.log.push(`${u.name}の計略で${t.name}隊は混乱した！`);
  } else if (key === 'fire') {
    const dmg = applyDamage(b, t, t.troops * (0.07 + u.int / 1200) * rr(b, 0.9, 1.1), u, false);
    if (t.state === 'alive') t.morale = Math.max(0, t.morale - 12);
    b.log.push(`${u.name}の火計！　${t.name}隊に${dmg}の損害`);
    ev.dmg = dmg;
  }
  done(b, u);
  return ev;
}

export function waitUnit(b, u) {
  u.acted = true;
  u.moved = true;
  return { kind: 'wait', unit: u.id };
}

export function retreat(b, side) {
  for (const u of aliveUnits(b, side)) u.state = 'retreated';
  b.log.push(side === 0 ? '攻撃軍は撤退した。' : '守備軍は城を捨てて落ち延びた。');
  finish(b, 1 - side, side === 0 ? '攻撃軍撤退' : '城を放棄');
}

function finish(b, winner, reason) {
  if (!b.result) b.result = { winner, reason };
  return b.result;
}

export function checkEnd(b) {
  if (b.result) return b.result;
  if (aliveUnits(b, 0).some((u) => u.tile === CENTER)) return finish(b, 0, '本丸を制圧');
  const A = aliveUnits(b, 0), D = aliveUnits(b, 1);
  if (!A.length) return finish(b, 1, '攻撃軍壊滅');
  const al = b.units.find((u) => u.side === 0 && u.leader);
  if (al && al.state !== 'alive') return finish(b, 1, '総大将敗走');
  if (!D.length) return finish(b, 0, '守備軍壊滅');
  const dl = b.units.find((u) => u.side === 1 && u.leader);
  if (dl && dl.state !== 'alive') return finish(b, 0, '城主敗走');
  if (b.turn > b.maxTurn) return finish(b, 1, '攻撃軍は兵糧が尽き撤退');
  return null;
}

export function startPhase(b) {
  b.retreatChecked = false;
  for (const u of aliveUnits(b, b.phase)) {
    u.acted = u.confused > 0;
    u.moved = u.acted;
  }
}

export function endPhase(b) {
  for (const u of aliveUnits(b, b.phase)) if (u.confused > 0) u.confused--;
  if (b.phase === 0) b.phase = 1;
  else {
    b.phase = 0;
    b.turn++;
    if ((b.turn - 1) % TURNS_PER_DAY === 0 && b.turn <= b.maxTurn) {
      b.log.push(`── ${dayOf(b) + 1}日目（${WEATHER_NAMES[weatherNow(b)]}） ──`);
      for (const u of aliveUnits(b)) u.morale = Math.min(100, u.morale + 5);
    }
  }
  if (!checkEnd(b)) startPhase(b);
}

// ── 合戦AI ──
function distField(b, side) {
  const breaches = Object.keys(b.gateHp).filter((g) => b.tiles[g] === T.BREACH).length;
  const key = `${b.turn}:${b.phase}:${side}:${breaches}`;
  if (b._df && b._df.key === key) return b._df.dist;
  const targets = [];
  if (side === 0) {
    if (breaches) targets.push(CENTER);
    else for (const g of Object.keys(b.gateHp).map(Number)) for (const n of neighbors(g)) if (hexDist(n, CENTER) === 3) targets.push(n);
    for (const e of aliveUnits(b, 1)) if (hexDist(e.tile, CENTER) >= 3) for (const n of neighbors(e.tile)) targets.push(n);
  } else {
    for (const e of aliveUnits(b, 0)) for (const n of neighbors(e.tile)) targets.push(n);
  }
  const N = BW * BH;
  const dist = new Float32Array(N).fill(999);
  const fake = { side, type: ASHIGARU };
  let buckets = [[]];
  for (const t of targets) if (dist[t] > 0 && passable(b, fake, t)) { dist[t] = 0; buckets[0].push(t); }
  for (let cc = 0; cc < buckets.length; cc++) {
    const list = buckets[cc];
    if (!list) continue;
    for (const cur of list) {
      if (dist[cur] !== cc) continue;
      const step = MOVE_COST[0][b.tiles[cur]];
      for (const n of neighbors(cur)) {
        if (!passable(b, fake, n)) continue;
        const c = cc + step;
        if (c < dist[n]) {
          dist[n] = c;
          (buckets[c] ??= []).push(n);
        }
      }
    }
  }
  b._df = { key, dist };
  return dist;
}

function inCastle(i) {
  return hexDist(i, CENTER) <= 2;
}

// 行動の価値（敵に与える損害を兵数換算した期待値）
function targetValue(b, u, t, kind) {
  const dmg = Math.min(t.troops, kind === 'shoot' ? gunRaw(b, u, t, false) : meleeRaw(b, u, t, kind === 'charge', false));
  let v = dmg + (dmg >= t.troops ? t.troops * 0.5 + 150 : 0) + (t.leader ? dmg * 0.8 : 0);
  if (kind !== 'shoot' && t.confused <= 0) {
    const counter = meleeRaw(b, t, u, false, false) * 0.45 * (kind === 'charge' ? 1.2 : 1);
    v -= counter * (u.leader && aliveUnits(b, u.side).length > 1 ? 2.2 : 0.9);
  }
  return v;
}

function bestAction(b, u) {
  const opts = [];
  for (const t of shootTargets(b, u)) opts.push({ v: targetValue(b, u, t, 'shoot'), run: () => doShoot(b, u, t) });
  for (const t of attackTargets(b, u)) {
    if (t.unit) opts.push({ v: targetValue(b, u, t.unit, 'melee') * (u.type === GUNNER ? 0.6 : 1), run: () => doAttack(b, u, t) });
    else {
      const m = u.type === CAVALRY ? 0.5 : u.type === GUNNER ? 0.3 : 1;
      opts.push({ v: power(u) * 0.025 * m * 1.6, run: () => doAttack(b, u, t) });
    }
  }
  for (const key of Object.keys(TACTICS)) {
    for (const t of tacticTargets(b, u, key)) {
      const p = tacticChance(b, u, key, t);
      let v = 0;
      if (key === 'rally') {
        const near = [u, ...neighbors(u.tile).map((n) => unitAt(b, n)).filter((o) => o && o.side === u.side)];
        v = p * near.reduce((a, o) => a + Math.max(0, 60 - o.morale) * o.troops * 0.004, 0);
      } else if (key === 'confuse') {
        if (t.confused > 0) continue;
        const threat = meleeRaw(b, t, u, false, false);
        v = p * threat * (hexDist(t.tile, u.tile) <= 1 ? 0.7 : 0.35);
      } else if (key === 'fire') v = p * t.troops * (0.07 + u.int / 1200);
      else if (key === 'charge') v = targetValue(b, u, t, 'charge');
      if (v > 0) opts.push({ v, run: () => doTactic(b, u, key, t) });
    }
  }
  opts.sort((a, c) => c.v - a.v);
  return opts[0] && opts[0].v > 5 ? opts[0] : null;
}

function scoreTile(b, u, tile, dist, occ) {
  let sc = 0;
  const terr = b.tiles[tile];
  const enemiesAdj = neighbors(tile).map((n) => occ.get(n)).filter((o) => o && o.side !== u.side && o.id !== u.id);
  const shootable = u.type === GUNNER && weatherNow(b) !== 'rain'
    ? aliveUnits(b, 1 - u.side).filter((e) => hexDist(e.tile, tile) <= 2).length : 0;
  if (u.side === 0) {
    sc -= dist[tile] * 1.6;
    const cautious = u.leader && aliveUnits(b, 0).length > 1;
    if (cautious) sc -= enemiesAdj.length * 6 + (dist[tile] < 3 ? 4 : 0);
    else sc += enemiesAdj.length ? 2.5 : 0;
    if (neighbors(tile).some((n) => b.tiles[n] === T.GATE)) sc += 3;
    for (const n of neighbors(tile)) { const o = occ.get(n); if (o && o.side === 0 && o.id !== u.id) sc -= 0.8; }
  } else if (u.garrison) {
    if (!inCastle(tile) || terr === T.WALL) sc -= 30;
    if (u.leader) sc += tile === CENTER ? 50 : -10;
    sc += enemiesAdj.length ? 2 : 0;
    if (terr === T.GATE) sc += 1.5;
  } else {
    sc -= dist[tile] * 1.3;
    sc += enemiesAdj.length ? 2 : 0;
  }
  sc += (1 - DEF_MOD[terr]) * 8;
  if (u.type === GUNNER) sc += (shootable ? 6 : 0) - enemiesAdj.length * 4;
  if (u.troops < u.max * 0.3 && !u.leader) sc -= enemiesAdj.length * 3;
  return sc;
}

function shouldRetreat(b) {
  if (b.turn < 8) return false;
  const a = sideTroops(b, 0), d = sideTroops(b, 1);
  const al = b.units.find((u) => u.side === 0 && u.leader);
  return a < d * 0.45 || (al && al.state === 'alive' && al.troops < al.max * 0.15);
}

// AI が1部隊ぶん行動する。行動する部隊がもういなければ null
export function aiStep(b) {
  if (b.result) return null;
  const side = b.phase;
  if (side === 0 && !b.retreatChecked) {
    b.retreatChecked = true;
    if (shouldRetreat(b)) {
      retreat(b, 0);
      return { kind: 'retreat', side: 0 };
    }
  }
  const ready = aliveUnits(b, side).filter((u) => !u.acted);
  if (!ready.length) return null;
  const dist = distField(b, side);
  ready.sort((a, c) => (c.type === GUNNER) - (a.type === GUNNER) || a.leader - c.leader || dist[a.tile] - dist[c.tile]);
  const u = ready[0];
  const events = [];
  // その場で有効な攻撃があり、移動の利が薄ければそのまま攻撃
  const here = bestAction(b, u);
  if (!u.moved) {
    const reach = reachable(b, u);
    const occ = occupancy(b);
    let bestTile = u.tile, bs = scoreTile(b, u, u.tile, dist, occ) + (here ? Math.min(6, (here.v / Math.max(200, u.troops)) * 30) : 0);
    for (const [t] of reach) {
      if (t === u.tile) continue;
      occ.delete(u.tile);
      const s2 = scoreTile(b, u, t, dist, occ);
      occ.set(u.tile, u);
      if (s2 > bs + 0.5) { bs = s2; bestTile = t; }
    }
    if (bestTile !== u.tile) events.push(moveUnit(b, u, bestTile));
  }
  if (!b.result && u.state === 'alive' && !u.acted) {
    const act = bestAction(b, u);
    events.push(act ? act.run() : waitUnit(b, u));
  }
  if (u.state === 'alive' && !u.acted) waitUnit(b, u);
  return { kind: 'ai', unit: u.id, events: events.filter(Boolean) };
}

// 自軍側の残り部隊をAIに任せる
export function aiFinishPhase(b) {
  let guard = 0;
  while (!b.result && aiStep(b) && guard++ < 50);
}

export function autoResolve(b) {
  let guard = 0;
  while (!b.result && guard++ < 200) {
    aiFinishPhase(b);
    if (!b.result) endPhase(b);
  }
  if (!b.result) finish(b, 1, '決着つかず');
  return b.result;
}
