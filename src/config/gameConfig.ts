import Phaser from 'phaser';
import { StockTier } from '../types';
import type {
  AttackConfig,
  AttackDir,
  AIDifficulty,
  MoveSlot,
  TierEffect,
} from '../types';

/* ------------------------------------------------------------------ */
/* 기본 상수                                                           */
/* ------------------------------------------------------------------ */

export const GAME = {
  /** 화면(뷰포트) 해상도 — 실제 표시는 Scale.FIT으로 자동 조정 */
  WIDTH: 1280,
  HEIGHT: 720,

  /**
   * 월드 가로 폭. 화면보다 넓고 카메라가 따라다닌다.
   *
   * 4인 난투에서 화면 폭(1280)에 맞춘 발판은 너무 좁아
   * 서로 밀치기만 하게 된다. 도망칠 공간이 있어야 거리 싸움이 생긴다.
   */
  WORLD_WIDTH: 1920,

  /** 중력 가속도 */
  GRAVITY: 2200,

  /** 한글이 깨지지 않는 폰트 스택 */
  FONT: '"Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif',

  /** 배경색 */
  BG_COLOR: '#0b1020',
} as const;

/**
 * 스테이지(맵) 규격.
 *
 * 4인 난투에서는 지면 하나만 두면 전원이 한 줄에 뭉쳐 밀치기 싸움이 된다.
 * 공중 발판을 둬 도망·기습·낙하 공격 같은 선택지를 만든다.
 */
export const STAGE = {
  /** 지면 윗면 Y좌표 */
  GROUND_Y: 590,
  /** 지면 두께 */
  GROUND_H: 40,
  /** 지면 좌측 끝 */
  LEFT: 90,
  /** 지면 우측 끝 */
  RIGHT: 1830,
  /** 이 Y좌표 아래로 떨어지면 장외 → 즉시 상장폐지 */
  BLAST_BOTTOM: 900,
  /** 좌우 장외 여유 */
  BLAST_MARGIN: 260,

  /**
   * 공중 발판. 아래에서 점프해 통과할 수 있고 위에서만 착지한다.
   */
  PLATFORMS: [
    { x: 330, y: 440, w: 250 },
    { x: 1590, y: 440, w: 250 },
    { x: 700, y: 330, w: 230 },
    { x: 1220, y: 330, w: 230 },
    { x: 960, y: 215, w: 200 },
  ],
  /** 공중 발판 두께 */
  PLATFORM_H: 18,
} as const;

/** 렌더링 깊이(z-order) */
export const DEPTH = {
  BG: 0,
  STAGE: 5,
  AURA: 8,
  FIGHTER: 10,
  HITBOX_DEBUG: 15,
  IMPACT: 20,
  FLOATING: 30,
  DIALOGUE: 35,
  HUD: 100,
  OVERLAY: 200,
} as const;

/* ------------------------------------------------------------------ */
/* 주가(스톡) 시스템                                                   */
/* ------------------------------------------------------------------ */

export const STOCK = {
  /** 시작 주가 */
  START: 100,
  /** 하한 — 도달 시 상장폐지 */
  MIN: 0,
  /** 상한가 — 더 이상 오르지 않음 */
  MAX: 300,
  /** 기본 타격 이동량 (약공격 기준 %) */
  BASE_TRANSFER: 10,
} as const;

/**
 * 떡상 등급 테이블.
 *
 * 명세의 "100%: 기본 (시작 상태)"와 "100~149%: 상승"이 겹치므로,
 * 시작값인 100%는 NORMAL(기본)로 두고 101%부터 RISING(상승)으로 판정한다.
 */
export const TIERS: Record<StockTier, TierEffect> = {
  [StockTier.DELISTED]: {
    tier: StockTier.DELISTED,
    label: '상장폐지',
    min: 0,
    atkMul: 1,
    speedMul: 1,
    cooldownMul: 1,
    color: 0x4b5563,
    aura: false,
    flame: 0,
  },
  [StockTier.CRISIS]: {
    tier: StockTier.CRISIS,
    label: '위기',
    min: 1,
    atkMul: 1,
    speedMul: 1,
    cooldownMul: 1,
    color: 0xef4444,
    aura: false,
    flame: 0,
  },
  [StockTier.NORMAL]: {
    tier: StockTier.NORMAL,
    label: '보통',
    min: 50,
    atkMul: 1,
    speedMul: 1,
    cooldownMul: 1,
    color: 0xcbd5e1,
    aura: false,
    flame: 0,
  },
  [StockTier.RISING]: {
    tier: StockTier.RISING,
    label: '상승',
    min: 101,
    atkMul: 1.1,
    speedMul: 1,
    cooldownMul: 1,
    color: 0x4ade80,
    aura: true,
    flame: 0,
  },
  [StockTier.SURGE_1]: {
    tier: StockTier.SURGE_1,
    label: '떡상 1단계',
    min: 150,
    atkMul: 1.25,
    speedMul: 1.1,
    cooldownMul: 1,
    color: 0xfacc15,
    aura: true,
    flame: 1,
  },
  [StockTier.SURGE_2]: {
    tier: StockTier.SURGE_2,
    label: '떡상 2단계',
    min: 200,
    atkMul: 1.45,
    speedMul: 1.15,
    cooldownMul: 0.8,
    color: 0xfb923c,
    aura: true,
    flame: 2,
  },
  [StockTier.SUPER]: {
    tier: StockTier.SUPER,
    label: '초! 떡상',
    min: 300,
    atkMul: 1.7,
    speedMul: 1.25,
    cooldownMul: 0.6,
    color: 0xffffff,
    aura: true,
    flame: 3,
  },
};

