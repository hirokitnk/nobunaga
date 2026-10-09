// 評定コマンドの操作フロー
import { h, fmt } from './dom.js';
import { modal, info, confirmBox, toast, pickGeneral, pickMany, pickNumber, pickOption, genTable } from './dialogs.js';
import { kamonImg } from './kamon.js';
import { COST, MAX_SORTIE, RANK_NAMES, RANK_CAP, UNIT_NAMES, ASHIGARU, CAVALRY, GUNNER, MERIT_REQ } from '../engine/const.js';
import {
  castleGens, clanGens, clanCastles, roninAt, reachableOwn, frontDistance, rel, isDaimyo, clanPowerScore,
  clanTroops, isHostile, capOf,
} from '../engine/state.js';
import {
  cmdDevelop, cmdAlms, cmdConscript, cmdTrain, cmdEquip, cmdMove, cmdTransfer, cmdRecruit, cmdReward, cmdPromote,
  cmdExile, cmdDiplomacy, cmdIntrigue, cmdTrade, recruitChance, rewardEffect, canPromote, acceptChance, lureChance,
  equipPrice, conscriptUnitCost, createCorps, disbandCorps, kokuStr,
} from '../engine/actions.js';
import { attackableTargets, sortieCandidates, validateAttack, launchAttack, riceForSortie, snowBlocked, reinforcementCandidates, battleOdds } from '../engine/war.js';

export const CMD_GROUPS = [
  { key: 'naisei', label: '内政', cmds: [['koku', '開墾'], ['shogyo', '商業'], ['def', '築城'], ['alms', '施し']] },
  { key: 'gunji', label: '軍事', cmds: [['attack', '出陣'], ['conscript', '徴兵'], ['train', '訓練'], ['equip', '兵装'], ['move', '移動'], ['transfer', '再編']] },
  { key: 'jinji', label: '人事', cmds: [['recruit', '登用'], ['reward', '褒美'], ['promote', '昇進'], ['exile', '追放'], ['corps', '軍団']] },
  { key: 'gaiko', label: '外交', cmds: [['gift', '親善'], ['alliance', '同盟'], ['truce', '停戦'], ['break', '手切れ'], ['surrender', '降伏勧告']] },
  { key: 'choryaku', label: '調略', cmds: [['lure', '引抜'], ['rumor', '流言'], ['incite', '扇動']] },
  { key: 'shonin', label: '商人', cmds: [['buy', '兵糧を買う'], ['sell', '兵糧を売る']] },
];

const ready = (s, cid) => castleGens(s, cid).filter((g) => !g.acted);

function report(app, r) {
  if (!r) return;
  toast(r.msg, r.ok ? (r.refused ? 'warn' : 'ok') : 'err');
  app.refresh();
}

