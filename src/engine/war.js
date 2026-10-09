// 出陣・合戦結果の反映・捕虜の処遇
import { rnd, rint } from './rng.js';
import { MAX_SORTIE, MAX_DEFENDERS, isWinter } from './const.js';
import { createBattle, autoResolve } from './battle.js';
import {
  clamp, castleGens, clanCastles, genPower, castleDefensePower, isHostile, addFriend, addNews, moveGen, setOwner,
  nearestOwnCastle, destroyClan, killGen, refreshLord, makeRonin, isDaimyo, succession, rel,
} from './state.js';

export function snowBlocked(s, a, b) {
  return isWinter(s.month) && (s.castles[a].snow || s.castles[b].snow);
}

export function riceForSortie(gens) {
  return Math.ceil(gens.reduce((t, g) => t + g.troops, 0) / 40);
}

// 攻撃可能な隣接敵城
export function attackableTargets(s, clan) {
  const out = new Set();
  for (const c of s.castles) {
    if (c.owner !== clan) continue;
    for (const a of c.adj) {
      const t = s.castles[a];
      if (t.owner === clan) continue;
      if (t.owner >= 0 && !isHostile(s, clan, t.owner)) continue;
      out.add(a);
    }
  }
  return [...out];
}

// 目標城に出陣できる武将（隣接する自城にいる未行動の武将）
export function sortieCandidates(s, clan, target) {
  const t = s.castles[target];
  const out = [];
  for (const a of t.adj) {
    const c = s.castles[a];
    if (c.owner !== clan || snowBlocked(s, a, target)) continue;
    for (const g of castleGens(s, a)) if (!g.acted && g.troops >= 100) out.push(g);
  }
  return out;
}

export function validateAttack(s, clan, target, gids) {
  const t = s.castles[target];
  if (!t) return '城がありません';
  if (t.owner === clan) return '自分の城です';
  if (t.owner >= 0 && !isHostile(s, clan, t.owner)) {
    const r = rel(s, clan, t.owner);
    return r.ally ? '同盟国の城は攻められません（先に手切れを）' : '停戦中です';
  }
  if (!gids.length) return '出陣する武将を選んでください';
  if (gids.length > MAX_SORTIE) return `出陣できるのは${MAX_SORTIE}部隊までです`;
  const cands = new Set(sortieCandidates(s, clan, target).map((g) => g.id));
  for (const id of gids) if (!cands.has(id)) return `${s.gens[id].name}は出陣できません`;
  const gens = gids.map((id) => s.gens[id]);
  if (s.clans[clan].rice < riceForSortie(gens)) return `兵糧が足りません（必要 ${riceForSortie(gens)}）`;
  return null;
}

// 防衛側AIの援軍選択
export function aiChooseReinforcements(s, defClan, target, attPower, nDef) {
  const t = s.castles[target];
  const need = attPower * 1.15 - castleDefensePower(s, target);
  if (need <= 0) return [];
  const cands = [];
  for (const a of t.adj) {
    const c = s.castles[a];
    if (c.owner !== defClan || snowBlocked(s, a, target)) continue;
    const gens = castleGens(s, a).filter((g) => !g.acted && g.troops >= 300).sort((x, y) => genPower(y) - genPower(x));
    // 城主は残す
    for (const g of gens) if (g.id !== c.lord || gens.length > 2) cands.push({ g, from: a });
  }
  cands.sort((x, y) => genPower(y.g) - genPower(x.g));
  const out = [];
  let sum = 0;
  for (const e of cands) {
    if (out.length + nDef >= MAX_DEFENDERS || sum >= need) break;
    out.push(e);
    sum += genPower(e.g);
  }
  return out;
}

export function reinforcementCandidates(s, defClan, target) {
  const t = s.castles[target];
  const out = [];
  for (const a of t.adj) {
    const c = s.castles[a];
    if (c.owner !== defClan || snowBlocked(s, a, target)) continue;
    for (const g of castleGens(s, a)) if (!g.acted && g.troops >= 100) out.push({ g, from: a });
  }
  return out;
}

const dirFrom = (s, from, to) => [s.castles[from].x - s.castles[to].x, s.castles[from].y - s.castles[to].y];

