// 大名AI（および プレイヤー軍団の委任AI）
import { rnd, shuffle, pick } from './rng.js';
import { COST, MAX_SORTIE, ASHIGARU, CAVALRY, GUNNER, DIFFICULTY } from './const.js';
import {
  clanCastles, clanGens, castleGens, capOf, genPower, castleDefensePower, isHostile, frontDistance, rel,
  neighborsClans, clanPowerScore, clanTroops, isDaimyo, roninAt, addNews, addFriend,
} from './state.js';
import {
  cmdDevelop, cmdConscript, cmdTrain, cmdEquip, cmdAlms, cmdMove, cmdRecruit, cmdPromote, cmdReward,
  cmdIntrigue, cmdTrade, canPromote, conscriptUnitCost, acceptChance, annex, lureChance, commonEnemy,
} from './actions.js';
import { launchAttack, sortieCandidates, riceForSortie, snowBlocked } from './war.js';

export async function aiClanTurn(s, cid, ctx) {
  const clan = s.clans[cid];
  if (!clan.alive) return;
  aiPersonnel(s, cid);
  aiTrade(s, cid);
  await aiMilitary(s, cid, ctx, null);
  if (s.over || !clan.alive) return;
  const fd = frontDistance(s, cid);
  aiRedeploy(s, cid, fd, null);
  for (const c of shuffle(s, clanCastles(s, cid))) aiCastleDomestic(s, cid, c.id, fd.get(c.id) === 0, 0);
  await aiDiplomacy(s, cid, ctx);
  aiIntrigue(s, cid);
}

// プレイヤーの軍団（委任）
export async function aiCorpsTurn(s, ctx) {
  const clan = s.clans[s.player];
  for (const co of s.corps.filter((c) => c.clan === s.player)) {
    co.castles = co.castles.filter((c) => s.castles[c].owner === s.player);
    if (!co.castles.length) continue;
    const budget = Math.floor(clan.gold * 0.35);
    const startGold = clan.gold;
    const reserve = Math.max(60, startGold - budget);
    if (co.policy === 'attack') await aiMilitary(s, s.player, ctx, co.castles);
    if (s.over) return;
    const fd = frontDistance(s, s.player);
    aiRedeploy(s, s.player, fd, co.castles);
    for (const cid of co.castles) {
      aiCastleDomestic(s, s.player, cid, co.policy !== 'develop' && fd.get(cid) === 0, reserve);
    }
  }
}

function aiPersonnel(s, cid) {
  const clan = s.clans[cid];
  for (const g of clanGens(s, cid)) {
    if (canPromote(g) && !isDaimyo(s, g)) cmdPromote(s, g.id);
    if (!g.kin && g.loyalty < 50 && clan.gold > 400 && !isDaimyo(s, g)) cmdReward(s, cid, g.id, 100);
  }
  for (const c of clanCastles(s, cid)) {
    const rs = roninAt(s, c.id);
    if (!rs.length || rnd(s) > 0.6) continue;
    const rec = castleGens(s, c.id).filter((g) => !g.acted).sort((a, b) => b.pol + b.int - a.pol - a.int)[0];
    if (rec) cmdRecruit(s, rec.id, rs.sort((a, b) => b.war + b.pol + b.int - a.war - a.pol - a.int)[0].id);
  }
}

function aiTrade(s, cid) {
  const clan = s.clans[cid];
  const upkeep = clanTroops(s, cid) / 250;
  if (clan.rice < upkeep * 4 && clan.gold > 200) {
    const want = Math.floor(Math.min(upkeep * 8, ((clan.gold * 0.4) / s.ricePrice) * 100) / 100) * 100;
    if (want >= 100) cmdTrade(s, cid, want);
  } else if (clan.rice > upkeep * 30 + 1500 && clan.gold < 300) {
    cmdTrade(s, cid, -Math.floor((clan.rice - upkeep * 20) / 200) * 100);
  }
}

function devKind(c, front) {
  if (front && c.def < c.defMax * 0.6) return 'def';
  const rk = c.koku / c.kokuMax, rs = c.shogyo / c.shogyoMax;
  if (rk >= 1 && rs >= 1) return c.def < c.defMax ? 'def' : null;
  return rk <= rs ? 'koku' : 'shogyo';
}

