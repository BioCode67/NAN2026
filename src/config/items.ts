/**
 * 아이템 정의.
 *
 * 아이템은 캐릭터 몸에 그리지 않는다. 캐릭터 주변 오라 + 머리 위 아이콘으로
 * 표현하므로 스프라이트가 없어도 전부 동작한다.
 * (나중에 손에 쥐게 바꾸려면 포즈별 앵커 좌표만 추가하면 된다)
 */

export type ItemId =
  | 'buyback'
  | 'stockOption'
  | 'algoTrading'
  | 'circuitBreaker'
  | 'leverage';

export interface ItemMods {
  /** 공격력 배율 */
  atkMul?: number;
  /** 이동속도 배율 */
  speedMul?: number;
  /** 스킬 쿨다운 배율 (작을수록 빠름) */
  cooldownMul?: number;
  /** 받는 피해 배율 (작을수록 튼튼) */
  damageTakenMul?: number;
  /** 흡수 배율 가산 (0.5 = 흡수량 +50%p) */
  absorbBonus?: number;
}

export interface ItemConfig {
  id: ItemId;
  name: string;
  /** 한 줄 설명 — 획득 시 화면에 뜬다 */
  desc: string;
  /** 머리 위 아이콘. 나중에 스프라이트로 교체 가능 */
  icon: string;
  /** 오라 색 */
  color: number;
  /** 지속 시간(ms). 0이면 즉시 발동 후 사라진다 */
  duration: number;
  /** 지속형 효과 */
  mods?: ItemMods;
  /** 즉시 주가 변동(%) */
  instantStock?: number;
  /** 드랍 가중치 — 클수록 자주 나온다 */
  weight: number;
}

export const ITEMS: Record<ItemId, ItemConfig> = {
  /* 즉시 회복형 — 위기에서 뒤집는 용도 */
  buyback: {
    id: 'buyback',
    name: '자사주 매입',
    desc: '주가 +40%',
    icon: '💰',
    color: 0x4ade80,
    duration: 0,
    instantStock: 40,
    weight: 22,
  },

  /* 정공법 — 무난하게 강하다 */
  stockOption: {
    id: 'stockOption',
    name: '스톡옵션',
    desc: '공격력 +50% (12초)',
    icon: '⚔️',
    color: 0xfbbf24,
    duration: 12000,
    mods: { atkMul: 1.5 },
    weight: 24,
  },

  /* 기동형 — 도망치거나 파고들 때 */
  algoTrading: {
    id: 'algoTrading',
    name: '알고리즘 매매',
    desc: '이동속도 +40%, 쿨다운 -40% (12초)',
    icon: '👟',
    color: 0x38bdf8,
    duration: 12000,
    mods: { speedMul: 1.4, cooldownMul: 0.6 },
    weight: 22,
  },

  /* 방어형 — 난전에서 버티기 */
  circuitBreaker: {
    id: 'circuitBreaker',
    name: '서킷브레이커',
    desc: '받는 피해 -50% (12초)',
    icon: '🛡️',
    color: 0x93c5fd,
    duration: 12000,
    mods: { damageTakenMul: 0.5 },
    weight: 20,
  },

  /* 하이리스크 — 게임의 테마에 가장 맞는 아이템 */
  leverage: {
    id: 'leverage',
    name: '레버리지',
    desc: '공격력 2배, 받는 피해 +60% (10초)',
    icon: '🚀',
    color: 0xf472b6,
    duration: 10000,
    mods: { atkMul: 2.0, damageTakenMul: 1.6, absorbBonus: 0.5 },
    weight: 12,
  },
};

export const ITEM_LIST: ItemConfig[] = Object.values(ITEMS);

/** 가중치에 따라 아이템 하나를 고른다 */
export function rollItem(rand: () => number): ItemConfig {
  const total = ITEM_LIST.reduce((s, i) => s + i.weight, 0);
  let r = rand() * total;

  for (const item of ITEM_LIST) {
    r -= item.weight;
    if (r <= 0) return item;
  }
  return ITEM_LIST[0]!;
}
