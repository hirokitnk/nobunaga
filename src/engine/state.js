// ゲーム状態の生成と、全体で使う参照・更新ヘルパー
import { CASTLE_ROWS } from '../data/castles.js';
import { ADJACENCY } from '../data/adjacency.js';
import { CLAN_ROWS, RELATION_ROWS } from '../data/clans.js';
import { GENERAL_ROWS } from '../data/generals.js';
import { project } from '../data/geo.js';
import { rnd, rint, pick } from './rng.js';
import { START_YEAR, START_MONTH, RANK_CAP, MERIT_REQ, CAVALRY, GUNNER, ASHIGARU } from './const.js';

export function newGame({ player = '織田', seed, difficulty = 1 } = {}) {
  seed = (seed ?? Math.floor(Math.random() * 2 ** 31)) >>> 0;
  const s = {
    v: 1, seed, rng: seed, year: START_YEAR, month: START_MONTH, difficulty,
    phase: 'begin', order: [], orderPos: 0,
    clans: [], castles: [], gens: [], rel: {}, corps: [],
    log: [], news: [], over: null, ricePrice: 40, player: -1, turnCount: 0,
  };
  const clanIdx = new Map();
  CLAN_ROWS.forEach(([key, color, kamon], i) => {
    s.clans.push({ id: i, key, name: key, color, kamon, daimyo: -1, alive: true, gold: 0, rice: 0, home: -1 });
    clanIdx.set(key, i);
  });

  const castleIdx = new Map();
  CASTLE_ROWS.forEach((r, i) => {
    const [key, name, prov, lon, lat, owner, koku, shogyo, def, flags] = r;
    const [x, y] = project(lon, lat);
    s.castles.push({
      id: i, key, name, prov, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10,
      owner: owner ? clanIdx.get(owner) : -1,
      koku, kokuMax: Math.round((koku * 1.8) / 10) * 10,
      shogyo, shogyoMax: Math.round((shogyo * 2 + 120) / 10) * 10,
      def, defMax: Math.max(400, Math.round((def * 1.6) / 10) * 10),
      chu: 55 + rint(s, 0, 15), pool: koku * 8,
      port: flags.includes('p'), snow: flags.includes('s'),
      adj: [], lord: -1,
    });
    castleIdx.set(key, i);
  });
  for (const [a, b] of ADJACENCY) {
    const i = castleIdx.get(a), j = castleIdx.get(b);
    s.castles[i].adj.push(j);
    s.castles[j].adj.push(i);
  }

  GENERAL_ROWS.forEach((r, i) => {
    const [name, clanKey, castleKey, birth, death, pol, war, int, amb, duty, rank, flags = '', appear] = r;
    const clan = clanKey ? clanIdx.get(clanKey) : -1;
    const app = appear ?? birth + 15;
    const g = {
      id: i, name, clan, castle: -1, birth,
      life: Math.max(START_YEAR + 1, death + rint(s, 0, 2)),
      appear: app, pol, war, int, amb, duty, rank,
      kin: flags.includes('k'), flags: flags.replace('k', ''),
      loyalty: 0, merit: 0, troops: 0, training: 30, morale: 70, type: ASHIGARU,
      acted: false, status: 'unborn', origin: clan,
      originCastle: castleKey === '*' ? -1 : castleIdx.get(castleKey),
    };
    if (castleKey !== '*' && g.originCastle === undefined) throw new Error(`城が見つかりません: ${name} ${castleKey}`);
    s.gens.push(g);
  });

  // 本拠＝大名の居城
  for (const g of s.gens) {
    if (g.rank === 5 && g.clan >= 0) {
      s.clans[g.clan].daimyo = g.id;
      s.clans[g.clan].home = g.originCastle;
    }
  }
  for (const g of s.gens) if (g.originCastle === -1) g.originCastle = g.clan >= 0 ? s.clans[g.clan].home : 0;

  for (const g of s.gens) {
    if (g.appear > START_YEAR) continue;
    if (g.clan >= 0) activateGen(s, g, g.clan, g.originCastle, true);
    else makeRonin(s, g, g.originCastle);
  }

  for (const c of s.clans) {
    const n = s.castles.filter((x) => x.owner === c.id).length;
    c.gold = 300 + 150 * n;
    c.rice = 800 + 400 * n;
  }
  for (const [a, b, f, ally] of RELATION_ROWS) {
    const r = rel(s, clanIdx.get(a), clanIdx.get(b));
    r.f = f;
    r.ally = ally;
  }
  for (const c of s.castles) refreshLord(s, c.id);
  s.player = clanIdx.get(player);
  if (s.player === undefined) throw new Error(`大名家が見つかりません: ${player}`);
  return s;
}

