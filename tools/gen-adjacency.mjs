// 陸地上のボロノイ分割から城どうしの隣接関係を生成し src/data/adjacency.js に書き出す
// 使い方: node tools/gen-adjacency.mjs
import { writeFileSync } from 'node:fs';
import { WORLD_W, WORLD_H, project, LAND_XY, LAKES_XY, pointInPoly } from '../src/data/geo.js';
import { CASTLE_ROWS, SEA_LINKS, DENY_LINKS } from '../src/data/castles.js';

// 陸塊ID（-1=海）。城は同じ陸塊の土地だけを勢力圏とする
function landmass(x, y) {
  for (const l of LAKES_XY) if (pointInPoly(x, y, l.pts)) return -1;
  for (let i = 0; i < LAND_XY.length; i++) if (pointInPoly(x, y, LAND_XY[i].pts)) return i;
  return -1;
}

const RES = 2;
const GW = Math.ceil(WORLD_W / RES), GH = Math.ceil(WORLD_H / RES);
const castles = CASTLE_ROWS.map((r) => {
  const [x, y] = project(r[3], r[4]);
  return { key: r[0], x, y, lm: landmass(x, y) };
});

let bad = 0;
for (const c of castles) {
  if (c.lm < 0) { console.error(`海上にある城: ${c.key} (${c.x.toFixed(0)},${c.y.toFixed(0)})`); bad++; }
}
const keys = new Set();
for (const c of castles) { if (keys.has(c.key)) { console.error('重複キー', c.key); bad++; } keys.add(c.key); }
for (let i = 0; i < castles.length; i++) for (let j = i + 1; j < castles.length; j++) {
  const d = Math.hypot(castles[i].x - castles[j].x, castles[i].y - castles[j].y);
  if (d < 12) console.warn(`近すぎる城: ${castles[i].key} - ${castles[j].key} (${d.toFixed(1)})`);
}

const owner = new Int16Array(GW * GH).fill(-1);
for (let gy = 0; gy < GH; gy++) {
  for (let gx = 0; gx < GW; gx++) {
    const x = gx * RES + RES / 2, y = gy * RES + RES / 2;
    const lm = landmass(x, y);
    if (lm < 0) continue;
    let best = -1, bd = Infinity;
    for (let i = 0; i < castles.length; i++) {
      if (castles[i].lm !== lm) continue;
      const dx = castles[i].x - x, dy = castles[i].y - y;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    owner[gy * GW + gx] = best;
  }
}

const border = new Map();
const add = (a, b) => {
  if (a < 0 || b < 0 || a === b) return;
  const k = a < b ? `${a},${b}` : `${b},${a}`;
  border.set(k, (border.get(k) || 0) + 1);
};
for (let gy = 0; gy < GH; gy++) {
  for (let gx = 0; gx < GW; gx++) {
    const o = owner[gy * GW + gx];
    if (o < 0) continue;
    if (gx + 1 < GW) add(o, owner[gy * GW + gx + 1]);
    if (gy + 1 < GH) add(o, owner[(gy + 1) * GW + gx]);
  }
}

const pairs = [];
for (const [k, n] of border) {
  const [a, b] = k.split(',').map(Number);
  const d = Math.hypot(castles[a].x - castles[b].x, castles[a].y - castles[b].y);
  const ka = castles[a].key, kb = castles[b].key;
  if (DENY_LINKS.some(([p, q]) => (p === ka && q === kb) || (p === kb && q === ka))) continue;
  if (n >= 4 && d < 260) pairs.push([ka, kb]);
}
for (const [a, b] of SEA_LINKS) {
  if (!keys.has(a) || !keys.has(b)) { console.error('海路のキー不明', a, b); bad++; continue; }
  if (!pairs.some(([p, q]) => (p === a && q === b) || (p === b && q === a))) pairs.push([a, b]);
}
pairs.sort((p, q) => (p[0] + p[1]).localeCompare(q[0] + q[1]));

// 孤立チェック
const deg = new Map(castles.map((c) => [c.key, 0]));
for (const [a, b] of pairs) { deg.set(a, deg.get(a) + 1); deg.set(b, deg.get(b) + 1); }
for (const [k, d] of deg) if (d === 0) { console.error('孤立した城:', k); bad++; }

const body = pairs.map(([a, b]) => `  ['${a}', '${b}'],`).join('\n');
writeFileSync(new URL('../src/data/adjacency.js', import.meta.url),
  `// 自動生成: node tools/gen-adjacency.mjs （手で編集しないでください）\nexport const ADJACENCY = [\n${body}\n];\n`);
console.log(`城 ${castles.length} / 隣接 ${pairs.length} 件を書き出しました`);
if (bad) process.exitCode = 1;
