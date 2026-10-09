// 再現可能な乱数（mulberry32）。状態は state.rng に整数で保持するのでセーブ/ロードで再現できる。

export function rnd(s) {
  let t = (s.rng = (s.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function rint(s, a, b) {
  return a + Math.floor(rnd(s) * (b - a + 1));
}

export function rrange(s, a, b) {
  return a + rnd(s) * (b - a);
}

export function chance(s, p) {
  return rnd(s) < p;
}

export function pick(s, arr) {
  return arr.length ? arr[Math.floor(rnd(s) * arr.length)] : undefined;
}

export function shuffle(s, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd(s) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 状態を持たない単発の乱数生成器（戦場の地形生成など、城ごとに固定したいもの用）
export function makeRng(seed) {
  const o = { rng: seed >>> 0 };
  return () => rnd(o);
}