export async function runCommand(app, cid, cmd) {
  const s = app.s;
  const P = s.player;
  const castle = s.castles[cid];
  switch (cmd) {
    // ── 内政 ──
    case 'koku':
    case 'shogyo':
    case 'def': {
      const label = { koku: '開墾', shogyo: '商業', def: '築城' }[cmd];
      const cur = { koku: `石高 ${kokuStr(castle.koku)} / ${kokuStr(castle.kokuMax)}`, shogyo: `商業 ${castle.shogyo} / ${castle.shogyoMax}`, def: `城防御 ${castle.def} / ${castle.defMax}` }[cmd];
      const est = (g) => cmd === 'koku' ? `+${((g.pol / 12 + 1.5) * (0.6 + castle.chu / 250) / 10).toFixed(1)}万` : cmd === 'shogyo' ? `+${Math.round(g.pol / 7 + 2)}` : `+${Math.round(g.pol / 6 + g.war / 12 + 2.5)}`;
      const gid = await pickGeneral(s, {
        title: `${label}（金${COST.develop}）`, gens: ready(s, cid).sort((a, b) => b.pol - a.pol),
        cols: ['name', 'rank', 'pol', 'war'], note: `${castle.name}　${cur}　政治の高い武将ほど効果が大きい`,
        extra: { label: '見込み', cell: est },
      });
      if (gid != null) report(app, cmdDevelop(s, gid, cmd));
      return;
    }
    case 'alms': {
      const gid = await pickGeneral(s, { title: `施し（兵糧${COST.alms}）`, gens: ready(s, cid).sort((a, b) => b.pol - a.pol), cols: ['name', 'rank', 'pol'], note: `${castle.name}　民忠 ${castle.chu}　民忠が高いほど収入が増え、一揆が起きにくい` });
      if (gid != null) report(app, cmdAlms(s, gid));
      return;
    }
    // ── 軍事 ──
    case 'attack':
      return attackFlow(app, cid, null);
    case 'conscript': {
      const gens = ready(s, cid).filter((g) => g.troops < capOf(g)).sort((a, b) => b.war - a.war);
      const gid = await pickGeneral(s, { title: '徴兵', gens, cols: ['name', 'rank', 'war', 'troops', 'type', 'train'], note: `${castle.name}　徴兵可能 ${fmt(castle.pool)}人　1人あたり金${COST.conscript}（兵科の装備代は別）` });
      if (gid == null) return;
      const g = s.gens[gid];
      const per = conscriptUnitCost(s, g);
      const max = Math.floor(Math.min(capOf(g) - g.troops, castle.pool, s.clans[P].gold / per) / 100) * 100;
      if (max < 100) return report(app, { ok: false, msg: '金か徴兵可能な人数が足りません' });
      const n = await pickNumber({ title: `${g.name}隊に徴兵`, min: 100, max, step: 100, value: max, label: '人数', describe: (v) => `費用 金${Math.ceil(v * per)}　民忠 -${Math.round(v / 400)}` });
      if (n != null) report(app, cmdConscript(s, gid, n));
      return;
    }
    case 'train': {
      const gid = await pickGeneral(s, { title: '訓練', gens: ready(s, cid).filter((g) => g.troops > 0 && g.training < 100).sort((a, b) => a.training - b.training), cols: ['name', 'rank', 'war', 'troops', 'train'], note: '戦闘の高い武将ほど訓練が進む' });
      if (gid != null) report(app, cmdTrain(s, gid));
      return;
    }
    case 'equip': {
      const gid = await pickGeneral(s, { title: '兵装', gens: ready(s, cid).filter((g) => g.troops > 0), cols: ['name', 'rank', 'war', 'int', 'troops', 'type'], note: `騎馬隊は平地の突撃に強く、鉄砲隊は2マス先を撃てる（雨天不可）。${castle.port ? '' : 'この城は港がないため鉄砲が割高です。'}` });
      if (gid == null) return;
      const g = s.gens[gid];
      const opt = await pickOption(`${g.name}隊の兵科`, [ASHIGARU, CAVALRY, GUNNER].map((t) => ({
        value: t, label: UNIT_NAMES[t] + '隊', disabled: g.type === t,
        sub: g.type === t ? '現在の兵科' : `金${Math.ceil(g.troops * equipPrice(s, castle, t))}${g.flags.includes('騎') && t === CAVALRY ? '　騎馬適性あり' : ''}${g.flags.includes('鉄') && t === GUNNER ? '　鉄砲適性あり' : ''}`,
      })));
      if (opt != null) report(app, cmdEquip(s, gid, opt));
      return;
    }
    case 'move': {
      const dests = reachableOwn(s, cid, P);
      if (!dests.length) return info('移動', '移動できる自領の城がありません。');
      const gids = await pickMany(s, { title: '移動する武将', gens: ready(s, cid), cols: ['name', 'rank', 'war', 'troops', 'type'], confirmLabel: '次へ' });
      if (!gids) return;
      const fd = frontDistance(s, P);
      const dest = await pickOption('移動先', dests.map((d) => ({ value: d, label: s.castles[d].name, sub: `${s.castles[d].prov}　武将${castleGens(s, d).length}人${fd.get(d) === 0 ? '　前線' : ''}` })));
      if (dest != null) report(app, cmdMove(s, gids, dest));
      return;
    }
    case 'transfer': {
      const gens = castleGens(s, cid);
      const from = await pickGeneral(s, { title: '再編：兵を出す武将', gens: gens.filter((g) => g.troops > 0), cols: ['name', 'rank', 'troops', 'type', 'train'], note: '同じ城の武将どうしで兵を移します（行動は消費しません）' });
      if (from == null) return;
      const to = await pickGeneral(s, { title: '再編：兵を受け取る武将', gens: gens.filter((g) => g.id !== from && g.troops < capOf(g)), cols: ['name', 'rank', 'troops', 'type', 'train'] });
      if (to == null) return;
      const max = Math.min(s.gens[from].troops, capOf(s.gens[to]) - s.gens[to].troops);
      const n = await pickNumber({ title: '移す兵数', min: 100, max, step: 100, value: max, label: '人数' });
      if (n != null) report(app, cmdTransfer(s, from, to, n));
      return;
    }
    // ── 人事 ──
    case 'recruit': {
      const rs = roninAt(s, cid);
      if (!rs.length) return info('登用', `${castle.name}には浪人がいません。浪人は毎年各地を放浪します。`);
      const rid = await pickGeneral(s, { title: '登用する浪人', gens: rs, cols: ['name', 'age', 'pol', 'war', 'int', 'amb'] });
      if (rid == null) return;
      const gid = await pickGeneral(s, { title: '説得する武将', gens: ready(s, cid), cols: ['name', 'rank', 'pol', 'int'], extra: { label: '成功率', cell: (g) => `${Math.round(recruitChance(s, g, s.gens[rid]) * 100)}%` } });
      if (gid != null) report(app, cmdRecruit(s, gid, rid));
      return;
    }
    case 'reward': {
      const gens = castleGens(s, cid).filter((g) => !isDaimyo(s, g) && !g.kin).sort((a, b) => a.loyalty - b.loyalty);
      const gid = await pickGeneral(s, { title: '褒美', gens, cols: ['name', 'rank', 'loyal', 'amb', 'merit'], note: '金を与えて忠誠を上げます（行動は消費しません）。忠誠が低いと引き抜かれたり謀反を起こしたりします。' });
      if (gid == null) return;
      const g = s.gens[gid];
      const amt = await pickOption(`${g.name}への褒美（忠誠 ${g.loyalty}）`, [50, 100, 200, 400].map((a) => ({ value: a, label: `金${a}`, sub: `忠誠 +${rewardEffect(g, a)}`, disabled: s.clans[P].gold < a })));
      if (amt != null) report(app, cmdReward(s, P, gid, amt));
      return;
    }
    case 'promote': {
      const gens = clanGens(s, P).filter(canPromote);
      if (!gens.length) return info('昇進', `昇進できる武将はいません。（必要勲功：侍大将${MERIT_REQ[1]}・部将${MERIT_REQ[2]}・家老${MERIT_REQ[3]}・宿老${MERIT_REQ[4]}）`);
      const gid = await pickGeneral(s, { title: '昇進', gens, cols: ['name', 'rank', 'merit', 'loyal', 'castle'], note: '身分が上がると率いる兵の上限が増え、忠誠も上がります', extra: { label: '昇進後', cell: (g) => `${RANK_NAMES[g.rank + 1]}（${fmt(RANK_CAP[g.rank + 1])}）` } });
      if (gid != null) report(app, cmdPromote(s, gid));
      return;
    }
    case 'exile': {
      const gid = await pickGeneral(s, { title: '追放', gens: castleGens(s, cid).filter((g) => !isDaimyo(s, g)), cols: ['name', 'rank', 'pol', 'war', 'int', 'loyal'] });
      if (gid == null) return;
      if (await confirmBox('追放', `${s.gens[gid].name}を追放します。よろしいですか？`)) report(app, cmdExile(s, gid));
      return;
    }
    case 'corps':
      return corpsFlow(app);
    // ── 外交 ──
    case 'gift':
    case 'alliance':
    case 'truce':
    case 'break':
    case 'surrender':
      return diplomacyFlow(app, cid, cmd, null);
    // ── 調略 ──
    case 'lure':
    case 'rumor':
    case 'incite':
      return intrigueFlow(app, cid, cmd, null);
    // ── 商人 ──
    case 'buy':
    case 'sell': {
      const clan = s.clans[P];
      const price = s.ricePrice;
      const max = cmd === 'buy' ? Math.floor(clan.gold / price) * 100 : Math.floor(clan.rice / 100) * 100;
      if (max < 100) return info('商人', cmd === 'buy' ? '金が足りません。' : '売る兵糧がありません。');
      const n = await pickNumber({
        title: cmd === 'buy' ? `兵糧を買う（相場 100につき金${price}）` : `兵糧を売る（相場 100につき金${Math.floor(price * 0.8)}）`,
        min: 100, max, step: 100, value: Math.min(max, 1000), label: '兵糧',
        describe: (v) => (cmd === 'buy' ? `支払い 金${Math.ceil((v / 100) * price)}` : `受け取り 金${Math.floor((v / 100) * price * 0.8)}`) + '　秋（9〜11月）は米が安い',
      });
      if (n != null) report(app, cmdTrade(s, P, cmd === 'buy' ? n : -n));
      return;
    }
  }
}

