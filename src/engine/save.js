// セーブ／ロード（localStorage と文字列）
const PREFIX = 'tenshouki-save-';

export function serialize(s) {
  return JSON.stringify(s);
}

export function deserialize(text) {
  const s = JSON.parse(text);
  if (!s || s.v !== 1 || !Array.isArray(s.castles) || !Array.isArray(s.gens)) throw new Error('セーブデータの形式が正しくありません');
  return s;
}

function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function saveSlot(slot, s) {
  const st = storage();
  if (!st) return false;
  try {
    st.setItem(PREFIX + slot, serialize(s));
    st.setItem(PREFIX + slot + '-meta', JSON.stringify({ year: s.year, month: s.month, clan: s.clans[s.player].name, at: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

export function loadSlot(slot) {
  const st = storage();
  if (!st) return null;
  try {
    const t = st.getItem(PREFIX + slot);
    return t ? deserialize(t) : null;
  } catch {
    return null;
  }
}

export function slotMeta(slot) {
  const st = storage();
  if (!st) return null;
  try {
    const t = st.getItem(PREFIX + slot + '-meta');
    return t ? JSON.parse(t) : null;
  } catch {
    return null;
  }
}
