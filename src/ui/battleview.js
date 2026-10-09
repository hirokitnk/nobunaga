// 合戦画面
import { h, clear, sleep, fmt, reducedMotion, put, setKids } from './dom.js';
import {
  BW, BH, T, T_NAMES, CENTER, DEF_MOD, hexCenter, neighbors, reachable, moveUnit, attackTargets, shootTargets,
  TACTICS, tacticTargets, tacticChance, doAttack, doShoot, doTactic, waitUnit, retreat, endPhase, aiStep,
  aliveUnits, sideTroops, dayOf, weatherNow, WEATHER_NAMES, MAX_TURN, unitAt,
} from '../engine/battle.js';
import { UNIT_NAMES, UNIT_SHORT } from '../engine/const.js';
import { modal } from './dialogs.js';
import { kamonImg } from './kamon.js';

const TCOL = ['#a7ad6c', '#4c7a3c', '#b39a62', '#7a6a58', '#4b80b4', '#d8cdb0', '#eee4c8', '#3a3836', '#7b4b2a', '#8c7b63'];
const SQ3 = Math.sqrt(3);

export function runBattleUI(app, s, b) {
  return new Promise((resolve) => new BattleView(app, s, b, resolve));
}

class BattleView {
  constructor(app, s, b, done) {
    this.app = app;
    this.s = s;
    this.b = b;
    this.done = done;
    this.me = b.playerSide;
    this.sel = -1;
    this.pending = null; // { kind: 'attack'|'shoot'|'tactic', key, targets: Map(tile -> target) }
    this.anim = null;
    this.fx = [];
    this.busy = false;
    this.auto = false;
    this.hoverTile = -1;
    this.speed = app.settings.fast ? 0.35 : 1;
    if (reducedMotion()) this.speed = 0.2;
    this.build();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.field);
    this.resize();
    this.updatePanels();
    setTimeout(() => this.nextPhase(), 400);
  }

  clanOf(side) {
    return this.s.clans[side === 0 ? this.b.attClan : this.b.defClan];
  }

  build() {
    const b = this.b;
    const A = this.clanOf(0), D = this.clanOf(1);
    this.root = h('div', { class: 'battle-screen', role: 'dialog', 'aria-label': `${b.castleName}の戦い` });
    this.info = h('div', { class: 'bh-info' });
    this.bar = h('div', { class: 'bh-bar' });
    this.btnEnd = h('button', { class: 'btn primary', onclick: () => this.playerEndPhase() }, 'ターン終了');
    this.btnAuto = h('button', { class: 'btn', onclick: () => this.toggleAuto(), 'aria-pressed': 'false' }, '全軍委任');
    this.btnRetreat = h('button', { class: 'btn danger', onclick: () => this.askRetreat() }, '撤退');
    this.btnFF = h('button', { class: 'btn', 'aria-pressed': 'false', onclick: () => { this.ff = !this.ff; this.btnFF.classList.toggle('on', this.ff); this.btnFF.setAttribute('aria-pressed', String(this.ff)); } }, '早送り');
    const head = h('header', { class: 'battle-head win' },
      h('div', { class: 'bh-title' }, h('span', { class: 'brush' }, `${b.castleName}の戦い`)),
      h('div', { class: 'bh-sides' },
        h('div', { class: 'bh-side att' }, kamonImg(A, 22), h('span', {}, `${A.name}軍`), h('small', {}, '攻')),
        this.bar,
        h('div', { class: 'bh-side def' }, h('small', {}, '守'), h('span', {}, `${D.name}軍`), kamonImg(D, 22)),
      ),
      this.info,
      h('div', { class: 'bh-btns' }, this.btnFF, this.btnAuto, this.btnRetreat, this.btnEnd),
    );
    this.canvas = h('canvas', { class: 'battle-canvas', 'aria-label': '合戦マップ' });
    this.field = h('div', { class: 'battle-field' }, this.canvas);
    this.unitBox = h('div', { class: 'unit-box' });
    this.actBox = h('div', { class: 'act-box' });
    this.logBox = h('div', { class: 'blog', 'aria-live': 'polite' });
    this.side = h('aside', { class: 'battle-side win' }, this.unitBox, this.actBox, h('div', { class: 'win-sub' }, '戦況'), this.logBox);
    put(this.root, head, h('div', { class: 'battle-main' }, this.field, this.side));
    document.body.appendChild(this.root);
    this.canvas.addEventListener('pointerdown', (e) => this.onClick(e));
    this.canvas.addEventListener('pointermove', (e) => {
      const t = this.tileAt(e);
      if (t !== this.hoverTile) {
        this.hoverTile = t;
        if (this.sel < 0) this.updateUnitBox();
      }
    });
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.field.clientWidth, hh = this.field.clientHeight;
    if (!w || !hh) return;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(hh * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = hh + 'px';
    this.dpr = dpr;
    this.R = Math.min(w / (SQ3 * (BW + 0.5)), hh / (1.5 * (BH - 1) + 2)) * 0.98;
    this.ox = (w - SQ3 * this.R * (BW + 0.5)) / 2 + (SQ3 * this.R) / 2;
    this.oy = (hh - this.R * (1.5 * (BH - 1) + 2)) / 2 + this.R;
  }

  px(i) {
    const [x, y] = hexCenter(i);
    return [this.ox + x * this.R, this.oy + y * this.R];
  }

  tileAt(e) {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    let best = -1, bd = Infinity;
    for (let i = 0; i < BW * BH; i++) {
      const [cx, cy] = this.px(i);
      const d = (cx - x) ** 2 + (cy - y) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return bd <= this.R * this.R ? best : -1;
  }

  // ── 描画 ──
  loop(t) {
    if (!this.root.isConnected) return;
    this.raf = requestAnimationFrame(this.loop);
    this.draw(t);
  }

  hexPath(ctx, x, y, r) {
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = (Math.PI / 3) * k + Math.PI / 6;
      ctx[k ? 'lineTo' : 'moveTo'](x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    ctx.closePath();
  }

  draw(now) {
    const ctx = this.canvas.getContext('2d');
    const b = this.b, R = this.R;
    if (!R) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#10182b';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    // 地形
    for (let i = 0; i < BW * BH; i++) {
      const [x, y] = this.px(i);
      const t = b.tiles[i];
      this.hexPath(ctx, x, y, R);
      ctx.fillStyle = TCOL[t];
      ctx.fill();
      ctx.strokeStyle = 'rgba(20,18,12,0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
      this.terrainGlyph(ctx, t, x, y, R, i);
    }
    // 選択中の部隊の移動範囲・目標
    const u = this.sel >= 0 ? b.units[this.sel] : null;
    if (u && u.state === 'alive' && !this.busy) {
      if (this.reach && !u.moved) {
        for (const [i] of this.reach) {
          if (i === u.tile) continue;
          const [x, y] = this.px(i);
          this.hexPath(ctx, x, y, R * 0.92);
          ctx.fillStyle = 'rgba(120,200,255,0.32)';
          ctx.fill();
        }
      }
      if (this.pending) {
        for (const [i] of this.pending.targets) {
          const [x, y] = this.px(i);
          this.hexPath(ctx, x, y, R * 0.9);
          ctx.lineWidth = 3;
          ctx.strokeStyle = this.pending.kind === 'tactic' ? '#c99cff' : this.pending.kind === 'shoot' ? '#ffb347' : '#ff5a3c';
          ctx.stroke();
        }
      } else if (!u.acted) {
        for (const t of attackTargets(b, u)) {
          const i = t.unit ? t.unit.tile : t.gate;
          const [x, y] = this.px(i);
          this.hexPath(ctx, x, y, R * 0.9);
          ctx.lineWidth = 2;
          ctx.strokeStyle = 'rgba(255,90,60,0.85)';
          ctx.stroke();
        }
      }
    }
    if (this.hoverTile >= 0) {
      const [x, y] = this.px(this.hoverTile);
      this.hexPath(ctx, x, y, R * 0.96);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(255,240,200,0.7)';
      ctx.stroke();
    }
    // 部隊
    for (const un of b.units) {
      if (un.state !== 'alive') continue;
      let [x, y] = this.px(un.tile);
      if (this.anim && this.anim.unit === un.id) [x, y] = this.animPos(now);
      this.drawUnit(ctx, un, x, y, R);
    }
    // エフェクト
    const tn = performance.now();
    this.fx = this.fx.filter((f) => tn - f.t0 < f.dur);
    for (const f of this.fx) {
      const p = (tn - f.t0) / f.dur;
      ctx.globalAlpha = 1 - p * p;
      ctx.font = `bold ${Math.round(R * 0.62)}px "DotGothic16", monospace`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#0b0e16';
      ctx.strokeText(f.text, f.x, f.y - p * R * 0.9);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y - p * R * 0.9);
      ctx.globalAlpha = 1;
    }
  }

  terrainGlyph(ctx, t, x, y, R, i) {
    ctx.save();
    if (t === T.FOREST) {
      ctx.fillStyle = '#2f5428';
      for (const [dx, dy] of [[-0.3, 0.1], [0.25, -0.1], [0, 0.35]]) {
        ctx.beginPath();
        ctx.moveTo(x + dx * R, y + (dy - 0.32) * R);
        ctx.lineTo(x + (dx + 0.2) * R, y + (dy + 0.08) * R);
        ctx.lineTo(x + (dx - 0.2) * R, y + (dy + 0.08) * R);
        ctx.fill();
      }
    } else if (t === T.HILL) {
      ctx.strokeStyle = '#8a7347';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x - R * 0.2, y + R * 0.2, R * 0.28, Math.PI, 0);
      ctx.arc(x + R * 0.25, y + R * 0.25, R * 0.22, Math.PI, 0);
      ctx.stroke();
    } else if (t === T.MOUNT) {
      ctx.fillStyle = '#5a4c3e';
      ctx.beginPath();
      ctx.moveTo(x - R * 0.55, y + R * 0.4);
      ctx.lineTo(x - R * 0.1, y - R * 0.45);
      ctx.lineTo(x + R * 0.15, y + R * 0.0);
      ctx.lineTo(x + R * 0.3, y - R * 0.2);
      ctx.lineTo(x + R * 0.6, y + R * 0.4);
      ctx.fill();
      ctx.fillStyle = '#e8e2d2';
      ctx.beginPath();
      ctx.moveTo(x - R * 0.22, y - R * 0.22);
      ctx.lineTo(x - R * 0.1, y - R * 0.45);
      ctx.lineTo(x + R * 0.0, y - R * 0.25);
      ctx.fill();
    } else if (t === T.RIVER) {
      ctx.strokeStyle = 'rgba(200,230,255,0.55)';
      ctx.lineWidth = 1.2;
      for (const dy of [-0.2, 0.15]) {
        ctx.beginPath();
        ctx.moveTo(x - R * 0.5, y + dy * R);
        ctx.quadraticCurveTo(x, y + (dy - 0.18) * R, x + R * 0.5, y + dy * R);
        ctx.stroke();
      }
    } else if (t === T.WALL) {
      ctx.strokeStyle = 'rgba(160,150,135,0.45)';
      ctx.lineWidth = 1;
      for (let k = -2; k <= 2; k++) {
        ctx.beginPath();
        ctx.moveTo(x - R * 0.7, y + k * R * 0.22);
        ctx.lineTo(x + R * 0.7, y + k * R * 0.22);
        ctx.stroke();
      }
    } else if (t === T.GATE) {
      ctx.fillStyle = '#4a2c18';
      ctx.fillRect(x - R * 0.35, y - R * 0.25, R * 0.7, R * 0.55);
      ctx.fillStyle = '#c9a54c';
      ctx.fillRect(x - R * 0.04, y - R * 0.25, R * 0.08, R * 0.55);
      const hp = this.b.gateHp[i] / this.b.gateMax;
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(x - R * 0.5, y + R * 0.45, R, R * 0.12);
      ctx.fillStyle = hp > 0.5 ? '#9fd36a' : hp > 0.25 ? '#e8c34a' : '#e2553d';
      ctx.fillRect(x - R * 0.5, y + R * 0.45, R * hp, R * 0.12);
    } else if (t === T.HONMARU) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x - R * 0.32, y - R * 0.05, R * 0.64, R * 0.4);
      ctx.fillStyle = '#2b2f3a';
      ctx.beginPath();
      ctx.moveTo(x - R * 0.5, y);
      ctx.lineTo(x, y - R * 0.38);
      ctx.lineTo(x + R * 0.5, y);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x - R * 0.34, y - R * 0.3);
      ctx.lineTo(x, y - R * 0.6);
      ctx.lineTo(x + R * 0.34, y - R * 0.3);
      ctx.fill();
    } else if (t === T.BREACH) {
      ctx.fillStyle = '#5b4d3c';
      for (const [dx, dy] of [[-0.25, 0.1], [0.2, -0.05], [0.05, 0.3]]) {
        ctx.beginPath();
        ctx.arc(x + dx * R, y + dy * R, R * 0.12, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  drawUnit(ctx, u, x, y, R) {
    const clan = this.s.clans[u.clan] || this.clanOf(u.side);
    const mine = u.side === this.me;
    ctx.save();
    if (u.acted && u.side === this.b.phase) ctx.globalAlpha = 0.55;
    const r = R * 0.7;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = clan.color;
    ctx.fill();
    ctx.lineWidth = mine ? 3 : 2;
    ctx.strokeStyle = this.sel === u.id ? '#ffffff' : mine ? '#f3d27a' : '#11141c';
    ctx.stroke();
    ctx.font = `bold ${Math.round(R * 0.62)}px "Yuji Syuku", "Shippori Mincho B1", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(10,12,18,0.9)';
    ctx.strokeText(UNIT_SHORT[u.type], x, y - R * 0.1);
    ctx.fillStyle = '#fff7e2';
    ctx.fillText(UNIT_SHORT[u.type], x, y - R * 0.1);
    ctx.font = `${Math.max(9, Math.round(R * 0.36))}px "DotGothic16", monospace`;
    ctx.strokeText(String(u.troops), x, y + R * 0.38);
    ctx.fillText(String(u.troops), x, y + R * 0.38);
    // 士気
    ctx.fillStyle = '#111';
    ctx.fillRect(x - r, y + r + 1, r * 2, 3);
    ctx.fillStyle = u.morale > 50 ? '#7fd36a' : u.morale > 25 ? '#e8c34a' : '#e2553d';
    ctx.fillRect(x - r, y + r + 1, (r * 2 * u.morale) / 100, 3);
    if (u.leader) {
      ctx.fillStyle = '#c8442f';
      ctx.fillRect(x + r * 0.45, y - r * 1.15, R * 0.42, R * 0.42);
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.round(R * 0.32)}px "Yuji Syuku", serif`;
      ctx.fillText('将', x + r * 0.45 + R * 0.21, y - r * 1.15 + R * 0.22);
    }
    if (u.confused > 0) {
      ctx.fillStyle = '#c99cff';
      ctx.font = `bold ${Math.round(R * 0.34)}px "DotGothic16", monospace`;
      ctx.fillText('乱', x - r * 0.75, y - r * 0.85);
    }
    ctx.restore();
  }

  animPos(now) {
    const a = this.anim;
    const p = Math.min(1, (now - a.t0) / a.dur);
    const seg = p * (a.path.length - 1);
    const k = Math.min(a.path.length - 2, Math.floor(seg));
    const f = seg - k;
    const [x1, y1] = this.px(a.path[Math.max(0, k)]), [x2, y2] = this.px(a.path[Math.min(a.path.length - 1, k + 1)]);
    return [x1 + (x2 - x1) * f, y1 + (y2 - y1) * f];
  }

  async animateMove(unitId, path) {
    if (!path || path.length < 2 || this.eff() <= 0.1) return;
    const dur = Math.min(260, 50 * (path.length - 1)) * this.eff();
    this.anim = { unit: unitId, path, t0: performance.now(), dur };
    await sleep(dur);
    this.anim = null;
  }

  floatText(tile, text, color) {
    const [x, y] = this.px(tile);
    this.fx.push({ x, y, text, color, t0: performance.now(), dur: 1100 * Math.max(0.5, this.speed) });
  }

  showEvent(ev) {
    const b = this.b;
    if (!ev) return;
    if (ev.kind === 'attack') {
      this.floatText(b.units[ev.target].tile, `-${ev.dmg}`, '#ff8a6a');
      if (ev.counter) this.floatText(b.units[ev.unit].tile, `-${ev.counter}`, '#ffd0a0');
    } else if (ev.kind === 'shoot') this.floatText(b.units[ev.target].tile, `-${ev.dmg}`, '#ffb347');
    else if (ev.kind === 'gate') this.floatText(ev.tile, `門-${ev.dmg}`, '#e8c34a');
    else if (ev.kind === 'tactic') {
      const tgt = b.units[ev.target];
      const label = ev.ok ? (ev.key === 'fire' ? `火-${ev.dmg}` : TACTICS[ev.key].name + '！') : '失敗';
      this.floatText(tgt ? tgt.tile : b.units[ev.unit].tile, label, ev.ok ? '#d7b4ff' : '#c9c2b0');
    }
  }

  // ── 進行 ──
  async nextPhase() {
    const b = this.b;
    if (b.result) return this.finish();
    if (b.phase !== this.me || this.auto) {
      await this.runAI();
      if (b.result) return this.finish();
      return this.nextPhase();
    }
    this.busy = false;
    this.selectFirstReady();
    this.updatePanels();
  }

  async runAI() {
    this.busy = true;
    this.sel = -1;
    this.pending = null;
    this.updatePanels();
    const b = this.b;
    let ev;
    while ((ev = aiStep(b))) {
      if (ev.kind === 'ai') {
        for (const e of ev.events) {
          if (e.kind === 'move') await this.animateMove(e.unit, e.path);
          else {
            this.showEvent(e);
            await sleep(170 * this.eff());
          }
        }
      }
      this.updatePanels();
      if (b.result) break;
      if (!this.root.isConnected) return;
    }
    if (!b.result) endPhase(b);
    await sleep(120 * this.eff());
    this.updatePanels();
  }

  eff() {
    return this.speed * (this.ff ? 0.25 : 1) * (this.auto ? 0.6 : 1);
  }

  selectFirstReady() {
    const u = aliveUnits(this.b, this.me).find((x) => !x.acted);
    this.select(u ? u.id : -1);
  }

  select(id) {
    this.sel = id;
    this.pending = null;
    const u = id >= 0 ? this.b.units[id] : null;
    this.reach = u && u.side === this.me && !u.moved && !this.busy ? reachable(this.b, u) : null;
    this.updatePanels();
  }

  async onClick(e) {
    if (this.busy || this.b.result) return;
    const t = this.tileAt(e);
    if (t < 0) return;
    const b = this.b;
    const u = this.sel >= 0 ? b.units[this.sel] : null;
    if (this.pending) {
      const tgt = this.pending.targets.get(t);
      if (tgt) return this.execute(this.pending, tgt);
      this.pending = null;
    }
    const occ = unitAt(b, t);
    if (u && u.side === this.me && !u.acted && occ && occ.side !== u.side) {
      const at = attackTargets(b, u).find((x) => x.unit && x.unit.id === occ.id);
      if (at) return this.execute({ kind: 'attack' }, at);
      const sh = shootTargets(b, u).find((x) => x.id === occ.id);
      if (sh) return this.execute({ kind: 'shoot' }, sh);
    }
    if (u && u.side === this.me && !u.acted && b.tiles[t] === T.GATE && !occ) {
      const at = attackTargets(b, u).find((x) => x.gate === t);
      if (at) return this.execute({ kind: 'attack' }, at);
    }
    if (occ && occ.side === this.me) return this.select(occ.id);
    if (u && u.side === this.me && this.reach && this.reach.has(t) && !u.moved && t !== u.tile) {
      const ev = moveUnit(b, u, t);
      this.busy = true;
      if (ev) await this.animateMove(u.id, ev.path);
      this.busy = false;
      this.reach = null;
      if (b.result) return this.finish();
      this.updatePanels();
      return;
    }
    if (occ) {
      this.sel = occ.id;
      this.reach = null;
      this.updatePanels();
    }
  }

  async execute(p, tgt) {
    const b = this.b;
    const u = b.units[this.sel];
    let ev;
    if (p.kind === 'attack') ev = doAttack(b, u, tgt);
    else if (p.kind === 'shoot') ev = doShoot(b, u, tgt);
    else if (p.kind === 'tactic') ev = doTactic(b, u, p.key, tgt);
    this.pending = null;
    this.showEvent(ev);
    this.updatePanels();
    if (b.result) {
      await sleep(500);
      return this.finish();
    }
    await sleep(150);
    this.selectFirstReady();
  }

  startTargeting(kind, key) {
    const b = this.b;
    const u = b.units[this.sel];
    const targets = new Map();
    if (kind === 'attack') for (const t of attackTargets(b, u)) targets.set(t.unit ? t.unit.tile : t.gate, t);
    else if (kind === 'shoot') for (const t of shootTargets(b, u)) targets.set(t.tile, t);
    else for (const t of tacticTargets(b, u, key)) targets.set(t.tile, t);
    if (kind === 'tactic' && key === 'rally') return this.execute({ kind, key }, u);
    this.pending = { kind, key, targets };
    this.updatePanels();
  }

  playerEndPhase() {
    if (this.busy || this.b.result) return;
    endPhase(this.b);
    this.sel = -1;
    this.reach = null;
    this.nextPhase();
  }

  toggleAuto() {
    this.auto = !this.auto;
    this.btnAuto.setAttribute('aria-pressed', String(this.auto));
    this.btnAuto.classList.toggle('on', this.auto);
    if (this.auto && !this.busy && this.b.phase === this.me) this.nextPhase();
  }

  async askRetreat() {
    if (this.busy || this.b.result) return;
    const ok = await modal({
      title: '撤退',
      body: h('p', {}, this.me === 0 ? '全軍を撤退させます。この合戦は敗北となります。' : '城を捨てて落ち延びます。城は敵の手に渡ります。'),
      buttons: [{ label: 'やめる', value: false }, { label: '撤退する', value: true, danger: true }],
    }).promise;
    if (!ok) return;
    retreat(this.b, this.me);
    this.finish();
  }

  // ── パネル ──
  updatePanels() {
    const b = this.b;
    const day = dayOf(b);
    const A = sideTroops(b, 0), D = sideTroops(b, 1);
    const phaseClan = this.clanOf(b.phase);
    setKids(this.info, 
      h('span', {}, `${day + 1}日目`),
      h('span', { class: `wx ${weatherNow(b)}` }, WEATHER_NAMES[weatherNow(b)]),
      h('span', {}, `ターン ${Math.min(b.turn, MAX_TURN)}/${MAX_TURN}`),
      h('span', { class: 'phase' }, b.result ? '決着' : `${phaseClan.name}軍の手番`),
    );
    const tot = Math.max(1, A + D);
    setKids(this.bar, 
      h('div', { class: 'tbar' },
        h('div', { class: 'tbar-a', style: { width: `${(A / tot) * 100}%`, background: this.clanOf(0).color } }),
        h('div', { class: 'tbar-d', style: { width: `${(D / tot) * 100}%`, background: this.clanOf(1).color } })),
      h('div', { class: 'tbar-num' }, h('span', {}, fmt(A)), h('span', {}, fmt(D))),
    );
    const myTurn = b.phase === this.me && !this.busy && !b.result;
    this.btnEnd.disabled = !myTurn || this.auto;
    this.btnEnd.classList.toggle('pulse', myTurn && !aliveUnits(b, this.me).some((x) => !x.acted));
    this.btnRetreat.disabled = this.busy || !!b.result;
    this.updateUnitBox();
    this.updateActions();
    setKids(this.logBox, ...b.log.slice(-40).map((l) => h('div', { class: 'bl' }, l)));
    this.logBox.scrollTop = this.logBox.scrollHeight;
  }

  updateUnitBox() {
    const b = this.b;
    let u = this.sel >= 0 ? b.units[this.sel] : null;
    let tileInfo = null;
    if (!u && this.hoverTile >= 0) {
      u = unitAt(b, this.hoverTile) || null;
      const t = b.tiles[this.hoverTile];
      tileInfo = h('div', { class: 'tile-info' }, `地形：${T_NAMES[t]}　防御補正 ${Math.round((1 - DEF_MOD[t]) * 100)}%`,
        t === T.GATE ? `　耐久 ${b.gateHp[this.hoverTile]}/${b.gateMax}` : '');
    }
    if (!u) {
      setKids(this.unitBox, h('div', { class: 'unit-empty' }, this.busy ? '敵軍が行動中…' : '部隊を選んでください'), tileInfo);
      return;
    }
    const g = this.s.gens[u.gid];
    const clan = this.s.clans[u.clan];
    setKids(this.unitBox, 
      h('div', { class: 'unit-head' }, kamonImg(clan, 26),
        h('div', {}, h('div', { class: 'unit-name' }, u.name, u.leader ? h('span', { class: 'tag red' }, '総大将') : null),
          h('div', { class: 'unit-sub' }, `${clan.name}軍　${UNIT_NAMES[u.type]}隊　${u.state === 'alive' ? '' : '（退却）'}`))),
      h('div', { class: 'stat-grid' },
        stat('兵数', `${fmt(u.troops)}/${fmt(u.max)}`), stat('士気', u.morale), stat('訓練', u.training),
        stat('戦闘', g.war), stat('智謀', g.int), stat('地形', T_NAMES[b.tiles[u.tile]])),
      u.confused > 0 ? h('div', { class: 'tag purple' }, `混乱中（あと${u.confused}）`) : null,
      tileInfo,
    );
  }

  updateActions() {
    const b = this.b;
    clear(this.actBox);
    const u = this.sel >= 0 ? b.units[this.sel] : null;
    if (!u || u.side !== this.me || b.phase !== this.me || this.busy || b.result) return;
    if (u.acted) {
      put(this.actBox, h('p', { class: 'note' }, 'この部隊は行動済みです。'));
      return;
    }
    if (this.pending) {
      put(this.actBox, 
        h('p', { class: 'note' }, '目標を選んでください（枠で囲まれたマス）'),
        h('button', { class: 'btn', onclick: () => { this.pending = null; this.updatePanels(); } }, '取り消し'),
      );
      return;
    }
    const atk = attackTargets(b, u), sh = shootTargets(b, u);
    const row = h('div', { class: 'act-row' },
      h('button', { class: 'btn', disabled: !atk.length, onclick: () => this.startTargeting('attack') }, '攻撃'),
      u.type === 2 ? h('button', { class: 'btn', disabled: !sh.length, onclick: () => this.startTargeting('shoot') }, weatherNow(b) === 'rain' ? '射撃（雨）' : '射撃') : null,
      h('button', { class: 'btn', onclick: () => { waitUnit(b, u); this.selectFirstReady(); } }, '待機'),
    );
    const tac = h('div', { class: 'act-row tactics' });
    for (const key of Object.keys(TACTICS)) {
      if (!TACTICS[key].ok(u)) continue;
      const tg = tacticTargets(b, u, key);
      const p = tg.length ? Math.round(tacticChance(b, u, key, tg[0]) * 100) : 0;
      put(tac, h('button', { class: 'btn small', disabled: !tg.length, title: TACTICS[key].desc, onclick: () => this.startTargeting('tactic', key) },
        TACTICS[key].name, key !== 'charge' && tg.length ? h('small', {}, ` ${p}%`) : null));
    }
    put(this.actBox, h('div', { class: 'win-sub' }, u.moved ? '行動（移動済み）' : '行動　移動先は水色のマス'), row, tac.childNodes.length ? tac : null);
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    this.busy = true;
    const b = this.b;
    const win = b.result.winner === this.me;
    const lost = (side) => b.units.filter((u) => u.side === side).reduce((a, u) => a + (u.max - (u.state === 'dead' ? 0 : u.troops)), 0);
    const caps = b.captured.map((c) => this.s.gens[c.gid].name);
    const body = h('div', { class: 'result' },
      h('div', { class: `result-big ${win ? 'win' : 'lose'}` }, win ? '勝利' : '敗北'),
      h('p', {}, b.result.reason),
      h('table', { class: 'gtable small' },
        h('tr', {}, h('th', {}, ''), h('th', { class: 'num' }, '損害'), h('th', { class: 'num' }, '残兵')),
        h('tr', {}, h('td', {}, `${this.clanOf(0).name}軍（攻）`), h('td', { class: 'num' }, fmt(lost(0))), h('td', { class: 'num' }, fmt(sideTroops(b, 0)))),
        h('tr', {}, h('td', {}, `${this.clanOf(1).name}軍（守）`), h('td', { class: 'num' }, fmt(lost(1))), h('td', { class: 'num' }, fmt(sideTroops(b, 1))))),
      caps.length ? h('p', {}, `捕縛：${caps.join('、')}`) : null,
    );
    modal({ title: `${b.castleName}の戦い　決着`, body, dismissable: false, buttons: [{ label: '戻る', value: true, primary: true }] }).promise.then(() => {
      cancelAnimationFrame(this.raf);
      this.ro.disconnect();
      this.root.remove();
      this.done(b);
    });
  }
}

function stat(label, v) {
  return h('div', { class: 'stat' }, h('span', { class: 'sl' }, label), h('span', { class: 'sv' }, String(v)));
}
