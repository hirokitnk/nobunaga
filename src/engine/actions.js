// 城・武将に対する各種コマンド。戻り値は { ok, msg }。プレイヤーもAIも同じ関数を使う。
import { rnd, rint } from './rng.js';
import { COST, MERIT_REQ, RANK_NAMES, ASHIGARU, CAVALRY, GUNNER, UNIT_NAMES } from './const.js';
import {
  clamp, capOf, rel, addFriend, addNews, isDaimyo, clanCastles, clanGens, clanPowerScore,
  moveGen, reachableOwn, refreshLord, makeRonin, setOwner, isHostile,
} from './state.js';

const fail = (msg) => ({ ok: false, msg });
const okr = (msg, extra) => ({ ok: true, msg, ...extra });

function ready(s, gid) {
  const g = s.gens[gid];
  if (!g || g.status !== 'active') return [null, '武将が行動できません'];
  if (g.acted) return [null, `${g.name}は今月すでに行動しました`];
  return [g, null];
}

export const kokuStr = (k) => `${(k / 10).toFixed(1)}万石`;

export function gunPrice(s, castle) {
  const f = Math.max(0.55, 1 - (s.year - 1560) * 0.025);
  return COST.gun * f * (castle && castle.port ? 1 : 1.25);
}
export function equipPrice(s, castle, type) {
  if (type === GUNNER) return gunPrice(s, castle);
  if (type === CAVALRY) return COST.cavalry;
  return 0;
}
export function conscriptUnitCost(s, g) {
  return COST.conscript + equipPrice(s, s.castles[g.castle], g.type);
}

// ── 内政 ──
export function cmdDevelop(s, gid, kind) {
  const [g, err] = ready(s, gid);
  if (err) return fail(err);
  const c = s.castles[g.castle], clan = s.clans[g.clan];
  if (c.owner !== g.clan) return fail('自領の城ではありません');
  if (clan.gold < COST.develop) return fail('金が足りません');
  let inc, msg;
  if (kind === 'koku') {
    if (c.koku >= c.kokuMax) return fail('これ以上開墾できません');
    inc = Math.max(1, Math.round((g.pol / 12 + rnd(s) * 3) * (0.6 + c.chu / 250)));
    inc = Math.min(inc, c.kokuMax - c.koku);
    c.koku += inc;
    msg = `${g.name}が開墾。石高 +${(inc / 10).toFixed(1)}万石`;
  } else if (kind === 'shogyo') {
    if (c.shogyo >= c.shogyoMax) return fail('これ以上商業を発展できません');
    inc = Math.min(c.shogyoMax - c.shogyo, Math.max(1, Math.round(g.pol / 7 + rnd(s) * 4)));
    c.shogyo += inc;
    msg = `${g.name}が町を整備。商業 +${inc}`;
  } else if (kind === 'def') {
    if (c.def >= c.defMax) return fail('これ以上城を強化できません');
    inc = Math.min(c.defMax - c.def, Math.max(1, Math.round(g.pol / 6 + g.war / 12 + rnd(s) * 5)));
    c.def += inc;
    msg = `${g.name}が普請。城防御 +${inc}`;
  } else return fail('不明な内政');
  clan.gold -= COST.develop;
  g.acted = true;
  g.merit += 8;
  if (g.pol < 100 && rnd(s) < 0.04) g.pol++;
  return okr(msg);
}

export function cmdAlms(s, gid) {
  const [g, err] = ready(s, gid);
  if (err) return fail(err);
  const c = s.castles[g.castle], clan = s.clans[g.clan];
  if (clan.rice < COST.alms) return fail('兵糧が足りません');
  if (c.chu >= 100) return fail('民はすでに心服しています');
  const inc = Math.round(6 + g.pol / 20 + rnd(s) * 3);
  c.chu = Math.min(100, c.chu + inc);
  clan.rice -= COST.alms;
  g.acted = true;
  g.merit += 5;
  return okr(`${g.name}が民に施しを行った。民忠 +${inc}`);
}