// 出陣。ctx.battle が与えられ、プレイヤーが関わる合戦なら UI に委ねる
export async function launchAttack(s, ctx, clan, target, gids) {
  const err = validateAttack(s, clan, target, gids);
  if (err) return { ok: false, msg: err };
  const t = s.castles[target];
  const attackers = gids.map((id) => s.gens[id]);
  s.clans[clan].rice -= riceForSortie(attackers);
  for (const g of attackers) g.acted = true;
  const defClan = t.owner;
  const attName = s.clans[clan].name;
  if (defClan >= 0) addFriend(s, clan, defClan, -15);

  const defenders = castleGens(s, target).filter((g) => g.troops > 0).sort((a, b) => b.troops - a.troops).slice(0, MAX_DEFENDERS);
  if (defClan < 0 || !defenders.length) {
    // 無血開城
    const prev = defClan;
    const flee = castleGens(s, target);
    setOwner(s, target, clan);
    for (const g of flee) {
      const dest = nearestOwnCastle(s, prev, target);
      if (dest >= 0) moveGen(s, g, dest);
      else makeRonin(s, g, target);
    }
    for (const g of attackers) moveGen(s, g, target);
    refreshLord(s, target);
    addNews(s, `${attName}家が${t.name}を無血で手に入れた。`, 'war');
    if (prev >= 0 && !clanCastles(s, prev).length) destroyClan(s, prev, clan);
    return { ok: true, bloodless: true, won: true, msg: `${t.name}を占領した` };
  }

  const attPower = attackers.reduce((a, g) => a + genPower(g), 0);
  let reinf;
  if (defClan === s.player && ctx.chooseReinforcements) {
    reinf = await ctx.chooseReinforcements(s, { target, attClan: clan, attackers, defenders, candidates: reinforcementCandidates(s, defClan, target) });
  } else reinf = aiChooseReinforcements(s, defClan, target, attPower, defenders.length);
  reinf = (reinf || []).slice(0, Math.max(0, MAX_DEFENDERS - defenders.length));
  for (const e of reinf) e.g.acted = true;

  const playerSide = clan === s.player ? 0 : defClan === s.player ? 1 : -1;
  const seed = Math.floor(rnd(s) * 2 ** 31);
  const b = createBattle({
    castleObj: t, attClan: clan, defClan, playerSide, seed, month: s.month,
    attackers: attackers.map((g) => ({ g, from: g.castle, dir: dirFrom(s, g.castle, target) })),
    defenders,
    reinf: reinf.map((e) => ({ g: e.g, from: e.from, dir: dirFrom(s, e.from, target) })),
  });
  if (playerSide >= 0 && ctx.battle) await ctx.battle(s, b);
  else autoResolve(b);
  if (ctx.onBattleEnd) ctx.onBattleEnd(s, b);
  const outcome = applyBattleResult(s, b);
  await resolveCaptives(s, ctx, b);
  return { ok: true, battle: b, won: b.result.winner === 0, msg: outcome };
}

export function applyBattleResult(s, b) {
  const t = s.castles[b.castle];
  const attWon = b.result.winner === 0;
  const attName = s.clans[b.attClan].name, defName = s.clans[b.defClan].name;
  const killed = [];
  for (const u of b.units) {
    const g = s.gens[u.gid];
    g.troops = u.state === 'dead' ? 0 : u.troops;
    g.morale = clamp(Math.max(u.morale, 40), 0, 100);
    const winSide = (u.side === 0) === attWon;
    g.merit += Math.round(u.dmg / 15) + (winSide ? 25 : 0) + (winSide && u.leader ? 40 : 0);
    if (u.dmg > 600 && g.war < 100 && rnd(s) < 0.25) g.war++;
    if (winSide && !g.kin && g.loyalty < 100) g.loyalty = Math.min(100, g.loyalty + 2);
    if (u.killed) killed.push(g);
    if (u.captured) {
      const cap = b.captured.find((c) => c.gid === g.id);
      g.status = 'captive';
      g.captor = cap.clan;
      g.troops = 0;
    }
  }
  t.def = Math.max(50, Math.round(t.def - b.gateDamage * 0.4));
  let msg;
  if (attWon) {
    const prev = b.defClan;
    setOwner(s, t.id, b.attClan);
    t.chu = Math.max(10, t.chu - 15);
    for (const g of s.gens) {
      if (g.status !== 'active' || g.castle !== t.id || g.clan !== prev) continue;
      const dest = nearestOwnCastle(s, prev, t.id);
      if (dest >= 0) {
        g.troops = Math.round((g.troops * 0.7) / 100) * 100;
        moveGen(s, g, dest);
      } else {
        g.status = 'captive';
        g.captor = b.attClan;
        g.troops = 0;
        b.captured.push({ gid: g.id, side: 0, clan: b.attClan });
      }
    }
    for (const u of b.units) if (u.side === 0 && u.state === 'alive') moveGen(s, s.gens[u.gid], t.id);
    refreshLord(s, t.id);
    msg = `${attName}家が${t.name}を攻略した（${b.result.reason}）`;
    addNews(s, msg, 'war');
    if (prev >= 0 && !clanCastles(s, prev).length) destroyClan(s, prev, b.attClan);
  } else {
    msg = `${defName}家が${t.name}で${attName}家を撃退した（${b.result.reason}）`;
    addNews(s, msg, 'war');
  }
  for (const g of killed) killGen(s, g, '討死した');
  for (const c of new Set(b.units.map((u) => s.gens[u.gid].castle))) if (c >= 0) refreshLord(s, c);
  return msg;
}