// ── 出陣 ──
export async function attackFlow(app, fromCid, targetCid) {
  const s = app.s;
  const P = s.player;
  let target = targetCid;
  if (target == null) {
    const opts = s.castles[fromCid].adj.filter((a) => attackableTargets(s, P).includes(a));
    if (!opts.length) return info('出陣', 'この城から攻め込める敵城はありません。（同盟・停戦中の相手は攻められません）');
    app.map.setMarks(new Map(opts.map((o) => [o, 'target'])));
    target = await pickOption('攻撃目標', opts.map((o) => {
      const c = s.castles[o];
      const owner = c.owner >= 0 ? s.clans[c.owner].name + '家' : '空き城';
      const troops = castleGens(s, o).reduce((a, g) => a + g.troops, 0);
      return { value: o, label: c.name, sub: `${owner}　守兵 ${fmt(troops)}　城防御 ${c.def}${snowBlocked(s, fromCid, o) ? '　（雪で出陣不可）' : ''}`, disabled: snowBlocked(s, fromCid, o) };
    }));
    app.map.setMarks(null);
    if (target == null) return;
  }
  const t = s.castles[target];
  const cands = sortieCandidates(s, P, target).sort((a, b) => b.troops - a.troops);
  if (!cands.length) return info('出陣', '出陣できる武将がいません。（行動済み、兵100未満、または雪）');
  const defs = castleGens(s, target);
  const defTroops = defs.reduce((a, g) => a + g.troops, 0);
  const reinf = t.owner >= 0 ? reinforcementCandidates(s, t.owner, target) : [];
  const reinfTroops = reinf.reduce((a, e) => a + e.g.troops, 0);
  const pre = cands.filter((g) => g.castle === fromCid).slice(0, MAX_SORTIE).map((g) => g.id);
  const gids = await pickMany(s, {
    title: `${t.name}へ出陣`, gens: cands, cols: ['name', 'rank', 'war', 'int', 'troops', 'type', 'train', 'castle'], max: MAX_SORTIE,
    preselect: pre.length ? pre : [cands[0].id], confirmLabel: '出陣',
    note: `敵：${t.owner >= 0 ? s.clans[t.owner].name + '家' : '空き城'}　守兵 ${fmt(defTroops)}（${defs.length}部隊）　城防御 ${t.def}　周辺の援軍候補 ${fmt(reinfTroops)}　／　最大${MAX_SORTIE}部隊。身分の最も高い武将が総大将になります`,
    summary: (gens) => {
      const tt = gens.reduce((a, g) => a + g.troops, 0);
      const rice = riceForSortie(gens);
      const leader = gens.slice().sort((a, b) => (b.id === s.clans[P].daimyo) - (a.id === s.clans[P].daimyo) || b.rank - a.rank || b.war - a.war)[0];
      const odds = gens.length ? battleOdds(s, P, target, gens) : null;
      return h('div', { class: 'sortie-sum' },
        `総兵力 ${fmt(tt)}　必要兵糧 ${fmt(rice)}（所持 ${fmt(s.clans[P].rice)}）`,
        leader ? `　総大将：${leader.name}` : '',
        odds ? h('span', { class: `odds ${odds.cls}` }, `勝算：${odds.label}`) : null);
    },
  });
  if (!gids) return;
  const err = validateAttack(s, P, target, gids);
  if (err) return report(app, { ok: false, msg: err });
  app.map.addArrow(s.gens[gids[0]].castle, target, '#f3d27a');
  const res = await launchAttack(s, app.ctx, P, target, gids);
  report(app, { ok: res.ok, msg: res.msg, refused: res.ok && !res.won });
}