export function aiCastleDomestic(s, cid, castleId, front, reserveOverride) {
  const c = s.castles[castleId], clan = s.clans[cid];
  const gens = castleGens(s, castleId).filter((g) => !g.acted);
  if (!gens.length) return;
  const reserve = reserveOverride || 60 + clanCastles(s, cid).length * 10;
  let devs = 0;
  for (const g of [...gens].sort((a, b) => b.pol - a.pol)) {
    if (devs >= (front ? 1 : 2) || g.pol < 45 || clan.gold < COST.develop + reserve) break;
    const kind = devKind(c, front);
    if (!kind) break;
    if (cmdDevelop(s, g.id, kind).ok) devs++;
  }
  for (const g of gens.filter((x) => !x.acted).sort((a, b) => b.war - a.war)) {
    const need = capOf(g) - g.troops;
    if (need >= 300 && c.pool >= 200 && clan.gold > reserve + 40) {
      const per = conscriptUnitCost(s, g);
      const n = Math.floor(Math.min(need, c.pool, (clan.gold - reserve) / per) / 100) * 100;
      if (n >= 100 && cmdConscript(s, g.id, n).ok) continue;
    }
    if (g.troops > 0 && g.training < 90) {
      cmdTrain(s, g.id);
      continue;
    }
    if (g.type === ASHIGARU && g.troops >= 1200 && g.war >= 60 && clan.gold > 700 + reserve && rnd(s) < 0.25) {
      const type = g.flags.includes('鉄') || (c.port && g.int >= g.war) ? GUNNER : g.war >= 70 || g.flags.includes('騎') ? CAVALRY : GUNNER;
      if (cmdEquip(s, g.id, type).ok) continue;
    }
    if (c.chu < 45 && clan.rice > 800) cmdAlms(s, g.id);
  }
}

// 後方の武将を前線へ送る
function aiRedeploy(s, cid, fd, limitCastles) {
  const daimyo = s.clans[cid].daimyo;
  const castles = clanCastles(s, cid).filter((c) => !limitCastles || limitCastles.includes(c.id));
  for (const c of castles) {
    const d = fd.get(c.id);
    if (d === undefined || d === 0) continue;
    const next = c.adj.filter((a) => s.castles[a].owner === cid && fd.get(a) < d && (!limitCastles || limitCastles.includes(a)));
    if (!next.length) continue;
    const dest = next.sort((a, b) => castleDefensePower(s, a) - castleDefensePower(s, b))[0];
    const gens = castleGens(s, c.id).filter((g) => !g.acted && g.id !== daimyo && g.id !== c.lord && g.troops >= 300)
      .sort((a, b) => genPower(b) - genPower(a));
    const moving = gens.slice(0, 2).map((g) => g.id);
    if (moving.length) cmdMove(s, moving, dest);
  }
  // 空き城・手薄な前線城の補強
  for (const c of castles) {
    if (fd.get(c.id) !== 0 || castleGens(s, c.id).length) continue;
    for (const a of c.adj) {
      if (s.castles[a].owner !== cid) continue;
      const gs = castleGens(s, a).filter((g) => !g.acted && g.id !== daimyo);
      if (gs.length >= 2) {
        cmdMove(s, [gs.sort((x, y) => genPower(x) - genPower(y))[0].id], c.id);
        break;
      }
    }
  }
}