export function recruitCaptiveChance(s, captor, g) {
  const oldAlive = g.clan >= 0 && s.clans[g.clan].alive;
  if (oldAlive && s.clans[g.clan].daimyo === g.id) return 0.02;
  return clamp(0.25 + (100 - g.duty) / 250 + (oldAlive ? -0.1 : 0.2) + (g.kin && oldAlive ? -0.2 : 0), 0.03, 0.85);
}

export function aiCaptiveDecision(s, captor, g) {
  const dm = s.gens[s.clans[captor].daimyo];
  const oldAlive = g.clan >= 0 && s.clans[g.clan].alive;
  if (oldAlive && isDaimyo(s, g)) return dm && dm.amb > 85 && dm.duty < 30 && rnd(s) < 0.4 ? 'execute' : 'release';
  if (g.pol + g.war + g.int >= 170 || recruitCaptiveChance(s, captor, g) > 0.4) return 'recruit';
  if (dm && dm.duty < 25 && rnd(s) < 0.2) return 'execute';
  return 'release';
}

export function applyCaptive(s, gid, captor, action) {
  const g = s.gens[gid];
  if (g.status !== 'captive') return '';
  const oldClan = g.clan;
  const oldAlive = oldClan >= 0 && s.clans[oldClan].alive;
  if (action === 'recruit') {
    if (rnd(s) < recruitCaptiveChance(s, captor, g)) {
      const wasDaimyo = oldAlive && s.clans[oldClan].daimyo === g.id;
      const home = clanCastles(s, captor);
      const dest = home.some((c) => c.id === g.castle) ? g.castle : (home[0] ? home[0].id : -1);
      if (dest < 0) return releaseCaptive(s, g);
      g.status = 'active';
      g.clan = captor;
      g.kin = false;
      g.rank = Math.min(g.rank, 3);
      g.loyalty = clamp(45 + rint(s, 0, 20), 0, 100);
      g.acted = true;
      moveGen(s, g, dest);
      if (wasDaimyo) succession(s, oldClan);
      return `${g.name}が${s.clans[captor].name}家に仕えることになった。`;
    }
    return `${g.name}は登用を拒んだため解放した。` + releaseCaptive(s, g, true);
  }
  if (action === 'execute') {
    if (oldAlive) addFriend(s, captor, oldClan, -20);
    g.status = 'active';
    killGen(s, g, '処断された');
    return `${g.name}を処断した。`;
  }
  return releaseCaptive(s, g);
}

function releaseCaptive(s, g, quiet = false) {
  const oldClan = g.clan;
  if (oldClan >= 0 && s.clans[oldClan].alive) {
    const cs = clanCastles(s, oldClan);
    const dest = cs.length ? (cs.find((c) => c.adj.includes(g.castle)) || cs[0]).id : -1;
    if (dest >= 0) {
      g.status = 'active';
      g.troops = 0;
      moveGen(s, g, dest);
      addFriend(s, g.captor ?? -1, oldClan, 5);
      return quiet ? '' : `${g.name}を解放した。`;
    }
  }
  makeRonin(s, g, g.castle >= 0 ? g.castle : 0);
  return quiet ? '' : `${g.name}を解放した。（浪人となった）`;
}

export async function resolveCaptives(s, ctx, b) {
  const byCaptor = new Map();
  for (const c of b.captured) {
    const g = s.gens[c.gid];
    if (g.status !== 'captive') continue;
    if (!byCaptor.has(g.captor)) byCaptor.set(g.captor, []);
    byCaptor.get(g.captor).push(g);
  }
  for (const [captor, list] of byCaptor) {
    let decisions;
    if (captor === s.player && ctx.decideCaptives && !s.over) decisions = await ctx.decideCaptives(s, list);
    if (!decisions) decisions = list.map((g) => ({ gid: g.id, action: aiCaptiveDecision(s, captor, g) }));
    const msgs = [];
    for (const d of decisions) msgs.push(applyCaptive(s, d.gid, captor, d.action));
    if (captor === s.player || list.some((g) => g.clan === s.player)) for (const m of msgs) if (m) addNews(s, m, 'captive');
  }
  // 念のため未処理の捕虜を解放
  for (const c of b.captured) {
    const g = s.gens[c.gid];
    if (g.status === 'captive') applyCaptive(s, g.id, g.captor, 'release');
  }
}