/** 높은 등급부터 정렬해 둔 목록 — 주가 → 등급 변환에 사용 */
export const TIER_LIST: TierEffect[] = Object.values(TIERS).sort(
  (a, b) => b.min - a.min,
);

/* ------------------------------------------------------------------ */
/* 캐릭터 물리 규격                                                    */
/* ------------------------------------------------------------------ */

export const FIGHTER = {
  /** 물리 바디 가로 */
  BODY_W: 46,
  /** 물리 바디 세로 */
  BODY_H: 84,
  /** 대두 반지름 */
  HEAD_R: 30,
  /** 몸통 반지름 */
  TORSO_R: 20,
  /** 공중 최대 점프 횟수 (2단 점프) */
  MAX_JUMPS: 2,
  /** 공중 조작 감쇠 */
  AIR_CONTROL: 0.82,
  /** 피격 후 무적 시간 (ms) — 스턴락 방지 */
  INVULN_MS: 180,
  /** 착지 시 스쿼시 연출 임계 낙하속도 */
  LAND_SQUASH_VY: 500,
  /** 대시 지속 (ms) */
  DASH_MS: 280,
  /** 대시 속도 배율 — 넓어진 맵을 빠르게 가로지를 수 있어야 한다 */
  DASH_SPEED_MUL: 3.4,
  /** 대시 재사용 대기 (ms) */
  DASH_COOLDOWN: 520,
  /** 방어 시 피해 배율 */
  GUARD_DAMAGE_MUL: 0.3,
  /** 방어 시 넉백 배율 */
  GUARD_KNOCKBACK_MUL: 0.35,
  /** 더블탭 대시로 인정할 최대 간격 (ms) */
  DOUBLE_TAP_MS: 260,
} as const;

/* ------------------------------------------------------------------ */
/* 커맨드 무브 템플릿                                                  */
/* ------------------------------------------------------------------ */

/**
 * 슬롯별 기본 성능.
 *
 * 캐릭터 데이터에는 "그 캐릭터에서 달라지는 값"만 적는다.
 * 슬롯의 역할(상승기는 띄우고, 하단기는 낮게 넓게)은 여기서 한 번만 정의하므로,
 * 캐릭터를 늘려도 각 커맨드의 손맛은 일관되게 유지된다.
 */