function planAttack(s, cid, limitCastles) {
  const clan = s.clans[cid];
  const dm = s.gens[clan.daimyo];
  const aggro = DIFFICULTY[s.difficulty]?.aiAggro ?? 1;
  const need = (1.75 - ((dm ? dm.amb : 50) - 50) / 200) / (cid === s.player ? 1 : aggro);
  let best = null;
  const targets = new Set();
  for (const c of clanCastles(s, cid)) {
    if (limitCastles && !limitCastles.includes(c.id)) continue;
    for (const a of c.adj) {
      const t = s.castles[a];
      if (t.owner === cid || snowBlocked(s, c.id, a)) continue;
      if (t.owner >= 0 && !isHostile(s, cid, t.owner)) continue;
      if (t.owner === s.player && s.turnCount <= 3) continue;
      targets.add(a);
    }
  }
  for (const tid of targets) {
    const t = s.castles[tid];
    let cands = sortieCandidates(s, cid, tid).filter((g) => !limitCastles || limitCastles.includes(g.castle));
    // 他の敵と接する城では城主を残す
    cands = cands.filter((g) => {
      const src = s.castles[g.castle];
      const otherThreat = src.adj.some((a) => a !== tid && s.castles[a].owner >= 0 && s.castles[a].owner !== cid && isHostile(s, cid, s.castles[a].owner));
      if (!otherThreat) return true;
      return g.id !== src.lord;
    }).filter((g) => g.troops >= 300 && g.morale >= 40);
    if (!cands.length) continue;
    cands.sort((a, b) => genPower(b) - genPower(a));
    const defP = t.owner < 0 || !castleGens(s, tid).some((g) => g.troops > 0) ? 0 : castleDefensePower(s, tid) + reinforcementPotential(s, t.owner, tid) * 0.5;
    let pick2 = [], attP = 0;
    for (const g of cands) {
      if (pick2.length >= MAX_SORTIE) break;
      pick2.push(g);
      attP += genPower(g);
      if (defP === 0 || attP >= defP * need * 1.35) break;
    }
    const ratio = defP === 0 ? 99 : attP / defP;
    if (ratio < need) continue;
    if (clan.rice < riceForSortie(pick2) + 200) continue;
    const value = (t.koku + t.shogyo / 2 + (t.owner < 0 ? 80 : 0)) * Math.min(ratio, 3);
    if (!best || value > best.value) best = { target: tid, gids: pick2.map((g) => g.id), value };
  }
  return best;
}

function reinforcementPotential(s, owner, tid) {
  let p = 0;
  for (const a of s.castles[tid].adj) {
    if (s.castles[a].owner !== owner) continue;
    const gs = castleGens(s, a).filter((g) => !g.acted);
    for (const g of gs.slice(1)) p += genPower(g);
  }
  return p;
}

async function aiMilitary(s, cid, ctx, limitCastles) {
  const n = clanCastles(s, cid).length;
  const dm = s.gens[s.clans[cid].daimyo];
  // 軍議：毎月必ず攻めるわけではない（野望が高いほど積極的）
  if (!limitCastles && rnd(s) > 0.2 + (dm ? dm.amb : 50) / 250) return;
  const maxAttacks = 1 + Math.floor(n / 12);
  for (let k = 0; k < maxAttacks; k++) {
    if (s.over || !s.clans[cid].alive) return;
    const plan = planAttack(s, cid, limitCastles);
    if (!plan) return;
    if (ctx.beforeAiAttack) await ctx.beforeAiAttack(s, cid, plan.target);
    await launchAttack(s, ctx, cid, plan.target, plan.gids);
  }
}

