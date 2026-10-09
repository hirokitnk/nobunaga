import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CASTLE_ROWS } from '../src/data/castles.js';
import { GENERAL_ROWS } from '../src/data/generals.js';
import { CLAN_ROWS } from '../src/data/clans.js';
import { ADJACENCY } from '../src/data/adjacency.js';
import { isLand, project } from '../src/data/geo.js';
import { newGame, clanCastles, castleGens, clanGens } from '../src/engine/state.js';
import { runGame } from '../src/engine/turn.js';
import { aiClanTurn } from '../src/engine/ai.js';
import { serialize, deserialize } from '../src/engine/save.js';
import { cmdDevelop, cmdConscript, cmdTrain, cmdMove, cmdTrade, createCorps } from '../src/engine/actions.js';
import { launchAttack, attackableTargets, sortieCandidates, validateAttack } from '../src/engine/war.js';
import { createBattle, autoResolve, reachable, aliveUnits, CENTER, T } from '../src/engine/battle.js';

const autoCtx = () => {
  const ctx = { playerTurn: (s) => aiClanTurn(s, s.player, ctx) };
  return ctx;
};

function checkInvariants(s) {
  for (const g of s.gens) {
    for (const k of ['troops', 'loyalty', 'merit', 'pol', 'war', 'int', 'training', 'morale']) {
      assert.ok(Number.isFinite(g[k]), `${g.name}.${k} is not finite`);
    }
    assert.notEqual(g.status, 'captive', `${g.name} left as captive`);
    if (g.status === 'active') {
      assert.ok(g.clan >= 0 && s.clans[g.clan].alive, `${g.name} active in dead clan`);
      assert.ok(g.castle >= 0, `${g.name} has no castle`);
      assert.ok(g.troops >= 0 && g.troops <= 6000, `${g.name} troops ${g.troops}`);
    }
  }
  for (const c of s.clans) {
    assert.ok(Number.isFinite(c.gold) && Number.isFinite(c.rice), `${c.name} resources`);
    if (!c.alive) continue;
    const d = s.gens[c.daimyo];
    assert.ok(d && d.status === 'active' && d.clan === c.id, `${c.name} daimyo invalid`);
    assert.ok(clanCastles(s, c.id).length > 0, `${c.name} alive without castles`);
  }
  for (const c of s.castles) {
    if (c.owner >= 0) assert.ok(s.clans[c.owner].alive, `${c.name} owned by dead clan`);
    if (c.lord >= 0) assert.equal(s.gens[c.lord].castle, c.id, `${c.name} lord mismatch`);
  }
}

test('scenario data is consistent', () => {
  const keys = new Set(CASTLE_ROWS.map((r) => r[0]));
  assert.equal(keys.size, CASTLE_ROWS.length, 'duplicate castle keys');
  const clanKeys = new Set(CLAN_ROWS.map((r) => r[0]));
  for (const r of CASTLE_ROWS) {
    assert.ok(isLand(...project(r[3], r[4])), `${r[1]} is in the sea`);
    if (r[5]) assert.ok(clanKeys.has(r[5]), `${r[1]} unknown owner ${r[5]}`);
  }
  const names = new Set();
  for (const g of GENERAL_ROWS) {
    assert.ok(!names.has(g[0]), `duplicate general ${g[0]}`);
    names.add(g[0]);
    if (g[1]) assert.ok(clanKeys.has(g[1]), `${g[0]} unknown clan`);
    assert.ok(g[2] === '*' || keys.has(g[2]), `${g[0]} unknown castle ${g[2]}`);
    for (const v of g.slice(5, 10)) assert.ok(v >= 1 && v <= 100, `${g[0]} stat out of range`);
  }
  for (const [a, b] of ADJACENCY) assert.ok(keys.has(a) && keys.has(b));
  // 各大名家に大名が1人、所有城には武将がいる
  const s = newGame({ seed: 1 });
  for (const c of s.clans) {
    assert.ok(c.daimyo >= 0, `${c.name} has no daimyo`);
    for (const ca of clanCastles(s, c.id)) assert.ok(castleGens(s, ca.id).length > 0, `${ca.name} has no generals`);
  }
});

test('castle graph is connected within each main island', () => {
  const s = newGame({ seed: 1 });
  const seen = new Set([0]);
  const q = [0];
  while (q.length) for (const a of s.castles[q.shift()].adj) if (!seen.has(a)) { seen.add(a); q.push(a); }
  assert.equal(seen.size, s.castles.length, 'every castle reachable (with sea links)');
});

