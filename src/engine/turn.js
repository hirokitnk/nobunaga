// 月ごとの進行と、ゲーム全体のループ
import { rnd, rint, chance, shuffle, pick } from './rng.js';
import { DIFFICULTY, MERIT_REQ } from './const.js';
import {
  clamp, clanCastles, clanGens, castleGens, clanTroops, addNews, killGen, activateGen, makeRonin,
  nearestOwnCastle, refreshLord, isDaimyo, familyName, setOwner, rel, checkVictory, moveGen,
} from './state.js';
import { aiClanTurn, aiCorpsTurn } from './ai.js';

export function incomeOf(s, clanId) {
  const d = DIFFICULTY[s.difficulty] ?? DIFFICULTY[1];
  const mult = clanId === s.player ? d.playerIncome : d.aiIncome;
  let gold = 0, rice = 0;
  for (const c of s.castles) {
    if (c.owner !== clanId) continue;
    const eff = 0.5 + c.chu / 200;
    gold += (c.shogyo * 0.15 + c.koku * 0.05) * eff * mult;
    rice += c.koku * 4 * eff * mult * (c.bumper ? 1.3 : 1);
  }
  return { gold: Math.round(gold), rice: Math.round(rice), upkeep: Math.ceil(clanTroops(s, clanId) / 250) };
}

export function beginMonth(s) {
  s.turnCount++;
  s.corpsDone = false;
  for (const g of s.gens) g.acted = false;
  if (s.month === 1) yearly(s);
  deaths(s);
  events(s);
  // 米相場
  const base = s.month >= 9 && s.month <= 11 ? 30 : s.month >= 5 && s.month <= 8 ? 52 : 40;
  s.ricePrice = Math.round(base * (0.85 + rnd(s) * 0.3));
  // 収入
  for (const clan of s.clans) {
    if (!clan.alive) continue;
    const inc = incomeOf(s, clan.id);
    clan.gold += inc.gold;
    if (s.month === 9) {
      clan.rice += inc.rice;
      if (clan.id === s.player) addNews(s, `秋の収穫。兵糧 +${inc.rice}`, 'econ');
    }
    clan.rice -= inc.upkeep;
    if (clan.rice < 0) {
      clan.rice = 0;
      for (const g of clanGens(s, clan.id)) {
        g.troops = Math.floor((g.troops * 0.9) / 100) * 100;
        g.morale = Math.max(0, g.morale - 10);
      }
      if (clan.id === s.player) addNews(s, '兵糧が尽きた！ 兵が逃げ出している。', 'alert');
    }
  }
  for (const c of s.castles) {
    c.bumper = false;
    c.pool = Math.min(c.koku * 20, c.pool + Math.round(c.koku * 1.5));
    if (c.chu < 60) c.chu++;
    if (c.def < 100 && c.owner >= 0) c.def += 5;
  }
  for (const k of Object.keys(s.rel)) if (s.rel[k].truce > 0) s.rel[k].truce--;
  rebellions(s);
}

export function endMonth(s) {
  s.month++;
  if (s.month > 12) {
    s.month = 1;
    s.year++;
  }
}

function yearly(s) {
  // 元服・仕官
  for (const g of s.gens) {
    if (g.status !== 'unborn' || g.appear > s.year) continue;
    const clan = g.clan >= 0 ? s.clans[g.clan] : null;
    if (clan && clan.alive) {
      const cs = clanCastles(s, clan.id);
      let dest = cs.find((c) => c.id === g.originCastle)?.id ?? (clan.daimyo >= 0 ? s.gens[clan.daimyo].castle : -1);
      if (dest < 0 || s.castles[dest].owner !== clan.id) dest = cs.length ? cs[0].id : -1;
      if (dest >= 0) {
        activateGen(s, g, clan.id, dest, false);
        g.rank = 0;
        if (clan.id === s.player) addNews(s, `${g.name}が元服し、当家に加わった。`, 'gen');
        continue;
      }
    }
    makeRonin(s, g, g.originCastle >= 0 ? g.originCastle : 0);
  }
  // 忠誠の変動
  for (const clan of s.clans) {
    if (!clan.alive) continue;
    const dm = s.gens[clan.daimyo];
    const charisma = dm ? (dm.pol + dm.war + dm.int) / 3 : 50;
    for (const g of clanGens(s, clan.id)) {
      if (g.kin || isDaimyo(s, g)) continue;
      let d = -rint(s, 0, Math.round(g.amb / 25));
      if (g.rank < 4 && g.merit >= MERIT_REQ[g.rank + 1]) d -= 2;
      if (charisma >= 85) d += 2;
      g.loyalty = clamp(g.loyalty + d, 0, 100);
    }
  }
  // 浪人の放浪
  for (const g of s.gens) {
    if (g.status === 'ronin' && rnd(s) < 0.35) g.castle = pick(s, s.castles[g.castle].adj) ?? g.castle;
  }
  // 友好度は少しずつ平常に戻る
  for (const k of Object.keys(s.rel)) {
    const r = s.rel[k];
    if (!r.ally) r.f += r.f < 40 ? 2 : r.f > 50 ? -1 : 0;
  }
}

function deaths(s) {
  for (const g of s.gens) {
    if (g.status !== 'active' && g.status !== 'ronin') continue;
    if (s.year < g.life) continue;
    if (rnd(s) < 1 / 6) {
      const daimyo = isDaimyo(s, g);
      const mine = g.clan === s.player;
      if (daimyo || mine || g.war + g.pol + g.int >= 230) killGen(s, g, daimyo ? '死去した' : '病没した');
      else killGen(s, g, null);
    }
  }
}

