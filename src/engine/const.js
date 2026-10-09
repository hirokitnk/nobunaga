// ゲーム全体の定数

export const START_YEAR = 1560;
export const START_MONTH = 6;

export const RANK_NAMES = ['足軽頭', '侍大将', '部将', '家老', '宿老', '大名'];
export const RANK_CAP = [1000, 1800, 2800, 3800, 5000, 6000]; // 身分ごとの最大兵数
export const MERIT_REQ = [0, 200, 600, 1300, 2500]; // 昇進に必要な勲功

export const UNIT_NAMES = ['足軽', '騎馬', '鉄砲'];
export const UNIT_SHORT = ['足', '騎', '鉄'];
export const ASHIGARU = 0;
export const CAVALRY = 1;
export const GUNNER = 2;

export const COST = {
  develop: 40, // 開墾・商業・築城 1回あたりの金
  conscript: 0.08, // 徴兵1人あたりの金
  cavalry: 0.25, // 騎馬隊編成 1人あたり
  gun: 0.45, // 鉄砲隊編成 1人あたり（年々安くなる）
  alms: 100, // 施しで配る兵糧
  rumor: 50,
  incite: 80,
  lureBase: 100,
};

export const MAX_SORTIE = 8; // 一度に出陣できる部隊数
export const MAX_DEFENDERS = 10;

export const SEASONS = ['冬', '冬', '春', '春', '春', '夏', '夏', '夏', '秋', '秋', '秋', '冬'];

export function seasonOf(month) {
  return SEASONS[month - 1];
}

export function isWinter(month) {
  return month === 12 || month === 1 || month === 2;
}

export const DIFFICULTY = [
  { name: '初級', aiIncome: 0.85, playerIncome: 1.2, aiAggro: 0.8 },
  { name: '中級', aiIncome: 1.0, playerIncome: 1.0, aiAggro: 1.0 },
  { name: '上級', aiIncome: 1.2, playerIncome: 0.9, aiAggro: 1.2 },
];