// ── 軍事 ──
export function cmdConscript(s, gid, n) {
  const [g, err] = ready(s, gid);
  if (err) return fail(err);
  const c = s.castles[g.castle], clan = s.clans[g.clan];
  n = Math.floor(n / 100) * 100;
  const room = capOf(g) - g.troops;
  if (room < 100) return fail(`${g.name}の兵は上限（${capOf(g)}）です`);
  if (c.pool < 100) return fail('この城ではもう兵が集まりません');
  n = Math.min(n, Math.floor(room / 100) * 100, Math.floor(c.pool / 100) * 100);
  const per = conscriptUnitCost(s, g);
  n = Math.min(n, Math.floor(clan.gold / per / 100) * 100);
  if (n < 100) return fail('金が足りません');
  const cost = Math.ceil(n * per);
  g.training = Math.round((g.troops * g.training + n * 20) / (g.troops + n));
  g.troops += n;
  c.pool -= n;
  c.chu = Math.max(0, c.chu - Math.round(n / 400));
  clan.gold -= cost;
  g.acted = true;
  return okr(`${g.name}隊に${n}人を徴兵（金${cost}）`);
}

export function cmdTrain(s, gid) {
  const [g, err] = ready(s, gid);
  if (err) return fail(err);
  if (g.troops <= 0) return fail('兵がいません');
  if (g.training >= 100) return fail('訓練は十分です');
  const inc = Math.round(6 + g.war / 10 + rnd(s) * 3);
  g.training = Math.min(100, g.training + inc);
  g.morale = Math.min(100, g.morale + 5);
  g.acted = true;
  g.merit += 4;
  if (g.war < 100 && rnd(s) < 0.03) g.war++;
  return okr(`${g.name}隊が訓練。訓練 +${inc}`);
}

export function cmdEquip(s, gid, type) {
  const [g, err] = ready(s, gid);
  if (err) return fail(err);
  if (g.type === type) return fail('すでにその兵科です');
  const clan = s.clans[g.clan];
  const cost = Math.ceil(g.troops * equipPrice(s, s.castles[g.castle], type));
  if (clan.gold < cost) return fail(`金が足りません（必要 ${cost}）`);
  clan.gold -= cost;
  g.type = type;
  g.training = Math.max(0, g.training - 10);
  g.acted = true;
  return okr(`${g.name}隊を${UNIT_NAMES[type]}隊に編成（金${cost}）`);
}

export function cmdMove(s, gids, dest) {
  const moved = [];
  for (const gid of gids) {
    const [g, err] = ready(s, gid);
    if (err) return fail(err);
    if (!reachableOwn(s, g.castle, g.clan).includes(dest)) return fail(`${g.name}は${s.castles[dest].name}へ移動できません`);
  }
  for (const gid of gids) {
    const g = s.gens[gid];
    moveGen(s, g, dest);
    g.acted = true;
    moved.push(g.name);
  }
  return okr(`${moved.join('、')}が${s.castles[dest].name}へ移動`);
}

// 同じ城の武将間で兵を融通する（行動は消費しない）
export function cmdTransfer(s, fromId, toId, n) {
  const a = s.gens[fromId], b = s.gens[toId];
  if (a.castle !== b.castle || a.clan !== b.clan) return fail('同じ城の武将どうしでのみ再編できます');
  n = Math.min(n, a.troops, capOf(b) - b.troops);
  if (n <= 0) return fail('移せる兵がいません');
  b.training = Math.round((b.troops * b.training + n * a.training) / (b.troops + n));
  a.troops -= n;
  b.troops += n;
  return okr(`${a.name}隊から${b.name}隊へ${n}人を移した`);
}

// ── 人事 ──
export function recruitChance(s, g, r) {
  const clan = s.clans[g.clan];
  const prestige = Math.min(0.15, clanCastles(s, clan.id).length / 100);
  return clamp(0.3 + (g.pol + g.int) / 400 + prestige - r.amb / 400 + (r.duty < 50 ? 0.05 : 0), 0.05, 0.92);
}

export function cmdRecruit(s, gid, rid) {
  const [g, err] = ready(s, gid);
  if (err) return fail(err);
  const r = s.gens[rid];
  if (!r || r.status !== 'ronin' || r.castle !== g.castle) return fail('登用できる浪人がいません');
  g.acted = true;
  if (rnd(s) < recruitChance(s, g, r)) {
    r.status = 'active';
    r.clan = g.clan;
    r.rank = 0;
    r.merit = 0;
    r.troops = 0;
    r.training = 30;
    r.acted = true;
    r.loyalty = clamp(60 + rint(s, 0, 15) + Math.round(r.duty / 10), 0, 100);
    g.merit += 15;
    refreshLord(s, r.castle);
    return okr(`${r.name}が仕官に応じた！`, { joined: true });
  }
  return okr(`${r.name}は仕官を断った……`, { joined: false });
}

