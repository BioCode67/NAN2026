import type { CharacterId, MoveSlot } from '../types';

/**
 * 캐릭터가 취할 수 있는 포즈.
 * BaseCharacter가 매 프레임 자신의 상태에서 이 값을 계산해 뷰에 넘긴다.
 */
export type Pose =
  | 'idle'
  | 'walk'
  | 'run'
  | 'dash'
  | 'jump'
  | 'fall'
  | 'land'
  | 'airJ'
  | 'airK'
  | 'dive'
  | 'attackJ'
  | 'attackJ2'
  | 'attackJ3'
  | 'attackK'
  | 'attackK2'
  | 'attackJUp'
  | 'attackJDown'
  | 'attackKUp'
  | 'attackKDown'
  | 'skill'
  | 'guard'
  | 'hit'
  | 'hitAir'
  | 'knockback'
  | 'win'
  | 'lose';

/** 커맨드 무브 → 재생할 포즈 */
export const MOVE_POSE: Record<MoveSlot, Pose> = {
  light: 'attackJ',
  light2: 'attackJ2',
  light3: 'attackJ3',
  heavy: 'attackK',
  heavy2: 'attackK2',
  lightUp: 'attackJUp',
  lightDown: 'attackJDown',
  heavyUp: 'attackKUp',
  heavyDown: 'attackKDown',
  airLight: 'airJ',
  airHeavy: 'airK',
  airDive: 'dive',
  skill: 'skill',
};

/**
 * 포즈 대체 사슬.
 *
 * 커맨드 무브가 늘어난 만큼 필요한 그림도 늘었지만,
 * 기존 15프레임 시트에는 상단기·하단기 그림이 없다.
 * 없는 포즈는 여기를 따라 내려가 가장 가까운 그림으로 대체되므로,
 * 새 시트를 뽑기 전에도 모든 기술이 정상 동작한다.
 */
export const POSE_FALLBACK: Partial<Record<Pose, Pose>> = {
  // 연속기 2·3타 → 기본 약공격
  attackJ2: 'attackJ',
  attackJ3: 'attackJ',
  attackJUp: 'attackJ',
  attackJDown: 'attackJ',
  airJ: 'attackJ',
  // 강공격 계열 → 기본 강공격
  attackK2: 'attackK',
  attackKUp: 'attackK',
  attackKDown: 'attackK',
  airK: 'attackK',
  dive: 'attackK',
  // 이동/피격
  fall: 'jump',
  land: 'idle',
  hitAir: 'knockback',
};

/**
 * 시트에 없는 포즈를 대체 사슬을 따라 실제 프레임으로 바꾼다.
 *
 * 프레임뿐 아니라 "어느 포즈로 대체됐는지"까지 돌려준다.
 * 애니메이션 키가 포즈 이름으로 등록되어 있어, 대체된 포즈 이름을 알아야
 * 여러 프레임짜리 대체 포즈도 애니메이션으로 재생할 수 있다.
 */
export function resolvePose(
  poses: Partial<Record<Pose, PoseFrames>>,
  pose: Pose,
): { pose: Pose; frames: PoseFrames } | null {
  let cur: Pose | undefined = pose;
  // 사슬이 잘못 순환하더라도 멈추도록 횟수를 제한한다
  for (let i = 0; cur && i < 6; i++) {
    const frames = poses[cur];
    if (frames !== undefined) return { pose: cur, frames };
    cur = POSE_FALLBACK[cur];
  }
  return poses.idle !== undefined ? { pose: 'idle', frames: poses.idle } : null;
}

/**
 * 포즈 → 프레임 지정.
 *  - 숫자: 정지 프레임
 *  - 배열: 연속 재생 애니메이션
 */
export type PoseFrames = number | number[];

export interface SpriteSheetDef {
  /** public/sprites/<key>.png 와 <key>.json 을 읽는다 */
  key: string;
  /** 게임 내 표시 높이(px). 원본 프레임 크기가 캐릭터마다 달라도 이 값으로 통일된다 */
  displayHeight: number;
  /** 포즈별 프레임. 없는 포즈는 idle로 대체된다 */
  poses: Partial<Record<Pose, PoseFrames>>;
  /** 애니메이션 재생 속도 (fps) */
  frameRate?: number;
  /** 발끝 미세 보정 (양수 = 아래로) */
  footOffset?: number;
  /**
   * 원본 그림이 왼쪽을 보고 있으면 true.
   * (스티브 잡스 시트는 오른쪽을 보고 있어 false)
   */
  facesLeft?: boolean;
  /**
   * 캐릭터 없이 이펙트만 그려진 프레임.
   * 로켓 드롭 착지 폭발처럼 캐릭터와 분리해 쓰는 연출에 사용한다.
   */
  explosionFrame?: number;
}

/* ------------------------------------------------------------------ */
/* 표준 시트 레이아웃                                                  */
/* ------------------------------------------------------------------ */

/**
 * V1 — 3행 x 5열, 15프레임. (초기에 생성한 시트들)
 *
 * 커맨드 무브가 생기기 전 규격이라 상단기·하단기·공중기 그림이 없다.
 * 부족한 포즈는 POSE_FALLBACK을 따라 기본 공격 그림으로 대체된다.
 *
 * 8번은 캐릭터가 아니라 이펙트 단독 프레임이므로 포즈에 넣지 않고
 * explosionFrame / skill.projectile.frame 으로 쓴다.
 */