test('20 years of all-AI play keeps invariants', async () => {
  for (const seed of [101, 202]) {
    const s = newGame({ player: '武田', seed });
    const ctx = autoCtx();
    for (let m = 0; m < 240 && !s.over; m++) {
      await runGame(s, ctx, { maxMonths: 1 });
      checkInvariants(s);
    }
    const alive = s.clans.filter((c) => c.alive).length;
    assert.ok(alive >= 2 && alive < 48, `alive clans ${alive}`);
  }
});

test('save/load round trip resumes identically', async () => {
  const s = newGame({ player: '毛利', seed: 77 });
  const ctx = autoCtx();
  await runGame(s, ctx, { maxMonths: 6 });
  const copy = deserialize(serialize(s));
  await runGame(s, ctx, { maxMonths: 6 });
  await runGame(copy, autoCtx(), { maxMonths: 6 });
  assert.equal(serialize(copy), serialize(s));
});

test('player commands validate and apply', () => {
  const s = newGame({ player: '織田', seed: 5 });
  const kiyosu = s.castles.find((c) => c.key === '清洲');
  const gens = castleGens(s, kiyosu.id);
  const g = gens.find((x) => x.pol >= 80);
  const before = kiyosu.koku;
  assert.ok(cmdDevelop(s, g.id, 'koku').ok);
  assert.ok(kiyosu.koku > before);
  assert.equal(cmdDevelop(s, g.id, 'koku').ok, false, 'cannot act twice');
  const w = gens.find((x) => !x.acted && x.troops < 1000);
  const t0 = w.troops;
  assert.ok(cmdConscript(s, w.id, 300).ok);
  assert.ok(w.troops > t0);
  const tr = gens.find((x) => !x.acted && x.troops > 0);
  assert.ok(cmdTrain(s, tr.id).ok);
  const mover = gens.find((x) => !x.acted);
  const inuyama = s.castles.find((c) => c.key === '犬山');
  assert.ok(cmdMove(s, [mover.id], inuyama.id).ok);
  assert.equal(mover.castle, inuyama.id);
  const gold = s.clans[s.player].gold;
  assert.ok(cmdTrade(s, s.player, 200).ok);
  assert.ok(s.clans[s.player].gold < gold);
  const leader = clanGens(s, s.player).find((x) => x.rank >= 2 && x.id !== s.clans[s.player].daimyo);
  assert.ok(createCorps(s, s.player, leader.id, [inuyama.id], 'develop').ok);
});

test('player attack runs a battle and applies the result', async () => {
  const s = newGame({ player: '織田', seed: 9 });
  const targets = attackableTargets(s, s.player);
  assert.ok(targets.length > 0);
  const inaba = s.castles.find((c) => c.key === '稲葉山');
  const gids = sortieCandidates(s, s.player, inaba.id).slice(0, 8).map((g) => g.id);
  assert.equal(validateAttack(s, s.player, inaba.id, gids), null);
  let seen = null;
  const ctx = { battle: async (_s, b) => { seen = b; autoResolve(b); }, decideCaptives: async (_s, list) => list.map((g) => ({ gid: g.id, action: 'release' })) };
  const res = await launchAttack(s, ctx, s.player, inaba.id, gids);
  assert.ok(res.ok && seen && seen.result);
  if (res.won) assert.equal(inaba.owner, s.player);
  checkInvariants(s);
});

test('battle: overwhelming attackers take an empty-ish castle', () => {
  const s = newGame({ seed: 3 });
  const target = s.castles.find((c) => c.key === '岩村');
  const defs = castleGens(s, target.id);
  for (const d of defs) d.troops = 300;
  const att = clanGens(s, s.clans.findIndex((c) => c.key === '武田')).slice(0, 6);
  for (const a of att) { a.troops = 3000; a.training = 80; }
  const b = createBattle({ castleObj: target, attClan: att[0].clan, defClan: target.owner, seed: 1, month: 4,
    attackers: att.map((g) => ({ g, from: 0, dir: [1, 0] })), defenders: defs, reinf: [] });
  assert.ok(b.tiles.filter((t) => t === T.GATE).length >= 3);
  const u = aliveUnits(b, 0)[1];
  assert.ok(reachable(b, u).size > 1, 'attackers can move');
  autoResolve(b);
  assert.equal(b.result.winner, 0, b.result.reason);
  assert.ok(CENTER >= 0);
});