// ── 外交 ──
export async function diplomacyFlow(app, cid, kind, targetClan) {
  const s = app.s;
  const P = s.player;
  const clans = s.clans.filter((c) => c.alive && c.id !== P);
  let target = targetClan;
  const label = { gift: '親善', alliance: '同盟', truce: '停戦', break: '手切れ', surrender: '降伏勧告' }[kind];
  if (target == null) {
    const list = clans.filter((c) => {
      const r = rel(s, P, c.id);
      if (kind === 'break') return r.ally;
      if (kind === 'alliance') return !r.ally;
      if (kind === 'truce') return !r.ally && r.truce <= 0;
      return true;
    });
    if (!list.length) return info(label, '対象となる大名家がありません。');
    target = await pickClan(app, `${label}：相手を選ぶ`, list, kind);
    if (target == null) return;
  }
  const tc = s.clans[target];
  if (kind === 'break') {
    if (!(await confirmBox('手切れ', `${tc.name}家との同盟を破棄します。諸大名からの信用も落ちます。よろしいですか？`))) return;
  }
  const envoys = ready(s, cid).sort((a, b) => b.pol - a.pol);
  const extra = kind === 'alliance' || kind === 'truce' || kind === 'surrender'
    ? { label: '成功率', cell: (g) => `${Math.round(Math.min(0.95, acceptChance(s, target, P, kind, g) + (kind === 'truce' ? 0.15 : 0)) * 100)}%` } : undefined;
  const gid = await pickGeneral(s, { title: `${label}の使者`, gens: envoys, cols: ['name', 'rank', 'pol', 'int'], extra, note: `${tc.name}家　友好度 ${rel(s, P, target).f}` });
  if (gid == null) return;
  let gold = 0;
  if (kind === 'gift') {
    gold = await pickOption('贈る金', [100, 300, 500, 1000].map((a) => ({ value: a, label: `金${a}`, disabled: s.clans[P].gold < a, sub: `友好 +${Math.round((a / 20) * (0.5 + s.gens[gid].pol / 100))}` })));
    if (gold == null) return;
  } else if (kind === 'truce') {
    gold = await pickOption('手土産', [0, 300, 600].map((a) => ({ value: a, label: a ? `金${a}` : 'なし', disabled: s.clans[P].gold < a, sub: a ? `成功率 +${Math.round((a / 2000) * 100)}%` : '' })));
    if (gold == null) return;
  }
  report(app, cmdDiplomacy(s, gid, target, kind, gold));
}

