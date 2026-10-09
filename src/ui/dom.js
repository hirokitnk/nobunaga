// 最小限のDOMヘルパー

export function h(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, v);
  }
  appendKids(e, children);
  return e;
}

function appendKids(e, kids) {
  for (const c of kids.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    e.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(e) {
  while (e.firstChild) e.removeChild(e.firstChild);
  return e;
}

// null/false を無視して子要素を追加する（ネイティブの append は null を文字列化してしまう）
export function put(e, ...kids) {
  appendKids(e, kids);
  return e;
}

export function setKids(e, ...kids) {
  clear(e);
  appendKids(e, kids);
  return e;
}

export const $ = (sel, root = document) => root.querySelector(sel);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

export const reducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

export function fmt(n) {
  return Math.round(n).toLocaleString('ja-JP');
}

export function storageGet(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

export function storageSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 保存できない環境では無視 */
  }
}