export const MOVE_TEMPLATES: Record<MoveSlot, AttackConfig> = {
  /* --- 지상 약공격 계열 ------------------------------------------ */

  /** J — 빠르고 가벼운 견제 */
  light: {
    type: 'light',
    slot: 'light',
    name: '약공격',
    damage: 10,
    startup: 70,
    active: 90,
    recovery: 150,
    range: 66,
    hitHeight: 76,
    hitAnchor: 'front',
    fx: 'thrust',
    knockbackX: 280,
    knockbackY: -180,
    hitstun: 220,
    hitstop: 70,
    shake: 0.008,
  },

  /** W+J — 대공. 위로 쳐올려 콤보를 시작한다 */
  lightUp: {
    type: 'light',
    slot: 'lightUp',
    name: '상단 견제',
    damage: 9,
    startup: 92,
    active: 100,
    recovery: 190,
    range: 72,
    hitHeight: 104,
    hitAnchor: 'up',
    fx: 'rising',
    // 수평 넉백을 죽이고 위로만 띄운다 — 띄운 뒤 쫓아가는 맛
    knockbackX: 130,
    knockbackY: -540,
    hitstun: 300,
    hitstop: 80,
    shake: 0.01,
  },

  /** S+J — 저공. 리치가 길지만 띄우지 못한다 */
  lightDown: {
    type: 'light',
    slot: 'lightDown',
    name: '하단 견제',
    damage: 8,
    startup: 84,
    active: 90,
    recovery: 200,
    range: 92,
    hitHeight: 46,
    hitAnchor: 'down',
    fx: 'slash',
    knockbackX: 330,
    knockbackY: -110,
    hitstun: 250,
    hitstop: 70,
    shake: 0.008,
  },

  /* --- 지상 강공격 계열 ------------------------------------------ */

  /** K — 느리지만 강한 넉백 */
  heavy: {
    type: 'heavy',
    slot: 'heavy',
    name: '강공격',
    damage: 18,
    startup: 180,
    active: 110,
    recovery: 320,
    range: 84,
    hitHeight: 88,
    hitAnchor: 'front',
    fx: 'slash',
    knockbackX: 560,
    knockbackY: -380,
    hitstun: 400,
    hitstop: 120,
    shake: 0.016,
  },

  /**
   * W+K — 상승기.
   * 자신도 함께 솟구치므로, 대공이자 공중 콤보 진입기가 된다.
   */
  heavyUp: {
    type: 'heavy',
    slot: 'heavyUp',
    name: '상승 강타',
    damage: 17,
    startup: 150,
    active: 150,
    recovery: 380,
    range: 78,
    hitHeight: 132,
    hitAnchor: 'up',
    fx: 'rising',
    knockbackX: 180,
    knockbackY: -780,
    hitstun: 460,
    hitstop: 130,
    shake: 0.018,
    selfLaunch: -540,
  },

  /** S+K — 지면 내려찍기. 좌우 양쪽을 함께 친다 */
  heavyDown: {
    type: 'heavy',
    slot: 'heavyDown',
    name: '내려찍기',
    damage: 20,
    startup: 215,
    active: 130,
    recovery: 400,
    range: 152,
    hitHeight: 60,
    hitAnchor: 'around',
    fx: 'slam',
    knockbackX: 420,
    knockbackY: -540,
    hitstun: 440,
    hitstop: 145,
    shake: 0.022,
  },

  /* --- 공중 --------------------------------------------------------- */

  /** 공중 J — 빠른 견제. 착지 전에 한 번 더 끼워 넣는 용도 */
  airLight: {
    type: 'light',
    slot: 'airLight',
    name: '공중 견제',
    damage: 9,
    startup: 58,
    active: 110,
    recovery: 130,
    range: 74,
    hitHeight: 86,
    hitAnchor: 'front',
    fx: 'slash',
    knockbackX: 300,
    knockbackY: -240,
    hitstun: 240,
    hitstop: 70,
    shake: 0.008,
  },

  /** 공중 K — 몸을 돌려 주변을 훑는다 */
  airHeavy: {
    type: 'heavy',
    slot: 'airHeavy',
    name: '공중 회전',
    damage: 16,
    startup: 135,
    active: 160,
    recovery: 250,
    range: 118,
    hitHeight: 100,
    hitAnchor: 'around',
    fx: 'spin',
    knockbackX: 520,
    knockbackY: -300,
    hitstun: 380,
    hitstop: 120,
    shake: 0.016,
  },

  /**
   * 공중 S+J/K — 급강하 찍기.
   *
   * 넉백 Y가 양수라 상대를 아래로 처박는다(스파이크).
   * 장외가 곧 상장폐지인 이 게임에서 가장 위험한 마무리기다.
   */
  airDive: {
    type: 'heavy',
    slot: 'airDive',
    name: '급강하 찍기',
    damage: 19,
    startup: 110,
    active: 460,
    recovery: 300,
    range: 86,
    hitHeight: 104,
    hitAnchor: 'around',
    fx: 'slam',
    knockbackX: 240,
    knockbackY: 420,
    hitstun: 420,
    hitstop: 150,
    shake: 0.02,
    divePlunge: {
      speed: 1280,
      shockRange: 210,
      shockDamage: 10,
    },
  },

  /* --- 시그니처 스킬 ------------------------------------------------ */

  /** L — 캐릭터마다 완전히 다르므로 템플릿은 뼈대만 준다 */
  skill: {
    type: 'skill',
    slot: 'skill',
    name: '시그니처',
    damage: 24,
    startup: 250,
    active: 150,
    recovery: 400,
    range: 110,
    hitHeight: 96,
    hitAnchor: 'front',
    fx: 'slash',
    knockbackX: 600,
    knockbackY: -440,
    hitstun: 480,
    hitstop: 140,
    shake: 0.018,
    cooldown: 10000,
    effect: 'none',
  },
};