function pickClan(app, title, list, kind) {
  const s = app.s;
  const P = s.player;
  let m;
  const myP = clanPowerScore(s, P);
  const rows = list.sort((a, b) => clanCastles(s, b.id).length - clanCastles(s, a.id).length).map((c) => {
    const r = rel(s, P, c.id);
    const status = r.ally ? '同盟' : r.truce > 0 ? `停戦${r.truce}月` : '';
    const ratio = clanPowerScore(s, c.id) / Math.max(1, myP);
    const btn = h('button', { class: 'clan-row', onclick: () => m.close(c.id) },
      kamonImg(c, 24),
      h('span', { class: 'cr-name' }, `${c.name}家`),
      h('span', { class: 'cr-sub' }, `${s.gens[c.daimyo]?.name ?? ''}　城${clanCastles(s, c.id).length}　兵${fmt(clanTroops(s, c.id))}`),
      h('span', { class: 'cr-rel' }, `友好${r.f}${status ? '・' + status : ''}`),
      kind === 'surrender' ? h('span', { class: 'cr-rel' }, `国力比 ${ratio.toFixed(2)}`) : null,
    );
    return btn;
  });
  m = modal({ title, body: h('div', { class: 'clan-list' }, rows), wide: true, buttons: [{ label: 'やめる', value: null }] });
  return m.promise;
}