export function rewardEffect(g, amount) {
  return Math.max(1, Math.round((amount / 6) * (1.15 - g.amb / 200)));
}
export function cmdReward(s, clanId, gid, amount) {
  const g = s.gens[gid], clan = s.clans[clanId];
  if (g.clan !== clanId || g.status !== 'active') return fail('対象外です');
  if (isDaimyo(s, g)) return fail('大名には褒美を与えられません');
  if (g.loyalty >= 100) return fail(`${g.name}の忠誠は満ちています`);
  if (clan.gold < amount) return fail('金が足りません');
  clan.gold -= amount;
  const inc = rewardEffect(g, amount);
  g.loyalty = Math.min(100, g.loyalty + inc);
  return okr(`${g.name}に金${amount}を与えた。忠誠 +${inc}`);
}

export function canPromote(g) {
  return g.rank < 4 && g.merit >= MERIT_REQ[g.rank + 1];
}
export function cmdPromote(s, gid) {
  const g = s.gens[gid];
  if (!canPromote(g)) return fail('勲功が足りません');
  g.rank++;
  g.loyalty = Math.min(100, g.loyalty + 8);
  refreshLord(s, g.castle);
  return okr(`${g.name}を${RANK_NAMES[g.rank]}に任じた`);
}

export function cmdExile(s, gid) {
  const g = s.gens[gid];
  if (isDaimyo(s, g)) return fail('大名は追放できません');
  const castle = g.castle;
  makeRonin(s, g, castle);
  refreshLord(s, castle);
  return okr(`${g.name}を追放した`);
}

// ── 外交 ──
export function commonEnemy(s, a, b) {
  const enemiesOf = (c) => {
    const set = new Set();
    for (const ca of clanCastles(s, c)) for (const n of ca.adj) {
      const o = s.castles[n].owner;
      if (o >= 0 && o !== c && isHostile(s, c, o)) set.add(o);
    }
    return set;
  };
  const ea = enemiesOf(a);
  for (const x of enemiesOf(b)) if (ea.has(x) && x !== a && x !== b) return true;
  return false;
}

export function acceptChance(s, target, from, kind, envoy) {
  const r = rel(s, target, from);
  const pT = clanPowerScore(s, target), pF = clanPowerScore(s, from);
  const ep = envoy ? envoy.pol / 400 : 0;
  if (kind === 'alliance') {
    if (r.f < 50) return 0;
    return clamp((r.f - 45) / 60 + (pF > pT ? 0.15 : 0) + (commonEnemy(s, target, from) ? 0.15 : 0) + ep, 0, 0.92);
  }
  if (kind === 'truce') return clamp(0.15 + r.f / 200 + (pF > pT ? 0.2 : -0.1) + ep, 0.03, 0.85);
  if (kind === 'surrender') {
    const nc = clanCastles(s, target).length;
    const ratio = pF / Math.max(1, pT);
    if (nc > 3 || ratio < 4) return 0;
    const dm = s.gens[s.clans[target].daimyo];
    return clamp(0.2 + (ratio - 4) * 0.04 + (r.f - 40) / 200 - (dm ? dm.amb / 300 : 0) + ep, 0, 0.7);
  }
  return 0;
}

// 臣従：target 家を from 家に吸収
export function annex(s, from, target) {
  const tc = s.clans[target];
  for (const c of clanCastles(s, target)) setOwner(s, c.id, from);
  for (const g of clanGens(s, target)) {
    g.clan = from;
    g.kin = false;
    g.rank = Math.min(g.rank, 4);
    g.loyalty = clamp(45 + rint(s, 0, 20), 0, 100);
  }
  for (const g of s.gens) if (g.status === 'unborn' && g.clan === target) g.clan = from;
  tc.alive = false;
  s.clans[from].gold += tc.gold;
  s.clans[from].rice += tc.rice;
  for (const c of clanCastles(s, from)) refreshLord(s, c.id);
  addNews(s, `${tc.name}家は${s.clans[from].name}家に臣従した。`, 'fall');
}