async function aiDiplomacy(s, cid, ctx) {
  if (rnd(s) > 0.22) return;
  const clan = s.clans[cid];
  const dm = s.gens[clan.daimyo];
  const envoy = clanGens(s, cid).filter((g) => !g.acted).sort((a, b) => b.pol - a.pol)[0];
  if (!envoy) return;
  const neigh = neighborsClans(s, cid).filter((c) => s.clans[c].alive);
  if (!neigh.length) return;
  const myP = Math.max(1, clanPowerScore(s, cid));
  const hostileNeighbors = neigh.filter((c) => isHostile(s, cid, c));

  // 臣従を迫る
  for (const t of neigh) {
    if (t === s.player || !isHostile(s, cid, t)) continue;
    const p = acceptChance(s, t, cid, 'surrender', envoy);
    if (p > 0 && rnd(s) < 0.5) {
      envoy.acted = true;
      if (rnd(s) < p) annex(s, cid, t);
      else addFriend(s, cid, t, -10);
      return;
    }
  }
  // 手切れ（周囲が同盟国ばかりの野心家）
  if (!hostileNeighbors.length && dm && dm.amb >= 60 && rnd(s) < 0.15) {
    const ally = neigh.filter((c) => rel(s, cid, c).ally && c !== s.player).sort((a, b) => clanPowerScore(s, a) - clanPowerScore(s, b))[0];
    if (ally !== undefined && clanPowerScore(s, ally) < myP * 0.7) {
      const r = rel(s, cid, ally);
      r.ally = false;
      r.f = Math.max(0, r.f - 40);
      addNews(s, `${clan.name}家が${s.clans[ally].name}家との同盟を破棄した。`, 'diplo');
      return;
    }
  }
  // 強敵に備えて同盟を求める
  const threat = hostileNeighbors.sort((a, b) => clanPowerScore(s, b) - clanPowerScore(s, a))[0];
  let partner = null;
  if (threat !== undefined && clanPowerScore(s, threat) > myP * 1.3) {
    if (rel(s, cid, threat).f >= 55) partner = threat;
    else partner = neigh.find((c) => c !== threat && !rel(s, cid, c).ally && rel(s, cid, c).f >= 50 && commonEnemy(s, cid, c)) ?? null;
  }
  if (partner === null) partner = neigh.find((c) => !rel(s, cid, c).ally && rel(s, cid, c).f >= 65) ?? null;
  if (partner !== null && !rel(s, cid, partner).ally) {
    envoy.acted = true;
    let yes;
    if (partner === s.player) {
      yes = ctx.ask ? await ctx.ask(s, { kind: 'alliance', from: cid, text: `${clan.name}家の使者${envoy.name}が参りました。「当家と同盟を結んでいただきたい」` }) : false;
    } else yes = rnd(s) < acceptChance(s, partner, cid, 'alliance', envoy);
    if (yes) {
      rel(s, cid, partner).ally = true;
      addFriend(s, cid, partner, 10);
      addNews(s, `${clan.name}家と${s.clans[partner].name}家が同盟を結んだ。`, 'diplo');
    } else addFriend(s, cid, partner, -3);
    return;
  }
  // 劣勢なら停戦を申し入れる
  if (threat !== undefined && clanPowerScore(s, threat) > myP * 2 && rel(s, cid, threat).truce <= 0 && clan.gold > 300) {
    envoy.acted = true;
    let yes;
    if (threat === s.player) {
      yes = ctx.ask ? await ctx.ask(s, { kind: 'truce', from: cid, gold: 300, text: `${clan.name}家の使者${envoy.name}が金300を携えて参りました。「1年の停戦をお願い申し上げる」` }) : false;
    } else yes = rnd(s) < acceptChance(s, threat, cid, 'truce', envoy);
    if (yes) {
      clan.gold -= 300;
      s.clans[threat].gold += 300;
      rel(s, cid, threat).truce = 12;
      addNews(s, `${clan.name}家と${s.clans[threat].name}家が停戦した。`, 'diplo');
    }
    return;
  }
  // 贈答
  if (clan.gold > 900) {
    const t = pick(s, neigh.filter((c) => rel(s, cid, c).f < 70));
    if (t !== undefined) {
      envoy.acted = true;
      clan.gold -= 200;
      s.clans[t].gold += 100;
      addFriend(s, cid, t, Math.round(10 * (0.5 + envoy.pol / 100)));
    }
  }
}

function aiIntrigue(s, cid) {
  if (rnd(s) > 0.12) return;
  const clan = s.clans[cid];
  if (clan.gold < 400) return;
  const agent = clanGens(s, cid).filter((g) => !g.acted).sort((a, b) => b.int - a.int)[0];
  if (!agent || agent.int < 60) return;
  const targets = [];
  for (const c of clanCastles(s, cid)) for (const a of c.adj) {
    const o = s.castles[a].owner;
    if (o < 0 || o === cid || !isHostile(s, cid, o)) continue;
    for (const g of castleGens(s, a)) if (lureChance(s, agent, g, 200) > 0.25) targets.push(g);
  }
  const t = targets.sort((a, b) => b.war + b.int - a.war - a.int)[0];
  if (t) {
    const r = cmdIntrigue(s, agent.id, 'lure', t.id, 200);
    if (t.clan === cid && t.castle >= 0) { /* 成功 */ }
    void r;
  }
}