// ── 調略 ──
export async function intrigueFlow(app, cid, kind, preTarget) {
  const s = app.s;
  const P = s.player;
  const label = { lure: '引抜', rumor: '流言', incite: '扇動' }[kind];
  const agents = ready(s, cid).sort((a, b) => b.int - a.int);
  if (!agents.length) return info(label, '行動できる武将がいません。');
  const agentId = await pickGeneral(s, { title: `${label}を行う武将`, gens: agents, cols: ['name', 'rank', 'int', 'pol'], note: '智謀の高い武将ほど成功しやすい（忍びの特性があればさらに有利）' });
  if (agentId == null) return;
  const agent = s.gens[agentId];
  const near = new Set();
  for (const c of clanCastles(s, P)) for (const a of c.adj) if (s.castles[a].owner >= 0 && s.castles[a].owner !== P) near.add(a);
  if (kind === 'incite') {
    let target = preTarget;
    if (target == null) {
      const list = [...near];
      if (!list.length) return info(label, '近隣に他家の城がありません。');
      target = await pickOption('扇動する城', list.map((c) => ({ value: c, label: s.castles[c].name, sub: `${s.clans[s.castles[c].owner].name}家　民忠 ${s.castles[c].chu}` })), `費用 金${COST.incite}`);
      if (target == null) return;
    }
    return report(app, cmdIntrigue(s, agentId, 'incite', target));
  }
  let gens;
  if (preTarget != null) gens = castleGens(s, preTarget);
  else {
    gens = [];
    for (const c of near) gens.push(...castleGens(s, c));
  }
  gens = gens.filter((g) => !isDaimyo(s, g)).sort((a, b) => a.loyalty - b.loyalty);
  if (!gens.length) return info(label, '近隣に調略できる武将がいません。');
  if (kind === 'lure') {
    const tid = await pickGeneral(s, { title: '引き抜く武将', gens, cols: ['name', 'clan', 'rank', 'war', 'int', 'loyal', 'troops'], note: '成功すると兵ごと寝返ります。費用は次で選びます。', extra: { label: '成功率', cell: (g) => `${Math.round(lureChance(s, agent, g, 300) * 100)}%` } });
    if (tid == null) return;
    const gold = await pickOption('用意する金', [100, 300, 600, 1000].map((a) => ({ value: a, label: `金${a}`, disabled: s.clans[P].gold < a, sub: `成功率 ${Math.round(lureChance(s, agent, s.gens[tid], a) * 100)}%` })));
    if (gold == null) return;
    return report(app, cmdIntrigue(s, agentId, 'lure', tid, gold));
  }
  const tid = await pickGeneral(s, { title: '流言の標的', gens, cols: ['name', 'clan', 'rank', 'int', 'loyal'], note: `標的の忠誠を下げます。費用 金${COST.rumor}` });
  if (tid != null) report(app, cmdIntrigue(s, agentId, 'rumor', tid));
}