export function cmdDiplomacy(s, envoyId, target, kind, gold = 0) {
  const [g, err] = ready(s, envoyId);
  if (err) return fail(err);
  const from = g.clan;
  const clan = s.clans[from], tc = s.clans[target];
  if (!tc || !tc.alive || target === from) return fail('相手がいません');
  const r = rel(s, from, target);
  if (kind === 'gift') {
    if (clan.gold < gold || gold <= 0) return fail('金が足りません');
    clan.gold -= gold;
    const inc = Math.round((gold / 20) * (0.5 + g.pol / 100));
    addFriend(s, from, target, inc);
    g.acted = true;
    tc.gold += Math.round(gold / 2);
    return okr(`${tc.name}家へ金${gold}を贈った。友好 +${inc}（現在 ${r.f}）`);
  }
  if (kind === 'alliance') {
    if (r.ally) return fail('すでに同盟しています');
    g.acted = true;
    if (target !== s.player && rnd(s) < acceptChance(s, target, from, 'alliance', g)) {
      r.ally = true;
      addFriend(s, from, target, 10);
      addNews(s, `${clan.name}家と${tc.name}家が同盟を結んだ。`, 'diplo');
      return okr(`${tc.name}家との同盟が成立した！`);
    }
    addFriend(s, from, target, -3);
    return okr(`${tc.name}家は同盟を断った。`, { refused: true });
  }
  if (kind === 'truce') {
    if (r.ally) return fail('同盟中です');
    if (r.truce > 0) return fail('すでに停戦中です');
    if (clan.gold < gold) return fail('金が足りません');
    clan.gold -= gold;
    g.acted = true;
    const bonus = gold / 2000;
    if (rnd(s) < acceptChance(s, target, from, 'truce', g) + bonus) {
      r.truce = 12;
      tc.gold += gold;
      addFriend(s, from, target, 5);
      return okr(`${tc.name}家と1年間の停戦が成立した。`);
    }
    return okr(`${tc.name}家は停戦を拒んだ。`, { refused: true });
  }
  if (kind === 'break') {
    if (!r.ally) return fail('同盟していません');
    r.ally = false;
    r.truce = 0;
    addFriend(s, from, target, -40);
    for (const o of s.clans) if (o.alive && o.id !== from && o.id !== target) addFriend(s, from, o.id, -5);
    addNews(s, `${clan.name}家が${tc.name}家との同盟を破棄した。`, 'diplo');
    return okr(`${tc.name}家に手切れを通告した。`);
  }
  if (kind === 'surrender') {
    g.acted = true;
    const p = acceptChance(s, target, from, 'surrender', g);
    if (p <= 0) return okr(`${tc.name}家は一笑に付した。（相手が強すぎます）`, { refused: true });
    if (rnd(s) < p) {
      annex(s, from, target);
      return okr(`${tc.name}家が臣従を受け入れた！`);
    }
    addFriend(s, from, target, -10);
    return okr(`${tc.name}家は降伏を拒んだ。`, { refused: true });
  }
  return fail('不明な外交');
}

