// タイトル画面と大名選択
import { h, clear, fmt, put } from './dom.js';
import { modal, toast } from './dialogs.js';
import { MapView } from './mapview.js';
import { kamonImg } from './kamon.js';
import { newGame, clanCastles, clanGens, clanTroops } from '../engine/state.js';
import { loadSlot, slotMeta } from '../engine/save.js';
import { DIFFICULTY } from '../engine/const.js';
import { showHelp } from './help.js';

export function showTitle(app) {
  const root = app.root;
  clear(root);
  const auto = slotMeta('auto');
  const anySlot = ['1', '2', '3'].some((k) => slotMeta(k));
  const btns = h('div', { class: 'title-btns' },
    h('button', { class: 'btn primary big', onclick: () => clanSelect(app) }, '新しく始める'),
    auto ? h('button', { class: 'btn big', onclick: () => resume(app, 'auto') }, h('span', {}, '続きから'), h('small', {}, `${auto.clan}家 ${auto.year}年${auto.month}月`)) : null,
    anySlot ? h('button', { class: 'btn big', onclick: () => pickSlot(app) }, '記録から再開') : null,
    h('button', { class: 'btn big', onclick: () => showHelp() }, '遊び方'),
  );
  put(root, h('div', { class: 'title-screen' },
    h('div', { class: 'title-inner' },
      h('div', { class: 'title-sub' }, '戦国群雄伝'),
      h('h1', { class: 'title-main' }, h('span', { class: 'brush' }, '天翔記')),
      h('div', { class: 'seal', 'aria-label': '非公式' }, '非公式'),
      h('p', { class: 'title-tag' }, '永禄三年（一五六〇）初夏。桶狭間に今川義元が斃れ、天下は群雄割拠の世へ。'),
      btns,
      h('p', { class: 'title-foot' }, '『信長の野望・天翔記』に着想を得た非公式のファンメイド作品です。地図・能力値・図案はすべて独自に作成しています。'),
    )));
}

function resume(app, slot) {
  const s = loadSlot(slot);
  if (!s) return toast('読み込めませんでした', 'err');
  app.start(s);
}

async function pickSlot(app) {
  const k = await new Promise((resolve) => {
    const m = modal({
      title: '記録から再開',
      body: h('div', { class: 'opt-list' }, ['1', '2', '3'].map((sl) => {
        const meta = slotMeta(sl);
        return h('button', { class: 'btn opt', disabled: !meta, onclick: () => m.close(sl) }, h('span', { class: 'opt-label' }, `記録 ${sl}`), h('span', { class: 'opt-sub' }, meta ? `${meta.clan}家　${meta.year}年${meta.month}月` : '（空き）'));
      })),
      buttons: [{ label: 'やめる', value: null }],
    });
    m.promise.then(resolve);
  });
  if (k) resume(app, k);
}

function sizeTag(n) {
  return n >= 6 ? ['大', 'gold'] : n >= 3 ? ['中', ''] : ['小', 'red'];
}

function clanSelect(app) {
  const root = app.root;
  clear(root);
  const preview = newGame({ player: '織田', seed: 1 });
  let sel = preview.player;
  let diff = 1;
  const canvas = h('canvas', { class: 'map', 'aria-label': '大名を選ぶ地図' });
  const listEl = h('div', { class: 'clan-pick-list' });
  const detail = h('div', { class: 'clan-detail' });
  const diffEl = h('div', { class: 'seg' });
  const clans = preview.clans.slice().sort((a, b) => clanCastles(preview, b.id).length - clanCastles(preview, a.id).length || clanTroops(preview, b.id) - clanTroops(preview, a.id));
  const map = new MapView(canvas, {
    onClick: (id) => {
      if (id >= 0 && preview.castles[id].owner >= 0) choose(preview.castles[id].owner, false);
    },
  });
  const choose = (id, focus = true) => {
    sel = id;
    preview.player = id;
    map.setState(preview);
    const home = preview.gens[preview.clans[id].daimyo].castle;
    map.setSelected(home);
    if (focus) map.focusCastle(home, Math.max(map.zoom, 1.4));
    render();
  };
  const render = () => {
    listEl.replaceChildren(...clans.map((c) => {
      const n = clanCastles(preview, c.id).length;
      const [t, cls] = sizeTag(n);
      const b = h('button', { class: `clan-row ${c.id === sel ? 'on' : ''}`, 'aria-pressed': String(c.id === sel), onclick: () => choose(c.id) },
        kamonImg(c, 24), h('span', { class: 'cr-name' }, `${c.name}家`),
        h('span', { class: 'cr-sub' }, preview.gens[c.daimyo].name),
        h('span', { class: `tag ${cls}` }, t), h('span', { class: 'cr-rel' }, `城${n}`));
      return b;
    }));
    const c = preview.clans[sel];
    const d = preview.gens[c.daimyo];
    const gens = clanGens(preview, sel);
    const best = gens.slice().sort((a, b) => b.pol + b.war + b.int - a.pol - a.war - a.int).slice(0, 4).map((g) => g.name).join('・');
    detail.replaceChildren(
      h('div', { class: 'cd-head' }, kamonImg(c, 48), h('div', {}, h('div', { class: 'brush cd-name' }, `${c.name}家`), h('div', { class: 'muted' }, `当主 ${d.name}（${preview.year - d.birth}歳）`))),
      h('div', { class: 'stat-grid' },
        stat('城', clanCastles(preview, sel).length), stat('武将', gens.length), stat('兵', fmt(clanTroops(preview, sel))),
        stat('政治', d.pol), stat('戦闘', d.war), stat('智謀', d.int)),
      h('p', { class: 'small' }, `主な家臣：${best}`),
    );
    diffEl.replaceChildren(...DIFFICULTY.map((dd, i) => h('button', { class: `chip ${diff === i ? 'on' : ''}`, 'aria-pressed': String(diff === i), onclick: () => { diff = i; render(); } }, dd.name)));
  };
  const startBtn = h('button', { class: 'btn primary big', onclick: () => {
    map.destroy();
    const key = preview.clans[sel].key;
    app.start(newGame({ player: key, difficulty: diff, seed: Math.floor(Math.random() * 2 ** 31) }));
  } }, 'この家で始める');
  put(root, h('div', { class: 'select-screen' },
    h('header', { class: 'topbar win' }, h('div', { class: 'brush tb-name' }, '大名を選ぶ'), h('div', { class: 'muted small' }, '地図の城か一覧から選んでください'),
      h('div', { class: 'tb-btns' }, h('button', { class: 'btn', onclick: () => { map.destroy(); showTitle(app); } }, '戻る'))),
    h('main', { class: 'stage' },
      h('div', { class: 'map-wrap' }, canvas),
      h('aside', { class: 'panel win select-panel' }, detail, h('div', { class: 'win-sub' }, '難易度'), diffEl, startBtn, h('div', { class: 'win-sub' }, '大名家（城の多い順）'), listEl)),
  ));
  choose(sel);
}

function stat(label, v) {
  return h('div', { class: 'stat' }, h('span', { class: 'sl' }, label), h('span', { class: 'sv' }, String(v)));
}