// ── 軍団 ──
export async function corpsFlow(app) {
  const s = app.s;
  const P = s.player;
  const POL = { develop: '内政重視', defend: '防衛', attack: '攻略' };
  const mine = s.corps.filter((c) => c.clan === P);
  const body = h('div', {},
    h('p', { class: 'note' }, '軍団に任せた城は、毎月の評定の前に軍団長が自動で内政・徴兵・訓練を行います。「攻略」では隣接する敵城へ自ら出陣します。資金は当家の金の一部（約3割）を使います。'),
    mine.length ? h('div', { class: 'corps-list' }, mine.map((co) => h('div', { class: 'corps-row' },
      h('span', { class: 'tag' }, `第${co.id}軍団`),
      h('span', {}, `軍団長 ${co.leader >= 0 ? s.gens[co.leader].name : '（不在）'}`),
      h('span', {}, POL[co.policy]),
      h('span', { class: 'muted' }, co.castles.map((c) => s.castles[c].name).join('・')),
      h('button', { class: 'btn small', onclick: async () => { report(app, disbandCorps(s, co.id)); m.close(null); } }, '解散'),
    ))) : h('p', { class: 'empty' }, '軍団はまだありません。'),
  );
  const m = modal({ title: '軍団', body, wide: true, buttons: [{ label: '閉じる', value: null }, { label: '軍団を編成', primary: true, value: 'new' }] });
  if ((await m.promise) !== 'new') return;
  const leaders = clanGens(s, P).filter((g) => g.rank >= 2 && !isDaimyo(s, g)).sort((a, b) => b.rank - a.rank || b.pol + b.war - a.pol - a.war);
  const lid = await pickGeneral(s, { title: '軍団長（部将以上）', gens: leaders, cols: ['name', 'rank', 'pol', 'war', 'int', 'castle'] });
  if (lid == null) return;
  const cs = clanCastles(s, P);
  const sel = new Set([s.gens[lid].castle]);
  const box = h('div', { class: 'castle-checks' });
  const render = () => {
    box.replaceChildren(...cs.map((c) => h('button', { class: `chip ${sel.has(c.id) ? 'on' : ''}`, 'aria-pressed': String(sel.has(c.id)), onclick: () => { sel.has(c.id) ? sel.delete(c.id) : sel.add(c.id); render(); } },
      c.name, s.corps.find((co) => co.castles.includes(c.id)) ? '＊' : '')));
  };
  render();
  const ok = await modal({ title: '任せる城（＊は他の軍団から移る）', body: box, wide: true, buttons: [{ label: 'やめる', value: null }, { label: '次へ', value: true, primary: true }] }).promise;
  if (!ok || !sel.size) return;
  const policy = await pickOption('方針', Object.entries(POL).map(([k, v]) => ({ value: k, label: v, sub: k === 'develop' ? '開発を優先し、兵は控えめに' : k === 'defend' ? '前線の守りを固める' : '機を見て敵城を攻める' })));
  if (policy == null) return;
  report(app, createCorps(s, P, lid, [...sel], policy));
}

// ── 情報 ──
export function showGeneral(app, gid) {
  const s = app.s;
  const g = s.gens[gid];
  const clan = g.clan >= 0 ? s.clans[g.clan] : null;
  const flags = [...g.flags].map((f) => ({ 騎: '騎馬', 鉄: '鉄砲', 水: '水軍', 忍: '忍び' }[f])).filter(Boolean);
  const bar = (label, v) => h('div', { class: 'sbar' }, h('span', { class: 'sl' }, label), h('span', { class: 'track' }, h('span', { class: 'fill', style: { width: `${v}%` } })), h('span', { class: 'sv' }, String(v)));
  const body = h('div', { class: 'gen-card' },
    h('div', { class: 'gc-head' }, clan ? kamonImg(clan, 40) : null,
      h('div', {}, h('div', { class: 'gc-name brush' }, g.name),
        h('div', { class: 'muted' }, `${clan ? clan.name + '家' : '浪人'}　${g.status === 'active' ? RANK_NAMES[isDaimyo(s, g) ? 5 : g.rank] : ''}　${s.year - g.birth}歳　${g.castle >= 0 ? s.castles[g.castle].name : ''}`))),
    bar('政治', g.pol), bar('戦闘', g.war), bar('智謀', g.int), bar('野望', g.amb),
    h('div', { class: 'stat-grid' },
      h('div', { class: 'stat' }, h('span', { class: 'sl' }, '兵'), h('span', { class: 'sv' }, `${fmt(g.troops)}（${UNIT_NAMES[g.type]}）`)),
      h('div', { class: 'stat' }, h('span', { class: 'sl' }, '訓練'), h('span', { class: 'sv' }, String(g.training))),
      h('div', { class: 'stat' }, h('span', { class: 'sl' }, '忠誠'), h('span', { class: 'sv' }, g.kin ? '一門' : String(g.loyalty))),
      h('div', { class: 'stat' }, h('span', { class: 'sl' }, '勲功'), h('span', { class: 'sv' }, String(g.merit))),
      h('div', { class: 'stat' }, h('span', { class: 'sl' }, '特性'), h('span', { class: 'sv' }, flags.join('・') || '—')),
      h('div', { class: 'stat' }, h('span', { class: 'sl' }, '状態'), h('span', { class: 'sv' }, g.acted ? '行動済' : '待機')),
    ),
  );
  return info('武将', body);
}

