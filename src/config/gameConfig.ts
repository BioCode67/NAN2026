import Phaser from 'phaser';
import { StockTier } from '../types';
import type { AttackConfig, AIDifficulty, TierEffect } from '../types';

/* ------------------------------------------------------------------ */
/* 기본 상수                                                           */
/* ------------------------------------------------------------------ */

export const GAME = {
  /** 논리 해상도 (실제 표시는 Scale.FIT으로 자동 조정) */
  WIDTH: 1280,
  HEIGHT: 720,

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
  LEFT: 110,
  /** 지면 우측 끝 */
  RIGHT: 1170,
  /** 이 Y좌표 아래로 떨어지면 장외 → 즉시 상장폐지 */
  BLAST_BOTTOM: 900,
  /** 좌우 장외 여유 */
  BLAST_MARGIN: 260,

  /**
   * 공중 발판. 아래에서 점프해 통과할 수 있고 위에서만 착지한다.
   */
  PLATFORMS: [
    { x: 300, y: 430, w: 230 },
    { x: 980, y: 430, w: 230 },
    { x: 640, y: 300, w: 210 },
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
  DASH_MS: 220,
  /** 대시 재사용 대기 (ms) */
  DASH_COOLDOWN: 600,
  /** 방어 시 피해 배율 */
  GUARD_DAMAGE_MUL: 0.3,
  /** 방어 시 넉백 배율 */
  GUARD_KNOCKBACK_MUL: 0.35,
  /** 더블탭 대시로 인정할 최대 간격 (ms) */
  DOUBLE_TAP_MS: 260,
} as const;

/* ------------------------------------------------------------------ */
/* 기본 공격 데이터                                                    */
/* ------------------------------------------------------------------ */

/** 약공격 (J) — 빠르고 가볍다 */
export const LIGHT_ATTACK: AttackConfig = {
  type: 'light',
  name: '약공격',
  damage: 10,
  startup: 70,
  active: 90,
  recovery: 150,
  range: 66,
  hitHeight: 76,
  knockbackX: 280,
  knockbackY: -180,
  hitstun: 220,
  hitstop: 70,
  shake: 0.008,
};

/** 강공격 (K) — 느리지만 강한 넉백 */
export const HEAVY_ATTACK: AttackConfig = {
  type: 'heavy',
  name: '강공격',
  damage: 18,
  startup: 180,
  active: 110,
  recovery: 320,
  range: 84,
  hitHeight: 88,
  knockbackX: 560,
  knockbackY: -380,
  hitstun: 400,
  hitstop: 120,
  shake: 0.016,
};

/**
 * 기본 공격 템플릿에서 캐릭터별 공격을 만든다.
 * 달라지는 값만 적으면 되므로 캐릭터 데이터가 짧아진다.
 */
export function melee(
  type: 'light' | 'heavy',
  over: Partial<AttackConfig> & { name: string },
): AttackConfig {
  const base = type === 'light' ? LIGHT_ATTACK : HEAVY_ATTACK;
  return { ...base, ...over, type };
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
