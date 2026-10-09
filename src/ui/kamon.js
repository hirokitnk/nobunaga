// 家紋（簡略図案）をキャンバスに描く
const cache = new Map();

export function clearKamonCache() {
  cache.clear();
}

export function kamonURL(clan, size = 64) {
  const key = `${clan.key}|${clan.color}|${size}`;
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  drawKamon(c.getContext('2d'), clan, size / 2, size / 2, size / 2 - 1);
  const url = c.toDataURL();
  cache.set(key, url);
  return url;
}

export function kamonImg(clan, size = 28, cls = 'kamon') {
  const img = document.createElement('img');
  img.src = kamonURL(clan, size * 2);
  img.width = size;
  img.height = size;
  img.alt = `${clan.name}家の家紋`;
  img.className = cls;
  return img;
}

export function drawKamon(ctx, clan, x, y, r) {
  ctx.save();
  ctx.translate(x, y);
  // 地（旗色）
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = clan.color;
  ctx.fill();
  ctx.lineWidth = Math.max(1, r * 0.08);
  ctx.strokeStyle = '#0c0f18';
  ctx.stroke();
  const ink = '#141821';
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  const R = r * 0.78;
  const ring = () => {
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.lineWidth = r * 0.09;
    ctx.stroke();
  };
  switch (clan.kamon) {
    case 'mokko': { // 木瓜：五弁
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
        ctx.beginPath();
        ctx.ellipse(Math.cos(a) * R * 0.45, Math.sin(a) * R * 0.45, R * 0.42, R * 0.3, a, 0, Math.PI * 2);
        ctx.lineWidth = r * 0.08;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(0, 0, R * 0.16, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'hishi': { // 武田菱
      const d = R * 0.36;
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        ctx.beginPath();
        const cx = dx * d * 1.02, cy = dy * d * 1.02;
        ctx.moveTo(cx, cy - d);
        ctx.lineTo(cx + d, cy);
        ctx.lineTo(cx, cy + d);
        ctx.lineTo(cx - d, cy);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 'uroko': { // 三つ鱗
      const s = R * 0.62;
      const tri = (cx, cy) => {
        ctx.beginPath();
        ctx.moveTo(cx, cy - s * 0.85);
        ctx.lineTo(cx + s * 0.62, cy + s * 0.25);
        ctx.lineTo(cx - s * 0.62, cy + s * 0.25);
        ctx.closePath();
        ctx.fill();
      };
      tri(0, -s * 0.38);
      tri(-s * 0.62, s * 0.72);
      tri(s * 0.62, s * 0.72);
      break;
    }
    case 'hikiryo': { // 丸に二引両
      ring();
      ctx.fillRect(-R * 0.82, -R * 0.42, R * 1.64, R * 0.26);
      ctx.fillRect(-R * 0.82, R * 0.16, R * 1.64, R * 0.26);
      break;
    }
    case 'mitsuboshi': { // 一文字に三つ星
      ctx.fillRect(-R * 0.7, -R * 0.55, R * 1.4, R * 0.2);
      for (const [dx, dy] of [[0, 0.05], [-0.38, 0.55], [0.38, 0.55]]) {
        ctx.beginPath();
        ctx.arc(dx * R, dy * R, R * 0.24, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'jumonji': { // 丸に十字
      ring();
      ctx.fillRect(-R * 0.1, -R * 0.8, R * 0.2, R * 1.6);
      ctx.fillRect(-R * 0.8, -R * 0.1, R * 1.6, R * 0.2);
      break;
    }
    case 'yotsume': { // 四つ目結
      const d = R * 0.38, q = R * 0.3;
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        ctx.save();
        ctx.translate(dx * d, dy * d);
        ctx.rotate(Math.PI / 4);
        ctx.lineWidth = r * 0.1;
        ctx.strokeRect(-q / 2, -q / 2, q, q);
        ctx.restore();
      }
      break;
    }
    case 'sangai': { // 三階菱
      const w = R * 0.95;
      [[-0.55, 0.55], [0, 0.8], [0.55, 1]].forEach(([yy, sc]) => {
        ctx.beginPath();
        ctx.moveTo(0, yy * R - R * 0.22);
        ctx.lineTo((w / 2) * sc, yy * R);
        ctx.lineTo(0, yy * R + R * 0.22);
        ctx.lineTo((-w / 2) * sc, yy * R);
        ctx.closePath();
        ctx.fill();
      });
      break;
    }
    case 'kuyo': { // 九曜
      ctx.beginPath();
      ctx.arc(0, 0, R * 0.3, 0, Math.PI * 2);
      ctx.fill();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * R * 0.66, Math.sin(a) * R * 0.66, R * 0.2, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'tomoe': { // 三つ巴
      for (let i = 0; i < 3; i++) {
        ctx.save();
        ctx.rotate((i / 3) * Math.PI * 2);
        ctx.beginPath();
        ctx.arc(0, -R * 0.38, R * 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(0, 0, R * 0.68, -Math.PI / 2, Math.PI * 0.15);
        ctx.lineWidth = r * 0.12;
        ctx.stroke();
        ctx.restore();
      }
      break;
    }
    case 'aoi': // 三つ葉葵
    case 'katabami': { // 片喰
      ring();
      for (let i = 0; i < 3; i++) {
        ctx.save();
        ctx.rotate((i / 3) * Math.PI * 2);
        ctx.beginPath();
        const yy = -R * 0.38;
        ctx.moveTo(0, yy + R * 0.3);
        ctx.bezierCurveTo(R * 0.5, yy, R * 0.25, yy - R * 0.35, 0, yy - R * 0.12);
        ctx.bezierCurveTo(-R * 0.25, yy - R * 0.35, -R * 0.5, yy, 0, yy + R * 0.3);
        ctx.fill();
        ctx.restore();
      }
      break;
    }
    case 'kikko': { // 亀甲
      const hex = (cx, cy, s) => {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          ctx[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * s, cy + Math.sin(a) * s);
        }
        ctx.closePath();
        ctx.lineWidth = r * 0.09;
        ctx.stroke();
      };
      hex(0, -R * 0.4, R * 0.34);
      hex(-R * 0.36, R * 0.24, R * 0.34);
      hex(R * 0.36, R * 0.24, R * 0.34);
      break;
    }
    case 'hiashi': { // 日足
      ctx.beginPath();
      ctx.arc(0, 0, R * 0.32, 0, Math.PI * 2);
      ctx.fill();
      for (let i = 0; i < 12; i++) {
        ctx.save();
        ctx.rotate((i / 12) * Math.PI * 2);
        ctx.beginPath();
        ctx.moveTo(-R * 0.07, -R * 0.4);
        ctx.lineTo(0, -R * 0.9);
        ctx.lineTo(R * 0.07, -R * 0.4);
        ctx.fill();
        ctx.restore();
      }
      break;
    }
    default: { // 家名の頭文字
      ring();
      ctx.font = `${Math.round(R * 1.15)}px "Yuji Syuku", "Shippori Mincho B1", serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(clan.name[0], 0, R * 0.06);
    }
  }
  ctx.restore();
}
