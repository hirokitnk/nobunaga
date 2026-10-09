// モーダルダイアログと選択UI
import { h, clear, fmt } from './dom.js';
import { RANK_NAMES, UNIT_NAMES, UNIT_SHORT, RANK_CAP } from '../engine/const.js';

let layer = null;
function getLayer() {
  if (!layer) {
    layer = h('div', { class: 'modal-layer' });
    document.body.appendChild(layer);
  }
  return layer;
}

// buttons: [{ label, value, primary, danger, disabled }]
export function modal({ title, body, buttons = [{ label: '閉じる', value: null }], wide = false, dismissable = true, cls = '' }) {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  const back = h('div', { class: 'modal-back' });
  const foot = h('div', { class: 'modal-foot' });
  const win = h('div', { class: `win modal ${wide ? 'wide' : ''} ${cls}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'ダイアログ' },
    title ? h('div', { class: 'win-title' }, title) : null,
    h('div', { class: 'modal-body' }, body),
    foot,
  );
  back.appendChild(win);
  const close = (v) => {
    if (!back.isConnected) return;
    back.remove();
    document.removeEventListener('keydown', onKey);
    resolve(v);
  };
  const setButtons = (btns) => {
    clear(foot);
    for (const b of btns) {
      const el = h('button', {
        class: `btn ${b.primary ? 'primary' : ''} ${b.danger ? 'danger' : ''}`,
        disabled: b.disabled,
        onclick: () => (b.onClick ? b.onClick(close) : close(b.value)),
      }, b.label);
      foot.appendChild(el);
    }
  };
  setButtons(buttons);
  const onKey = (e) => {
    if (e.key === 'Escape' && dismissable) close(null);
  };
  document.addEventListener('keydown', onKey);
  if (dismissable) back.addEventListener('pointerdown', (e) => { if (e.target === back) close(null); });
  getLayer().appendChild(back);
  setTimeout(() => {
    const f = win.querySelector('button.primary:not([disabled])') || win.querySelector('button:not([disabled])');
    if (f) f.focus({ preventScroll: true });
  }, 0);
  return { promise, close, win, setButtons, foot };
}

export function info(title, body) {
  return modal({ title, body: typeof body === 'string' ? h('p', {}, body) : body }).promise;
}

export function confirmBox(title, text, yes = 'はい', no = 'いいえ') {
  return modal({ title, body: h('p', {}, text), buttons: [{ label: no, value: false }, { label: yes, value: true, primary: true }] }).promise;
}

export function toast(msg, kind = 'info') {
  let box = document.querySelector('.toasts');
  if (!box) {
    box = h('div', { class: 'toasts', 'aria-live': 'polite' });
    document.body.appendChild(box);
  }
  const t = h('div', { class: `toast ${kind}` }, msg);
  box.appendChild(t);
  setTimeout(() => t.classList.add('out'), 2600);
  setTimeout(() => t.remove(), 3200);
}

// ── 武将表 ──
export const COLS = {
  name: { label: '武将', cell: (g) => g.name, cls: 'name' },
  rank: { label: '身分', cell: (g) => RANK_NAMES[g.rank] },
  age: { label: '年齢', cell: (g, s) => s.year - g.birth, num: true },
  pol: { label: '政治', cell: (g) => g.pol, num: true },
  war: { label: '戦闘', cell: (g) => g.war, num: true },
  int: { label: '智謀', cell: (g) => g.int, num: true },
  troops: { label: '兵数', cell: (g) => `${fmt(g.troops)}/${fmt(RANK_CAP[g.rank])}`, num: true },
  type: { label: '兵科', cell: (g) => UNIT_NAMES[g.type] },
  train: { label: '訓練', cell: (g) => g.training, num: true },
  loyal: { label: '忠誠', cell: (g) => (g.kin ? '一門' : g.loyalty), num: true },
  merit: { label: '勲功', cell: (g) => g.merit, num: true },
  amb: { label: '野望', cell: (g) => g.amb, num: true },
  castle: { label: '所在', cell: (g, s) => (g.castle >= 0 ? s.castles[g.castle].name : '—') },
  clan: { label: '所属', cell: (g, s) => (g.clan >= 0 ? s.clans[g.clan].name : '浪人') },
};

export function genTable(s, gens, cols, { onRow, selectable = false, selected = new Set(), disabled = () => false, extra } = {}) {
  const head = h('tr', {}, selectable ? h('th', {}, '') : null, cols.map((c) => h('th', { class: COLS[c]?.num ? 'num' : '' }, COLS[c]?.label ?? c)), extra ? h('th', { class: 'num' }, extra.label) : null);
  const rows = gens.map((g) => {
    const dis = disabled(g);
    const tr = h('tr', { class: `${dis ? 'dis' : ''} ${selected.has(g.id) ? 'sel' : ''}`, tabindex: dis ? null : '0' },
      selectable ? h('td', {}, h('span', { class: 'check' }, selected.has(g.id) ? '◆' : '◇')) : null,
      cols.map((c) => h('td', { class: `${COLS[c].num ? 'num' : ''} ${COLS[c].cls || ''}` }, String(COLS[c].cell(g, s)))),
      extra ? h('td', { class: 'num' }, extra.cell(g)) : null,
    );
    if (!dis && onRow) {
      tr.addEventListener('click', () => onRow(g, tr));
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRow(g, tr); } });
    }
    return tr;
  });
  return h('div', { class: 'table-wrap' }, h('table', { class: 'gtable' }, h('thead', {}, head), h('tbody', {}, rows)));
}

// 1人選ぶ
export function pickGeneral(s, { title, gens, cols = ['name', 'rank', 'pol', 'war', 'int', 'troops'], note, disabled, extra }) {
  let m;
  const body = h('div', {},
    note ? h('p', { class: 'note' }, note) : null,
    gens.length ? genTable(s, gens, cols, { onRow: (g) => m.close(g.id), disabled, extra }) : h('p', { class: 'empty' }, '行動できる武将がいません。'),
  );
  m = modal({ title, body, wide: true, buttons: [{ label: 'やめる', value: null }] });
  return m.promise;
}

// 複数選ぶ
export function pickMany(s, { title, gens, cols, max = 99, note, summary, confirmLabel = '決定', preselect = [] }) {
  const sel = new Set(preselect);
  let m;
  const sumBox = h('div', { class: 'pick-summary' });
  const tableBox = h('div');
  const render = () => {
    clear(tableBox).appendChild(genTable(s, gens, cols, {
      selectable: true, selected: sel,
      onRow: (g) => {
        if (sel.has(g.id)) sel.delete(g.id);
        else if (sel.size < max) sel.add(g.id);
        render();
      },
    }));
    clear(sumBox);
    if (summary) sumBox.appendChild(summary([...sel].map((id) => s.gens[id])));
    if (m) m.setButtons(buttons());
  };
  const buttons = () => [{ label: 'やめる', value: null }, { label: `${confirmLabel}（${sel.size}）`, primary: true, disabled: sel.size === 0, onClick: (close) => close([...sel]) }];
  const body = h('div', {}, note ? h('p', { class: 'note' }, note) : null, tableBox, sumBox);
  render();
  m = modal({ title, body, wide: true, buttons: buttons() });
  return m.promise;
}

export function pickNumber({ title, min, max, step = 100, value, label, describe }) {
  let v = Math.max(min, Math.min(max, value ?? max));
  const out = h('div', { class: 'num-out' });
  const desc = h('div', { class: 'note' });
  const range = h('input', { type: 'range', min, max, step, value: v, id: 'num-range', 'aria-label': label || title });
  const upd = () => {
    out.textContent = `${label || ''} ${fmt(v)}`;
    desc.textContent = describe ? describe(v) : '';
  };
  range.addEventListener('input', () => { v = +range.value; upd(); });
  upd();
  const quick = h('div', { class: 'quick' },
    [0.25, 0.5, 0.75, 1].map((f) => h('button', { class: 'btn small', onclick: () => { v = Math.max(min, Math.round((max * f) / step) * step); range.value = v; upd(); } }, f === 1 ? '最大' : `${f * 100}%`)),
  );
  return modal({ title, body: h('div', { class: 'num-pick' }, out, range, quick, desc), buttons: [{ label: 'やめる', value: null }, { label: '決定', primary: true, onClick: (close) => close(v) }] }).promise;
}

export function pickOption(title, options, note) {
  let m;
  const body = h('div', { class: 'opt-list' },
    note ? h('p', { class: 'note' }, note) : null,
    options.map((o) => h('button', { class: 'btn opt', disabled: o.disabled, onclick: () => m.close(o.value) },
      h('span', { class: 'opt-label' }, o.label), o.sub ? h('span', { class: 'opt-sub' }, o.sub) : null)),
  );
  m = modal({ title, body, buttons: [{ label: 'やめる', value: null }] });
  return m.promise;
}

export function unitBadge(g) {
  return h('span', { class: `ubadge t${g.type}` }, UNIT_SHORT[g.type]);
}