/** 커맨드 안내에 쓰는 슬롯 순서 + 입력 표기 */
export const MOVE_COMMANDS: Array<{ slot: MoveSlot; keys: string }> = [
  { slot: 'light', keys: 'J' },
  { slot: 'lightUp', keys: 'W+J' },
  { slot: 'lightDown', keys: 'S+J' },
  { slot: 'heavy', keys: 'K' },
  { slot: 'heavyUp', keys: 'W+K' },
  { slot: 'heavyDown', keys: 'S+K' },
  { slot: 'airLight', keys: '공중 J' },
  { slot: 'airHeavy', keys: '공중 K' },
  { slot: 'airDive', keys: '공중 S+K' },
  { slot: 'skill', keys: 'L' },
];

const MOVE_SLOTS = MOVE_COMMANDS.map((c) => c.slot);

/** 슬롯 템플릿에 캐릭터별 차이만 얹어 기술 하나를 만든다 */
export function move(
  slot: MoveSlot,
  over: Partial<AttackConfig> & { name: string },
): AttackConfig {
  const base = MOVE_TEMPLATES[slot];
  // slot/type은 템플릿이 결정한다 — 캐릭터 데이터가 잘못 덮어쓰지 못하게
  return { ...base, ...over, slot, type: base.type };
}

/**
 * 캐릭터의 기술 세트를 만든다.
 *
 * 적지 않은 슬롯은 템플릿 그대로 채워지므로, 캐릭터를 추가할 때
 * "이 인물답게 달라지는 기술"만 쓰면 나머지 칸이 비지 않는다.
 */
export function moveSet(
  over: Partial<Record<MoveSlot, Partial<AttackConfig> & { name: string }>>,
): Record<MoveSlot, AttackConfig> {
  const out = {} as Record<MoveSlot, AttackConfig>;
  for (const slot of MOVE_SLOTS) {
    out[slot] = move(slot, over[slot] ?? { name: MOVE_TEMPLATES[slot].name });
  }
  return out;
}

/**
 * 입력(약/강 + 방향 + 지상/공중)을 슬롯으로 바꾼다.
 *
 * 공중에서 아래를 누르면 약·강 어느 쪽이든 급강하로 모은다.
 * 마무리기를 외우기 쉬워야 실제로 쓰이기 때문이다.
 */
export function resolveMoveSlot(
  intent: 'light' | 'heavy',
  dir: AttackDir,
  onGround: boolean,
): MoveSlot {
  if (!onGround) {
    if (dir === 'down') return 'airDive';
    return intent === 'light' ? 'airLight' : 'airHeavy';
  }
  if (dir === 'up') return intent === 'light' ? 'lightUp' : 'heavyUp';
  if (dir === 'down') return intent === 'light' ? 'lightDown' : 'heavyDown';
  return intent;
}

/* ------------------------------------------------------------------ */
/* 타격감 연출 파라미터                                                */
/* ------------------------------------------------------------------ */

export const IMPACT = {
  /** 카메라 쉐이크 지속 (ms) */
  SHAKE_MS: 150,
  /** 히트 플래시 지속 (ms) */
  FLASH_MS: 70,
  /** 스쿼시 & 스트레치 지속 (ms) */
  SQUASH_MS: 90,
  /** 피격 시 찌그러짐 정도 */
  SQUASH_X: 1.35,
  SQUASH_Y: 0.68,
  /** 임팩트 파티클 개수 */
  PARTICLE_COUNT: 14,
  /** 데미지 숫자 팝업 지속 (ms) */
  FLOATING_MS: 700,
} as const;

/* ------------------------------------------------------------------ */
/* AI 난이도                                                           */
/* ------------------------------------------------------------------ */

/**
 * 명세 기준 난이도: 중간.
 *
 * 초기값(반응 220ms / 공격 후 대기 420ms)은 사람이 상대하기에 너무 빨라
 * 플레이테스트에서 플레이어가 계속 먼저 상장폐지됐다.
 * 사람이 거리를 재고 반응할 여유를 주는 값으로 낮췄다.
 */
export const AI_MEDIUM: AIDifficulty = {
  label: '중간',
  decisionInterval: 220,
  reactionDelay: 320,
  evadeChance: 0.28,
  heavyRatio: 0.3,
  attackCooldown: 620,
};

/* ------------------------------------------------------------------ */
/* Phaser 코어 설정                                                    */
/* ------------------------------------------------------------------ */

/**
 * Scene 목록은 여기에 넣지 않는다.
 * (Scene들이 이 파일의 상수를 import하므로 순환 참조가 생긴다.
 *  실제 scene 배열은 main.ts에서 조립한다.)
 */
export const PHASER_CONFIG: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game-root',
  width: GAME.WIDTH,
  height: GAME.HEIGHT,
  backgroundColor: GAME.BG_COLOR,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: GAME.GRAVITY },
      debug: false,
    },
  },
  render: {
    antialias: true,
    roundPixels: false,
  },
  // 브라우저가 스페이스바/방향키로 스크롤하지 않도록
  input: {
    keyboard: true,
    gamepad: false,
  },
};