export function showLists(app, which) {
  const s = app.s;
  const P = s.player;
  if (which === 'gens') {
    const gens = clanGens(s, P).sort((a, b) => b.rank - a.rank || b.merit - a.merit);
    let m;
    m = modal({ title: `${s.clans[P].name}家 武将一覧（${gens.length}人）`, wide: true, body: genTable(s, gens, ['name', 'rank', 'age', 'pol', 'war', 'int', 'troops', 'type', 'train', 'loyal', 'merit', 'castle'], { onRow: (g) => { m.close(null); showGeneral(app, g.id); } }) });
    return m.promise;
  }
  if (which === 'castles') {
    const cs = clanCastles(s, P);
    const fd = frontDistance(s, P);
    const rows = cs.map((c) => {
      const gs = castleGens(s, c.id);
      const tr = h('tr', { tabindex: '0', onclick: () => { m.close(null); app.selectCastle(c.id, true); } },
        h('td', { class: 'name' }, c.name, fd.get(c.id) === 0 ? h('span', { class: 'tag red' }, '前線') : null),
        h('td', {}, c.prov), h('td', {}, c.lord >= 0 ? s.gens[c.lord].name : '—'),
        h('td', { class: 'num' }, kokuStr(c.koku)), h('td', { class: 'num' }, c.shogyo), h('td', { class: 'num' }, c.def), h('td', { class: 'num' }, c.chu),
        h('td', { class: 'num' }, gs.length), h('td', { class: 'num' }, fmt(gs.reduce((a, g) => a + g.troops, 0))));
      return tr;
    });
    const m = modal({ title: `${s.clans[P].name}家 城一覧`, wide: true, body: h('div', { class: 'table-wrap' }, h('table', { class: 'gtable' },
      h('thead', {}, h('tr', {}, ['城', '国', '城主', '石高', '商業', '防御', '民忠', '武将', '兵'].map((x, i) => h('th', { class: i >= 3 ? 'num' : '' }, x)))),
      h('tbody', {}, rows))) });
    return m.promise;
  }
  if (which === 'clans') {
    const list = s.clans.filter((c) => c.alive).sort((a, b) => clanCastles(s, b.id).length - clanCastles(s, a.id).length);
    const rows = list.map((c) => {
      const r = c.id === P ? null : rel(s, P, c.id);
      return h('tr', {},
        h('td', { class: 'name' }, kamonImg(c, 18), ` ${c.name}家`),
        h('td', {}, s.gens[c.daimyo]?.name ?? ''),
        h('td', { class: 'num' }, clanCastles(s, c.id).length), h('td', { class: 'num' }, clanGens(s, c.id).length),
        h('td', { class: 'num' }, fmt(clanTroops(s, c.id))),
        h('td', { class: 'num' }, r ? r.f : '—'),
        h('td', {}, c.id === P ? '当家' : r.ally ? '同盟' : r.truce > 0 ? `停戦（残${r.truce}月）` : isHostile(s, P, c.id) ? '' : ''));
    });
    return modal({ title: `勢力一覧（${list.length}家）`, wide: true, body: h('div', { class: 'table-wrap' }, h('table', { class: 'gtable' },
      h('thead', {}, h('tr', {}, ['大名家', '当主', '城', '武将', '兵力', '友好', '関係'].map((x, i) => h('th', { class: i >= 2 && i <= 5 ? 'num' : '' }, x)))),
      h('tbody', {}, rows))) }).promise;
  }
  if (which === 'log') {
    const items = s.log.slice().reverse().slice(0, 200).map((e) => h('div', { class: `log-item ${e.kind}` }, h('span', { class: 'ld' }, `${e.y}年${e.m}月`), e.text));
    return modal({ title: '年表', wide: true, body: h('div', { class: 'log-list' }, items) }).promise;
  }
}