export const LAYOUT_V1: Partial<Record<Pose, PoseFrames>> = {
  idle: 0,
  walk: 1,
  run: [2, 3],
  jump: 4,
  attackJ: 5,
  attackK: 6,
  skill: 7,
  hit: 9,
  knockback: 10,
  guard: 11,
  dash: 12,
  win: 13,
  lose: 14,
};

/**
 * V2 — 5행 x 6열, 30프레임. **새 시트는 전부 이 규격으로 뽑는다.**
 *
 * 커맨드 무브와 연속기가 각자의 그림을 갖도록 확장한 규격이며,
 * tools/gen-sheet.mjs 가 이 순서 그대로 프롬프트를 만든다.
 * 캐릭터만 바꿔 같은 양식으로 찍어내면 아래 한 줄로 등록이 끝난다.
 *
 * 행 단위로 성격을 묶었다. 생성기가 인접 프레임을 비슷하게 그리는 성향이 있어,
 * 같은 계열을 한 줄에 모아두면 결과가 눈에 띄게 안정된다.
 *
 *   1행 이동: IDLE, WALK, RUN_A, RUN_B, RUN_C, DASH
 *   2행 공중: JUMP, FALL, LAND, AIR_J, AIR_K, AIR_DIVE
 *   3행 연속기: ATTACK_J, ATTACK_J2, ATTACK_J3, ATTACK_K, ATTACK_K2, GUARD
 *   4행 방향기·스킬: ATTACK_J_UP, ATTACK_J_DOWN, ATTACK_K_UP, ATTACK_K_DOWN, SKILL_L, SKILL_L2
 *   5행 피격·결과: SKILL_FX(이펙트 단독), HIT, HIT_AIR, KNOCKBACK, WIN, LOSE
 */
export const LAYOUT_V2: Partial<Record<Pose, PoseFrames>> = {
  /* 1행 — 이동 */
  idle: 0,
  walk: 1,
  run: [2, 3, 4],
  dash: 5,

  /* 2행 — 공중 */
  jump: 6,
  fall: 7,
  land: 8,
  airJ: 9,
  airK: 10,
  dive: 11,

  /* 3행 — 지상 연속기 */
  attackJ: 12,
  attackJ2: 13,
  attackJ3: 14,
  attackK: 15,
  attackK2: 16,
  guard: 17,

  /* 4행 — 방향 커맨드 + 스킬 */
  attackJUp: 18,
  attackJDown: 19,
  attackKUp: 20,
  attackKDown: 21,
  // SKILL_L → SKILL_L2 로 이어 재생
  skill: [22, 23],

  /* 5행 — 피격·결과 (24 = SKILL_FX, 캐릭터가 없어 포즈로 쓰지 않는다) */
  hit: 25,
  hitAir: 26,
  knockback: 27,
  win: 28,
  lose: 29,
};

/** V2에서 캐릭터 없이 이펙트만 그려진 프레임 (충격파·투사체용) */
export const LAYOUT_V2_FX_FRAME = 24;

/**
 * 스프라이트 시트가 준비된 캐릭터만 등록한다.
 *
 * 새 캐릭터 추가 방법:
 *   1. tools/gen-sheet.mjs 의 CHARACTERS 에 항목을 하나 추가한다
 *   2. npm run gen -- <id>          (생성 → 배경 제거 → 격자 재배치까지 자동)
 *   3. 아래에 `poses: LAYOUT_V2` 로 한 줄 등록한다
 *
 * 등록하지 않은 캐릭터는 코드로 그린 도형 아트(CharacterArt)로 자동 대체된다.
 */
export const SPRITE_SHEETS: Partial<Record<CharacterId, SpriteSheetDef>> = {
  gates: {
    key: 'billgates',
    displayHeight: 116,
    frameRate: 9,
    // 8 = 캐릭터 없이 에너지볼만 있는 프레임 → skill.projectile.frame 으로 쓴다
    poses: LAYOUT_V1,
  },

  pepe: {
    key: 'pennywise',
    displayHeight: 116,
    frameRate: 10,
    // 8 = 캐릭터 없이 도끼 에너지만 있는 프레임
    explosionFrame: 8,
    poses: LAYOUT_V1,
  },

  musk: {
    key: 'elonmusk',
    displayHeight: 116,
    frameRate: 10,
    // 8 = 캐릭터 없이 폭발만 있는 프레임 → 로켓 드롭 착지 충격파로 쓴다
    explosionFrame: 8,
    poses: LAYOUT_V1,
  },

  jobs: {
    key: 'stevejobs',
    displayHeight: 116,
    frameRate: 9,
    // 원본에 SKILL_L2 가 캐릭터 포함이라 2프레임 애니메이션으로 이어 재생한다
    poses: { ...LAYOUT_V1, skill: [7, 8] },
  },
};

/** 로드해야 할 시트 목록 */
export const SHEET_DEFS: SpriteSheetDef[] = Object.values(SPRITE_SHEETS);

/** Phaser 애니메이션 키 규칙 */
export function animKey(sheetKey: string, pose: Pose): string {
  return `${sheetKey}-${pose}`;
}

/** 시트 메타데이터(JSON) 캐시 키 */
export function metaKey(sheetKey: string): string {
  return `${sheetKey}-meta`;
}

/** process-sheet.mjs 가 내보내는 메타데이터 형식 */
export interface SheetMeta {
  frameWidth: number;
  frameHeight: number;
  columns: number;
  rows: number;
  count: number;
}