// 武将を大名家に加える（元服・初期配置）
export function activateGen(s, g, clan, castle, initial = false) {
  g.status = 'active';
  g.clan = clan;
  g.castle = castle;
  g.acted = false;
  if (initial) {
    g.troops = Math.round((RANK_CAP[g.rank] * (0.3 + rnd(s) * 0.25)) / 100) * 100;
    g.training = 40 + rint(s, 0, 30);
    g.merit = MERIT_REQ[Math.min(g.rank, 4)] + rint(s, 0, 150);
    if (g.flags.includes('騎')) g.type = CAVALRY;
    else if (g.flags.includes('鉄') && rnd(s) < 0.6) g.type = GUNNER;
  } else {
    g.troops = 0;
    g.training = 30;
    g.merit = 0;
  }
  g.morale = 70;
  g.loyalty = g.kin ? 100 : clamp(Math.round(55 + g.duty * 0.35 + rint(s, 0, 10)), 0, 100);
}

export function makeRonin(s, g, castle) {
  g.status = 'ronin';
  g.clan = -1;
  g.castle = castle;
  g.rank = Math.min(g.rank, 4);
  if (g.rank === 5) g.rank = 4;
  g.troops = 0;
  g.loyalty = 0;
  g.kin = false;
  g.acted = false;
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const round100 = (v) => Math.round(v / 100) * 100;

// ── 外交関係 ──
export const relKey = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
export function rel(s, a, b) {
  const k = relKey(a, b);
  return (s.rel[k] ??= { f: 40, ally: false, truce: 0 });
}
export function isHostile(s, a, b) {
  if (a === b) return false;
  if (a < 0 || b < 0) return true;
  const r = rel(s, a, b);
  return !r.ally && r.truce <= 0;
}
export function addFriend(s, a, b, d) {
  if (a < 0 || b < 0 || a === b) return;
  const r = rel(s, a, b);
  r.f = clamp(Math.round(r.f + d), 0, 100);
}

// ── 参照 ──
export const clanCastles = (s, c) => s.castles.filter((x) => x.owner === c);
export const clanGens = (s, c) => s.gens.filter((g) => g.status === 'active' && g.clan === c);
export const castleGens = (s, cid) => {
  const o = s.castles[cid].owner;
  return s.gens.filter((g) => g.status === 'active' && g.castle === cid && g.clan === o);
};
export const roninAt = (s, cid) => s.gens.filter((g) => g.status === 'ronin' && g.castle === cid);
export const capOf = (g) => RANK_CAP[g.rank];
export const ageOf = (s, g) => s.year - g.birth;
export const isDaimyo = (s, g) => g.clan >= 0 && s.clans[g.clan].daimyo === g.id;
export function genPower(g) {
  return g.troops * (0.6 + g.war / 125) * (0.7 + g.training / 333) * (0.45 + g.morale / 180);
}
export function clanTroops(s, c) {
  let t = 0;
  for (const g of s.gens) if (g.status === 'active' && g.clan === c) t += g.troops;
  return t;
}
export function clanPowerScore(s, c) {
  let p = 0;
  for (const g of s.gens) if (g.status === 'active' && g.clan === c) p += genPower(g);
  return p;
}
export function castleDefensePower(s, cid) {
  const c = s.castles[cid];
  let p = 0;
  for (const g of castleGens(s, cid)) p += genPower(g);
  return p * (1 + c.def / 900);
}
export function neighborsClans(s, c) {
  const set = new Set();
  for (const ca of s.castles) {
    if (ca.owner !== c) continue;
    for (const a of ca.adj) {
      const o = s.castles[a].owner;
      if (o >= 0 && o !== c) set.add(o);
    }
  }
  return [...set];
}
// 自領の城だけを通って到達できる城（移動用）
export function reachableOwn(s, from, clan) {
  const seen = new Set([from]);
  const q = [from];
  while (q.length) {
    const c = q.shift();
    for (const a of s.castles[c].adj) {
      if (!seen.has(a) && s.castles[a].owner === clan) {
        seen.add(a);
        q.push(a);
      }
    }
  }
  seen.delete(from);
  return [...seen];
}
// 各自城から敵城までの距離（前線=0）
export function frontDistance(s, clan) {
  const dist = new Map();
  const q = [];
  for (const c of s.castles) {
    if (c.owner !== clan) continue;
    if (c.adj.some((a) => isHostile(s, clan, s.castles[a].owner))) {
      dist.set(c.id, 0);
      q.push(c.id);
    }
  }
  while (q.length) {
    const c = q.shift();
    for (const a of s.castles[c].adj) {
      if (s.castles[a].owner === clan && !dist.has(a)) {
        dist.set(a, dist.get(c) + 1);
        q.push(a);
      }
    }
  }
  return dist;
}

export function refreshLord(s, cid) {
  const c = s.castles[cid];
  if (c.owner < 0) {
    c.lord = -1;
    return;
  }
  const gens = castleGens(s, cid);
  if (!gens.length) {
    c.lord = -1;
    return;
  }
  const dm = s.clans[c.owner].daimyo;
  gens.sort((a, b) => (b.id === dm) - (a.id === dm) || b.rank - a.rank || b.merit - a.merit);
  c.lord = gens[0].id;
}

export function dateStr(s) {
  return `${s.year}年${s.month}月`;
}

export function addNews(s, text, kind = 'info') {
  const e = { y: s.year, m: s.month, text, kind };
  s.log.push(e);
  if (s.log.length > 400) s.log.splice(0, s.log.length - 400);
  s.news.push(e);
  if (s.news.length > 80) s.news.splice(0, s.news.length - 80);
}

// 名字（新しい家名用）。名は2文字が大半なので末尾2文字を取り除く
const FAMILY_EXCEPTIONS = { 風魔小太郎: '風魔', 教如: '本願寺', 沢彦宗恩: '沢彦' };
export function familyName(name) {
  if (FAMILY_EXCEPTIONS[name]) return FAMILY_EXCEPTIONS[name];
  return name.length >= 3 ? name.slice(0, name.length - 2) : name;
}

// ── 状態変更 ──
export function moveGen(s, g, cid) {
  const from = g.castle;
  g.castle = cid;
  if (from >= 0) refreshLord(s, from);
  refreshLord(s, cid);
}

export function setOwner(s, cid, clan) {
  const c = s.castles[cid];
  c.owner = clan;
  for (const co of s.corps) co.castles = co.castles.filter((x) => x !== cid);
  refreshLord(s, cid);
}

// 大名家の最寄りの城（なければ -1）
export function nearestOwnCastle(s, clan, fromCid) {
  let best = -1, bd = Infinity;
  const f = s.castles[fromCid];
  for (const c of s.castles) {
    if (c.owner !== clan || c.id === fromCid) continue;
    const d = Math.hypot(c.x - f.x, c.y - f.y) - (f.adj.includes(c.id) ? 1000 : 0);
    if (d < bd) {
      bd = d;
      best = c.id;
    }
  }
  return best;
}

// 家督相続。後継者がいなければ断絶
export function succession(s, clanId) {
  const clan = s.clans[clanId];
  const cands = clanGens(s, clanId).filter((g) => g.id !== clan.daimyo && s.year - g.birth >= 12);
  if (!cands.length) {
    destroyClan(s, clanId, -1, '後継者なく断絶');
    return null;
  }
  cands.sort((a, b) => (b.kin - a.kin) || (b.rank - a.rank) || (b.pol + b.war + b.int + b.merit / 50) - (a.pol + a.war + a.int + a.merit / 50));
  const heir = cands[0];
  const old = clan.daimyo;
  clan.daimyo = heir.id;
  heir.rank = 5;
  heir.loyalty = 100;
  for (const g of clanGens(s, clanId)) {
    if (g.id !== heir.id && !g.kin) g.loyalty = clamp(g.loyalty - Math.round(g.amb / 15), 0, 100);
  }
  for (const c of clanCastles(s, clanId)) refreshLord(s, c.id);
  if (old >= 0) {
    // 旧大名の身分を整理（隠居等で存命の場合）
    const og = s.gens[old];
    if (og.status === 'active') og.rank = 4;
  }
  addNews(s, `${clan.name}家は${heir.name}が家督を継いだ。`, 'clan');
  return heir;
}

export function destroyClan(s, clanId, byClan, reason = '滅亡') {
  const clan = s.clans[clanId];
  if (!clan.alive) return;
  clan.alive = false;
  for (const g of s.gens) {
    if (g.clan !== clanId) continue;
    if (g.status === 'active') makeRonin(s, g, g.castle >= 0 ? g.castle : 0);
    else if (g.status === 'unborn') g.clan = -1;
  }
  for (const c of s.castles) {
    if (c.owner === clanId) setOwner(s, c.id, -1);
  }
  s.corps = s.corps.filter((co) => co.clan !== clanId);
  addNews(s, `${clan.name}家は${reason}した。`, 'fall');
  if (clanId === s.player) {
    s.over = { win: false, text: `${clan.name}家は${reason}しました…` };
  }
  checkVictory(s);
  void byClan;
}

export function checkVictory(s) {
  if (s.over) return;
  const alive = s.clans.filter((c) => c.alive);
  if (alive.length === 1 && alive[0].id === s.player) {
    s.over = { win: true, text: `${s.clans[s.player].name}家、天下統一を成し遂げる！` };
  }
}

export function killGen(s, g, reason) {
  if (g.status === 'dead') return;
  const wasDaimyo = isDaimyo(s, g);
  const clan = g.clan;
  const castle = g.castle;
  // 兵は同じ城の武将へ引き継ぐ
  if (g.status === 'active' && g.troops > 0 && castle >= 0) {
    let rest = g.troops;
    for (const o of castleGens(s, castle)) {
      if (o.id === g.id || rest <= 0) continue;
      const add = Math.min(rest, capOf(o) - o.troops);
      if (add > 0) {
        o.troops += add;
        rest -= add;
      }
    }
  }
  g.status = 'dead';
  g.troops = 0;
  if (reason) addNews(s, `${g.name}が${reason}。`, wasDaimyo ? 'clan' : 'death');
  if (castle >= 0) refreshLord(s, castle);
  for (const co of s.corps) if (co.leader === g.id) co.leader = -1;
  if (wasDaimyo && clan >= 0) succession(s, clan);
}

export function pickRandomCastleNear(s, cid) {
  const c = s.castles[cid];
  return pick(s, [cid, ...c.adj]);
}