function events(s) {
  // 台風
  if ((s.month === 8 || s.month === 9) && chance(s, 0.25)) {
    const c = pick(s, s.castles);
    const hit = [c, ...c.adj.map((a) => s.castles[a])];
    for (const x of hit) {
      x.def = Math.max(50, x.def - 30);
      x.chu = Math.max(0, x.chu - 5);
      x.koku = Math.max(10, Math.round(x.koku * 0.98));
    }
    addNews(s, `${c.prov}一帯を台風が襲った。`, 'disaster');
  }
  // 豊作
  if (s.month === 9 && chance(s, 0.25)) {
    const c = pick(s, s.castles);
    for (const x of [c, ...c.adj.map((a) => s.castles[a])]) x.bumper = true;
    addNews(s, `${c.prov}周辺は豊作となった。`, 'econ');
  }
  // 疫病
  if (chance(s, 0.025)) {
    const c = pick(s, s.castles.filter((x) => x.owner >= 0));
    if (c) {
      for (const g of castleGens(s, c.id)) g.troops = Math.floor((g.troops * 0.85) / 100) * 100;
      addNews(s, `${c.name}で疫病が流行した。`, 'disaster');
    }
  }
  // 一揆
  for (const c of s.castles) {
    if (c.owner < 0 || c.chu >= 30 || !chance(s, 0.12)) continue;
    c.koku = Math.max(10, Math.round(c.koku * 0.95));
    c.def = Math.max(50, c.def - 30);
    c.chu += 10;
    addNews(s, `${c.name}で一揆が起こった！`, 'disaster');
  }
}

const REBEL_COLORS = ['#c9705a', '#8aa05a', '#5a8aa0', '#a05a8a', '#a0905a', '#5aa08a', '#7a6ac0', '#c08a40'];

function rebellions(s) {
  for (const c of s.castles) {
    if (c.owner < 0 || c.lord < 0) continue;
    const g = s.gens[c.lord];
    if (g.kin || isDaimyo(s, g) || g.loyalty >= 30 || g.amb < 65) continue;
    if (!chance(s, 0.03 + (30 - g.loyalty) / 400)) continue;
    rebel(s, g);
  }
  // 不満な武将の出奔
  for (const g of s.gens) {
    if (g.status !== 'active' || g.kin || isDaimyo(s, g) || g.loyalty >= 20) continue;
    if (chance(s, 0.03)) {
      const castle = g.castle;
      const mine = g.clan === s.player;
      makeRonin(s, g, castle);
      refreshLord(s, castle);
      if (mine) addNews(s, `${g.name}が当家を出奔した！`, 'alert');
    }
  }
}

export function rebel(s, g) {
  const castle = s.castles[g.castle];
  const old = g.clan;
  const oldClan = s.clans[old];
  let name = familyName(g.name);
  if (s.clans.some((c) => c.alive && c.name === name)) name = name + '（' + castle.prov + '）';
  const id = s.clans.length;
  s.clans.push({ id, key: name, name, color: REBEL_COLORS[id % REBEL_COLORS.length], kamon: 'kanji', daimyo: g.id, alive: true, gold: 200, rice: 500, home: castle.id, rebel: true });
  const others = castleGens(s, castle.id).filter((x) => x.id !== g.id);
  g.clan = id;
  g.rank = 5;
  g.loyalty = 100;
  setOwner(s, castle.id, id);
  for (const o of others) {
    if (!o.kin && o.loyalty < 60) {
      o.clan = id;
      o.loyalty = 70;
    } else {
      const dest = nearestOwnCastle(s, old, castle.id);
      if (dest >= 0) moveGen(s, o, dest);
      else makeRonin(s, o, castle.id);
    }
  }
  const r = rel(s, id, old);
  r.f = 0;
  refreshLord(s, castle.id);
  addNews(s, `${g.name}が${castle.name}で${oldClan.name}家に謀反！ ${name}家を興した。`, 'betray');
  if (!clanCastles(s, old).length) {
    oldClan.alive = false;
    if (old === s.player) s.over = { win: false, text: '本拠を奪われ、当家は滅亡しました…' };
  }
  checkVictory(s);
}

// ゲームループ。ctx はUI（またはテスト用の自動進行）
//   ctx.playerTurn(s)       プレイヤーの評定（Promise）
//   ctx.battle(s, b)        プレイヤーが関わる合戦（Promise）
//   ctx.ask(s, q)           外交の申し入れ（Promise<boolean>）
//   ctx.decideCaptives(s,l) 捕虜の処遇（Promise<[{gid,action}]>）
//   ctx.chooseReinforcements(s, info)
//   ctx.clanStart(s, cid) / ctx.clanEnd(s, cid)  進行表示用
export async function runGame(s, ctx, { maxMonths = Infinity } = {}) {
  let months = 0;
  while (!s.over && months < maxMonths) {
    if (s.phase === 'begin') {
      beginMonth(s);
      s.order = shuffle(s, s.clans.filter((c) => c.alive).map((c) => c.id));
      s.orderPos = 0;
      s.phase = 'clans';
      if (ctx.monthStart) await ctx.monthStart(s);
    }
    while (s.orderPos < s.order.length && !s.over) {
      const cid = s.order[s.orderPos];
      if (s.clans[cid].alive) {
        if (ctx.clanStart) await ctx.clanStart(s, cid);
        if (cid === s.player) {
          if (!s.corpsDone) {
            await aiCorpsTurn(s, ctx);
            s.corpsDone = true;
          }
          if (!s.over) await ctx.playerTurn(s);
        } else await aiClanTurn(s, cid, ctx);
        if (ctx.clanEnd) await ctx.clanEnd(s, cid);
      }
      s.orderPos++;
    }
    if (s.over) break;
    endMonth(s);
    s.phase = 'begin';
    months++;
  }
  if (s.over && ctx.gameOver) await ctx.gameOver(s);
  return s;
}
