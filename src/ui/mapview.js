// 全国マップ（Canvas）
import { WORLD_W, WORLD_H, LAND_XY, LAKES_XY } from '../data/geo.js';

const RES = 2;
const GW = Math.ceil(WORLD_W / RES), GH = Math.ceil(WORLD_H / RES);

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function valueNoise(seed) {
  const N = 64;
  const g = new Float32Array(N * N);
  let x = seed >>> 0;
  for (let i = 0; i < g.length; i++) {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    g[i] = ((x >>> 0) % 1000) / 1000;
  }
  return (fx, fy) => {
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const at = (i, j) => g[((j & (N - 1)) * N) + (i & (N - 1))];
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
    return a + (b - a) * sy;
  };
}

export class MapView {
  constructor(canvas, { onClick, onHover } = {}) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.onClick = onClick;
    this.onHover = onHover;
    this.s = null;
    this.zoom = 1;
    this.cx = WORLD_W / 2;
    this.cy = WORLD_H / 2;
    this.sel = -1;
    this.hover = -1;
    this.marks = new Map(); // castleId -> 'target' | 'move' | 'reinf'
    this.arrows = [];
    this.dirty = true;
    this.cell = null;
    this.terr = document.createElement('canvas');
    this.terr.width = GW;
    this.terr.height = GH;
    this.seaPattern = null;
    this.pointers = new Map();
    this.bindEvents();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
    const loop = (t) => {
      this.raf = requestAnimationFrame(loop);
      if (this.arrows.length) this.dirty = true;
      if (this.dirty) {
        this.dirty = false;
        this.draw(t);
      }
    };
    this.raf = requestAnimationFrame(loop);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.cv.clientWidth, hh = this.cv.clientHeight;
    if (!w || !hh) return;
    this.dpr = dpr;
    this.cv.width = Math.round(w * dpr);
    this.cv.height = Math.round(hh * dpr);
    this.w = w;
    this.h = hh;
    if (!this.fitted) {
      this.fitAll();
      this.fitted = true;
    }
    this.clampCam();
    this.dirty = true;
  }

  minZoom() {
    return Math.min(this.w / WORLD_W, this.h / WORLD_H) * 0.9;
  }
  fitAll() {
    this.zoom = this.minZoom() / 0.9 * 0.97;
    this.cx = WORLD_W / 2;
    this.cy = WORLD_H / 2;
    this.dirty = true;
  }
  focusCastle(id, zoom) {
    const c = this.s.castles[id];
    this.cx = c.x;
    this.cy = c.y;
    if (zoom) this.zoom = Math.max(this.minZoom(), Math.min(6, zoom));
    this.clampCam();
    this.dirty = true;
  }
  clampCam() {
    this.cx = Math.max(0, Math.min(WORLD_W, this.cx));
    this.cy = Math.max(0, Math.min(WORLD_H, this.cy));
  }
  toScreen(x, y) {
    return [(x - this.cx) * this.zoom + this.w / 2, (y - this.cy) * this.zoom + this.h / 2];
  }
  toWorld(sx, sy) {
    return [(sx - this.w / 2) / this.zoom + this.cx, (sy - this.h / 2) / this.zoom + this.cy];
  }

  setState(s) {
    this.s = s;
    if (!this.cell) this.buildCells();
    this.refresh();
  }

  // 陸塊ごとに最寄りの城へ土地を割り当てる
  buildCells() {
    const off = document.createElement('canvas');
    off.width = GW;
    off.height = GH;
    const c = off.getContext('2d');
    c.scale(1 / RES, 1 / RES);
    LAND_XY.forEach((l, i) => {
      c.fillStyle = `rgb(${(i + 1) * 16},0,0)`;
      c.beginPath();
      l.pts.forEach(([x, y], k) => (k ? c.lineTo(x, y) : c.moveTo(x, y)));
      c.closePath();
      c.fill();
    });
    c.globalCompositeOperation = 'destination-out';
    for (const l of LAKES_XY) {
      c.beginPath();
      l.pts.forEach(([x, y], k) => (k ? c.lineTo(x, y) : c.moveTo(x, y)));
      c.closePath();
      c.fill();
    }
    const img = c.getImageData(0, 0, GW, GH).data;
    const lm = new Int8Array(GW * GH).fill(-1);
    for (let i = 0; i < GW * GH; i++) if (img[i * 4 + 3] >= 128) lm[i] = Math.round(img[i * 4] / 16) - 1;
    const castles = this.s.castles;
    const clm = castles.map((ca) => {
      const gx = Math.floor(ca.x / RES), gy = Math.floor(ca.y / RES);
      for (let r = 0; r < 4; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const v = lm[(gy + dy) * GW + gx + dx];
        if (v >= 0) return v;
      }
      return -1;
    });
    this.cell = new Int16Array(GW * GH).fill(-1);
    for (let gy = 0; gy < GH; gy++) {
      for (let gx = 0; gx < GW; gx++) {
        const i = gy * GW + gx;
        if (lm[i] < 0) continue;
        const x = gx * RES + 1, y = gy * RES + 1;
        let best = -2, bd = Infinity;
        for (let k = 0; k < castles.length; k++) {
          if (clm[k] !== lm[i]) continue;
          const dx = castles[k].x - x, dy = castles[k].y - y;
          const d = dx * dx + dy * dy;
          if (d < bd) { bd = d; best = k; }
        }
        this.cell[i] = best; // -2 = 城のない陸地（蝦夷地など）
      }
    }
    const noise = valueNoise(1560);
    this.shade = new Float32Array(GW * GH);
    for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
      const n = noise(gx / 22, gy / 22) * 0.65 + noise(gx / 6 + 50, gy / 6 + 50) * 0.35;
      this.shade[gy * GW + gx] = n;
    }
  }

  refresh() {
    this.paintTerritory();
    this.dirty = true;
  }

  paintTerritory() {
    const s = this.s;
    const ctx = this.terr.getContext('2d');
    const img = ctx.createImageData(GW, GH);
    const d = img.data;
    const ownerOf = new Int16Array(s.castles.length);
    s.castles.forEach((c, k) => (ownerOf[k] = c.owner));
    const rgb = s.clans.map((c) => hexToRgb(c.color));
    const base = [214, 200, 160];
    const cell = this.cell;
    const sel = this.sel;
    for (let i = 0; i < GW * GH; i++) {
      const k = cell[i];
      if (k === -1) continue;
      const o = k >= 0 ? ownerOf[k] : -1;
      const sh = 0.86 + this.shade[i] * 0.22;
      let r = base[0], g = base[1], b = base[2];
      if (o >= 0) {
        const t = o === s.player ? 0.62 : 0.5;
        r = r * (1 - t) + rgb[o][0] * t;
        g = g * (1 - t) + rgb[o][1] * t;
        b = b * (1 - t) + rgb[o][2] * t;
      } else if (k === -2) {
        r = 170; g = 172; b = 150;
      }
      r *= sh; g *= sh; b *= sh;
      // 境界
      const x = i % GW;
      const right = x + 1 < GW ? cell[i + 1] : -1;
      const down = i + GW < cell.length ? cell[i + GW] : -1;
      const left = x > 0 ? cell[i - 1] : -1;
      const up = i - GW >= 0 ? cell[i - GW] : -1;
      let edge = 0;
      if (right >= 0 && right !== k) edge = ownerOf[right] !== o ? 2 : 1;
      if (edge < 2 && down >= 0 && down !== k) edge = ownerOf[down] !== o ? 2 : Math.max(edge, 1);
      if (edge < 2 && left >= 0 && left !== k) edge = ownerOf[left] !== o ? 2 : Math.max(edge, 1);
      if (edge < 2 && up >= 0 && up !== k) edge = ownerOf[up] !== o ? 2 : Math.max(edge, 1);
      if (edge === 2) { r *= 0.42; g *= 0.4; b *= 0.4; }
      else if (edge === 1) { r *= 0.82; g *= 0.8; b *= 0.78; }
      if (k === sel && k >= 0) { r = r * 0.7 + 255 * 0.3; g = g * 0.7 + 240 * 0.3; b = b * 0.7 + 190 * 0.3; }
      const p = i * 4;
      d[p] = r; d[p + 1] = g; d[p + 2] = b; d[p + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  setSelected(id) {
    if (this.sel === id) return;
    this.sel = id;
    this.refresh();
  }

  setMarks(map) {
    this.marks = map || new Map();
    this.dirty = true;
  }

  addArrow(from, to, color, dur = 900) {
    this.arrows.push({ from, to, color, t0: performance.now(), dur });
    this.dirty = true;
  }

  makeSeaPattern() {
    const t = document.createElement('canvas');
    const W = 28, H = 14;
    t.width = W;
    t.height = H;
    const c = t.getContext('2d');
    c.fillStyle = '#1a2c4e';
    c.fillRect(0, 0, W, H);
    c.strokeStyle = 'rgba(120,160,210,0.16)';
    c.lineWidth = 1;
    const wave = (cx, cy) => {
      for (const r of [12, 8, 4]) {
        c.beginPath();
        c.arc(cx, cy, r, Math.PI, 0);
        c.stroke();
      }
    };
    wave(0, H); wave(W, H); wave(W / 2, H / 2); wave(0, 0); wave(W, 0);
    this.seaPattern = this.ctx.createPattern(t, 'repeat');
  }

  draw(now) {
    const s = this.s;
    const ctx = this.ctx;
    const dpr = this.dpr || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!this.seaPattern) this.makeSeaPattern();
    const z = this.zoom;
    const [ox, oy] = this.toScreen(0, 0);
    ctx.fillStyle = '#16264a';
    ctx.fillRect(0, 0, this.w, this.h);
    if (this.seaPattern.setTransform) {
      const sc = Math.max(0.6, Math.min(1.6, z));
      this.seaPattern.setTransform(new DOMMatrix().translate(ox % (28 * sc), oy % (14 * sc)).scale(sc));
    }
    ctx.fillStyle = this.seaPattern;
    ctx.fillRect(0, 0, this.w, this.h);
    if (!s) return;

    // 陸地と勢力
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(z, z);
    ctx.save();
    ctx.beginPath();
    for (const l of LAND_XY) {
      l.pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
    }
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.terr, 0, 0, GW * RES, GH * RES);
    ctx.restore();
    // 湖
    ctx.fillStyle = '#2b4a78';
    for (const l of LAKES_XY) {
      ctx.beginPath();
      l.pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fill();
    }
    // 海岸線
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(232,220,180,0.55)';
    ctx.lineWidth = 3 / z;
    for (const l of LAND_XY) {
      ctx.beginPath();
      l.pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.stroke();
    }
    ctx.strokeStyle = '#0d1424';
    ctx.lineWidth = 1.3 / z;
    for (const l of LAND_XY) {
      ctx.beginPath();
      l.pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();

    // 街道
    ctx.lineCap = 'round';
    for (const c of s.castles) {
      for (const a of c.adj) {
        if (a < c.id) continue;
        const o = s.castles[a];
        const [x1, y1] = this.toScreen(c.x, c.y), [x2, y2] = this.toScreen(o.x, o.y);
        const sea = Math.hypot(c.x - o.x, c.y - o.y) > 0 && this.isSeaLink(c, o);
        ctx.setLineDash(sea ? [2, 4] : [4, 3]);
        ctx.strokeStyle = sea ? 'rgba(170,205,255,0.55)' : 'rgba(30,24,16,0.38)';
        ctx.lineWidth = sea ? 1.4 : 1.2;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);

    // 城
    const sz = Math.max(5, Math.min(11, 6.5 * Math.sqrt(z)));
    const showNames = z >= 1.05;
    const labels = [];
    for (const c of s.castles) {
      const [x, y] = this.toScreen(c.x, c.y);
      if (x < -40 || y < -40 || x > this.w + 40 || y > this.h + 40) continue;
      const mark = this.marks.get(c.id);
      if (mark) {
        ctx.beginPath();
        ctx.arc(x, y, sz + 6, 0, Math.PI * 2);
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = mark === 'target' ? '#ff5a3c' : mark === 'reinf' ? '#ffd166' : '#7fd1ff';
        ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (c.id === this.sel) {
        ctx.beginPath();
        ctx.arc(x, y, sz + 9, 0, Math.PI * 2);
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#f3d27a';
        ctx.stroke();
      }
      this.drawCastle(ctx, x, y, sz, c);
      if (showNames || c.id === this.sel || c.id === this.hover || (c.owner === s.player && z >= 0.75)) {
        const pri = c.id === this.sel || c.id === this.hover ? 3 : c.owner === s.player ? 2 : 1;
        labels.push({ c, x, y: y + sz + 3, pri });
      }
    }
    // 城名（重なるものは優先度の低い方を省く）
    const fs = Math.round(Math.max(11, Math.min(14, 10 * Math.sqrt(z))));
    ctx.font = `${fs}px "DotGothic16", "MS Gothic", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(10,14,24,0.85)';
    labels.sort((a, b) => b.pri - a.pri);
    const placed = [];
    for (const l of labels) {
      const w = ctx.measureText(l.c.name).width;
      const box = [l.x - w / 2 - 2, l.y - 1, l.x + w / 2 + 2, l.y + fs + 1];
      if (l.pri < 3 && placed.some((p) => box[0] < p[2] && box[2] > p[0] && box[1] < p[3] && box[3] > p[1])) continue;
      placed.push(box);
      ctx.strokeText(l.c.name, l.x, l.y);
      ctx.fillStyle = l.c.owner === s.player ? '#ffe7a3' : '#f1ead6';
      ctx.fillText(l.c.name, l.x, l.y);
    }

    // 出陣の矢印
    const tnow = performance.now();
    this.arrows = this.arrows.filter((a) => tnow - a.t0 < a.dur);
    for (const a of this.arrows) {
      const p = Math.min(1, (tnow - a.t0) / (a.dur * 0.6));
      const f = s.castles[a.from], t = s.castles[a.to];
      const [x1, y1] = this.toScreen(f.x, f.y), [x2, y2] = this.toScreen(t.x, t.y);
      const xe = x1 + (x2 - x1) * p, ye = y1 + (y2 - y1) * p;
      ctx.strokeStyle = a.color;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(xe, ye);
      ctx.stroke();
      const ang = Math.atan2(y2 - y1, x2 - x1);
      ctx.fillStyle = a.color;
      ctx.beginPath();
      ctx.moveTo(xe + Math.cos(ang) * 8, ye + Math.sin(ang) * 8);
      ctx.lineTo(xe + Math.cos(ang + 2.5) * 9, ye + Math.sin(ang + 2.5) * 9);
      ctx.lineTo(xe + Math.cos(ang - 2.5) * 9, ye + Math.sin(ang - 2.5) * 9);
      ctx.fill();
    }
    void now;
  }

  isSeaLink(a, b) {
    // 線分の中点が海なら海路として描く
    const mx = Math.floor((a.x + b.x) / 2 / RES), my = Math.floor((a.y + b.y) / 2 / RES);
    return this.cell[my * GW + mx] === -1;
  }

  drawCastle(ctx, x, y, sz, c) {
    const s = this.s;
    const col = c.owner >= 0 ? s.clans[c.owner].color : '#8d8a80';
    const mine = c.owner === s.player;
    // 石垣
    ctx.fillStyle = '#2a2620';
    ctx.beginPath();
    ctx.moveTo(x - sz, y + sz * 0.75);
    ctx.lineTo(x + sz, y + sz * 0.75);
    ctx.lineTo(x + sz * 0.72, y + sz * 0.15);
    ctx.lineTo(x - sz * 0.72, y + sz * 0.15);
    ctx.closePath();
    ctx.fill();
    // 天守
    ctx.fillStyle = col;
    ctx.fillRect(x - sz * 0.55, y - sz * 0.45, sz * 1.1, sz * 0.62);
    ctx.fillStyle = '#1b1f2a';
    ctx.beginPath();
    ctx.moveTo(x - sz * 0.85, y - sz * 0.4);
    ctx.lineTo(x, y - sz * 1.05);
    ctx.lineTo(x + sz * 0.85, y - sz * 0.4);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = mine ? 2 : 1;
    ctx.strokeStyle = mine ? '#f3d27a' : 'rgba(10,12,18,0.9)';
    ctx.strokeRect(x - sz * 0.55, y - sz * 0.45, sz * 1.1, sz * 0.62);
    const co = s.corps && s.corps.find((k) => k.castles.includes(c.id));
    if (co && sz >= 6) {
      ctx.font = `${Math.round(sz)}px "DotGothic16", monospace`;
      ctx.fillStyle = '#ffe7a3';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(co.id), x + sz * 0.9, y - sz * 0.6);
    }
  }

  hitTest(sx, sy) {
    if (!this.s) return -1;
    let best = -1, bd = 18 * 18;
    for (const c of this.s.castles) {
      const [x, y] = this.toScreen(c.x, c.y);
      const d = (x - sx) ** 2 + (y - sy) ** 2;
      if (d < bd) { bd = d; best = c.id; }
    }
    return best;
  }

  zoomAt(sx, sy, factor) {
    const [wx, wy] = this.toWorld(sx, sy);
    this.zoom = Math.max(this.minZoom(), Math.min(6, this.zoom * factor));
    this.cx = wx - (sx - this.w / 2) / this.zoom;
    this.cy = wy - (sy - this.h / 2) / this.zoom;
    this.clampCam();
    this.dirty = true;
  }

  bindEvents() {
    const cv = this.cv;
    const pos = (e) => {
      const r = cv.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      const [x, y] = pos(e);
      this.pointers.set(e.pointerId, { x, y, sx: x, sy: y });
      this.dragged = false;
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: this.zoom };
      }
    });
    cv.addEventListener('pointermove', (e) => {
      const [x, y] = pos(e);
      const p = this.pointers.get(e.pointerId);
      if (!p) {
        const hv = this.hitTest(x, y);
        if (hv !== this.hover) {
          this.hover = hv;
          cv.style.cursor = hv >= 0 ? 'pointer' : 'grab';
          this.dirty = true;
          if (this.onHover) this.onHover(hv);
        }
        return;
      }
      if (this.pointers.size === 2 && this.pinch) {
        p.x = x;
        p.y = y;
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        this.zoomAt(mx, my, (this.pinch.zoom * (d / this.pinch.d)) / this.zoom);
        this.dragged = true;
        return;
      }
      const dx = x - p.x, dy = y - p.y;
      if (Math.abs(x - p.sx) + Math.abs(y - p.sy) > 6) this.dragged = true;
      if (this.dragged) {
        this.cx -= dx / this.zoom;
        this.cy -= dy / this.zoom;
        this.clampCam();
        this.dirty = true;
        cv.style.cursor = 'grabbing';
      }
      p.x = x;
      p.y = y;
    });
    const up = (e) => {
      const p = this.pointers.get(e.pointerId);
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      if (p && !this.dragged && this.pointers.size === 0) {
        const id = this.hitTest(p.x, p.y);
        if (this.onClick) this.onClick(id);
      }
      cv.style.cursor = 'grab';
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', (e) => {
      this.pointers.delete(e.pointerId);
      this.pinch = null;
    });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [x, y] = pos(e);
      this.zoomAt(x, y, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
  }
}