// ── 調略 ──
export function lureChance(s, agent, t, gold) {
  if (t.kin || isDaimyo(s, t)) return 0;
  return clamp(((100 - t.loyalty) / 100) * 0.65 + (agent.int - t.int) / 220 + gold / 2500 - t.duty / 350 + (agent.flags.includes('忍') ? 0.08 : 0), 0.02, 0.8);
}
export function cmdIntrigue(s, agentId, kind, targetId, gold = 0) {
  const [g, err] = ready(s, agentId);
  if (err) return fail(err);
  const clan = s.clans[g.clan];
  const nin = g.flags.includes('忍') ? 0.1 : 0;
  if (kind === 'lure') {
    const t = s.gens[targetId];
    if (!t || t.status !== 'active' || t.clan === g.clan) return fail('対象がいません');
    if (clan.gold < gold) return fail('金が足りません');
    clan.gold -= gold;
    g.acted = true;
    const p = lureChance(s, g, t, gold);
    if (rnd(s) < p) {
      const oldClan = t.clan, oldCastle = t.castle;
      t.clan = g.clan;
      t.castle = g.castle;
      t.loyalty = clamp(50 + rint(s, 0, 15), 0, 100);
      t.rank = Math.min(t.rank, 4);
      t.acted = true;
      refreshLord(s, oldCastle);
      refreshLord(s, g.castle);
      addFriend(s, g.clan, oldClan, -10);
      g.merit += 30;
      addNews(s, `${t.name}が${s.clans[oldClan].name}家を出奔し${clan.name}家に寝返った。`, 'betray');
      return okr(`${t.name}の引抜に成功！`);
    }
    addFriend(s, g.clan, t.clan, -5);
    return okr(`${t.name}は誘いを拒んだ。`, { refused: true });
  }
  if (kind === 'rumor') {
    const t = s.gens[targetId];
    if (!t || t.status !== 'active' || t.clan === g.clan) return fail('対象がいません');
    if (clan.gold < COST.rumor) return fail('金が足りません');
    clan.gold -= COST.rumor;
    g.acted = true;
    if (t.kin || isDaimyo(s, t)) return okr(`${t.name}には流言が通じなかった。`, { refused: true });
    if (rnd(s) < clamp(0.4 + (g.int - t.int) / 150 + nin, 0.05, 0.9)) {
      const d = rint(s, 6, 15);
      t.loyalty = Math.max(0, t.loyalty - d);
      g.merit += 10;
      return okr(`流言は功を奏した。${t.name}の忠誠 -${d}`);
    }
    return okr('流言は見破られた。', { refused: true });
  }
  if (kind === 'incite') {
    const c = s.castles[targetId];
    if (!c || c.owner === g.clan) return fail('対象がありません');
    if (clan.gold < COST.incite) return fail('金が足りません');
    clan.gold -= COST.incite;
    g.acted = true;
    const lord = c.lord >= 0 ? s.gens[c.lord] : null;
    if (rnd(s) < clamp(0.45 + (g.int - (lord ? lord.int : 40)) / 150 + nin, 0.05, 0.9)) {
      const d = rint(s, 10, 20);
      c.chu = Math.max(0, c.chu - d);
      c.koku = Math.max(10, Math.round(c.koku * 0.97));
      g.merit += 10;
      return okr(`${c.name}の領民が騒ぎ出した。民忠 -${d}`);
    }
    return okr('扇動は失敗した。', { refused: true });
  }
  return fail('不明な調略');
}

// ── 商人 ──
export function cmdTrade(s, clanId, rice) {
  const clan = s.clans[clanId];
  const price = s.ricePrice;
  if (rice > 0) {
    const cost = Math.ceil((rice / 100) * price);
    if (clan.gold < cost) return fail('金が足りません');
    clan.gold -= cost;
    clan.rice += rice;
    return okr(`兵糧${rice}を金${cost}で買い入れた`);
  }
  const amt = -rice;
  if (clan.rice < amt) return fail('兵糧が足りません');
  const gain = Math.floor((amt / 100) * price * 0.8);
  clan.rice -= amt;
  clan.gold += gain;
  return okr(`兵糧${amt}を売り、金${gain}を得た`);
}

// ── 軍団 ──
export function createCorps(s, clanId, leaderId, castles, policy) {
  const leader = s.gens[leaderId];
  if (!leader || leader.clan !== clanId || leader.rank < 2) return fail('軍団長は部将以上の武将から選んでください');
  if (isDaimyo(s, leader)) return fail('大名は軍団長になれません');
  if (!castles.length) return fail('城を選んでください');
  for (const co of s.corps) co.castles = co.castles.filter((c) => !castles.includes(c));
  s.corps = s.corps.filter((co) => co.castles.length || co.clan !== clanId);
  const id = (s.corps.reduce((m, c) => Math.max(m, c.id), 0) || 0) + 1;
  s.corps.push({ id, clan: clanId, leader: leaderId, castles: castles.slice(), policy });
  return okr(`${leader.name}を軍団長とする第${id}軍団を編成した`);
}
export function disbandCorps(s, id) {
  s.corps = s.corps.filter((c) => c.id !== id);
  return okr('軍団を解散した');
}
export const corpsOfCastle = (s, cid) => s.corps.find((c) => c.castles.includes(cid));

