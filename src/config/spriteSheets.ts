import type { CharacterId, MoveSlot } from '../types';

/**
 * 캐릭터가 취할 수 있는 포즈.
 * BaseCharacter가 매 프레임 자신의 상태에서 이 값을 계산해 뷰에 넘긴다.
 */
export type Pose =
  /* 이동 */
  | 'idle'
  | 'walk'
  | 'run'
  | 'dash'
  /* 공중 */
  | 'jump'
  | 'fall'
  | 'land'
  | 'airJ'
  | 'airK'
  | 'dive'
  /* 지상 연속기 */
  | 'attackJ'
  | 'attackJ2'
  | 'attackJ3'
  | 'attackK'
  | 'attackK2'
  | 'dashAttack'
  /* 방향 커맨드 */
  | 'attackJUp'
  | 'attackJDown'
  | 'attackKUp'
  | 'attackKDown'
  /* 스킬 · 프롬프트 */
  | 'skillCharge'
  | 'skill'
  | 'promptCast'
  /* 아이템 */
  | 'itemGet'
  | 'itemHold'
  | 'itemThrow'
  | 'itemSwing'
  /* 상태 · 결과 */
  | 'guard'
  | 'dizzy'
  | 'taunt'
  | 'down'
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
  dashAttack: 'dashAttack',
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
  dashAttack: 'attackK',
  // 스킬 · 프롬프트
  skillCharge: 'skill',
  promptCast: 'win',
  // 아이템 — 없으면 그냥 서 있는 그림으로 떨어진다
  itemGet: 'idle',
  itemHold: 'idle',
  itemThrow: 'attackJ',
  itemSwing: 'attackK',
  // 상태 · 이동
  fall: 'jump',
  land: 'idle',
  taunt: 'win',
  dizzy: 'hit',
  down: 'lose',
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
  /** 프롬프트 오브를 깬 순간에 띄우는 이펙트 프레임 */
  promptFrame?: number;
  /** 얼굴만 그린 초상 프레임 — HUD·선택 화면에 쓴다 */
  portraitFrame?: number;
  /**
   * 초기 15프레임(V1) 시트에만 적용할 개별 보정.
   *
   * 규격이 정해지기 전에 뽑은 시트들이라 캐릭터마다 어긋난 데가 있다.
   * 그 보정을 poses에 직접 써 두면 새 시트로 갈아 끼울 때 함께 따라와
   * 엉뚱한 칸을 가리키므로, V1일 때만 얹히도록 따로 둔다.
   */
  v1?: {
    poses?: Partial<Record<Pose, PoseFrames>>;
    explosionFrame?: number;
  };
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
 * V3 — 7행 x 6열, 42프레임. **지금 뽑는 시트는 전부 이 규격이다.**
 *
 * 커맨드·연속기에 더해 아이템을 쥔 손, 프롬프트 시전, 도발, 기절까지 담는다.
 * tools/gen-prompts.mjs 가 이 순서 그대로 6장씩 7묶음의 프롬프트를 만들고,
 * tools/merge-sheets.mjs 가 받은 묶음들을 이 격자로 합친다.
 *
 * 한 장에 42칸을 그리게 하면 뒤로 갈수록 그림이 무너지므로,
 * **묶음이 곧 행**이 되도록 배치했다. 묶음 하나를 다시 뽑으면 그 행만 갈린다.
 *
 *   1행 이동: IDLE, WALK, RUN_A, RUN_B, RUN_C, DASH
 *   2행 공중: JUMP, FALL, LAND, AIR_J, AIR_K, AIR_DIVE
 *   3행 연속기: ATTACK_J, ATTACK_J2, ATTACK_J3, ATTACK_K, ATTACK_K2, DASH_ATTACK
 *   4행 방향기: ATTACK_J_UP, ATTACK_J_DOWN, ATTACK_K_UP, ATTACK_K_DOWN, GUARD, DIZZY
 *   5행 스킬: SKILL_CHARGE, SKILL_L, SKILL_L2, SKILL_FX, PROMPT_CAST, PROMPT_FX
 *   6행 아이템: ITEM_GET, ITEM_HOLD, ITEM_THROW, ITEM_SWING, TAUNT, DOWN
 *   7행 결과: HIT, HIT_AIR, KNOCKBACK, WIN, LOSE, PORTRAIT
 */
export const LAYOUT_V3: Partial<Record<Pose, PoseFrames>> = {
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
  dashAttack: 17,

  /* 4행 — 방향 커맨드 · 방어 */
  attackJUp: 18,
  attackJDown: 19,
  attackKUp: 20,
  attackKDown: 21,
  guard: 22,
  dizzy: 23,

  /* 5행 — 스킬 (24 기 모으기 → 25 시전 → 26 방출, 27은 이펙트 단독) */
  skillCharge: 24,
  skill: [25, 26],
  promptCast: 28,

  /* 6행 — 아이템 · 도발 */
  itemGet: 30,
  itemHold: 31,
  itemThrow: 32,
  itemSwing: 33,
  taunt: 34,
  down: 35,

  /* 7행 — 피격 · 결과 (41은 초상화라 포즈로 쓰지 않는다) */
  hit: 36,
  hitAir: 37,
  knockback: 38,
  win: 39,
  lose: 40,
};

/**
 * V3에서 캐릭터가 그려지지 않은 특수 프레임들.
 * 포즈가 아니라 이펙트·UI로 쓰므로 LAYOUT_V3 에 넣지 않는다.
 */
export const LAYOUT_V3_FX = {
  /** 스킬 이펙트 단독 — 투사체·충격파 */
  skill: 27,
  /** 프롬프트 이펙트 단독 — 오브를 깬 순간의 명령창 */
  prompt: 29,
  /** 얼굴 초상 — HUD·선택 화면 */
  portrait: 41,
} as const;

/* ------------------------------------------------------------------ */
/* 규격 자동 판별                                                       */
/* ------------------------------------------------------------------ */

/** 프레임 수로 고르는 규격표 — 위에서부터 처음 맞는 것을 쓴다 */
const LAYOUTS = [
  {
    name: 'V3',
    minFrames: 42,
    poses: LAYOUT_V3,
    explosionFrame: LAYOUT_V3_FX.skill,
    promptFrame: LAYOUT_V3_FX.prompt,
    portraitFrame: LAYOUT_V3_FX.portrait,
  },
  { name: 'V2', minFrames: 30, poses: LAYOUT_V2, explosionFrame: LAYOUT_V2_FX_FRAME },
  { name: 'V1', minFrames: 0, poses: LAYOUT_V1 },
] as const;

/**
 * 시트의 프레임 수를 보고 규격을 정해 def에 채운다.
 *
 * 규격을 캐릭터마다 손으로 적어 두면, 새로 뽑은 42프레임 시트를 폴더에
 * 넣는 순간 게임은 여전히 15프레임 배치로 읽어 전혀 다른 칸이 나온다.
 * 그림만 갈아 끼웠는데 캐릭터가 망가지고, 원인은 코드에 있다 —
 * 그래서 그림 쪽에서 규격을 읽어내도록 뒤집었다.
 *
 * @returns 적용한 규격 이름 (로그용)
 */
export function applyLayout(def: SpriteSheetDef, frameCount: number): string {
  const spec = LAYOUTS.find((l) => frameCount >= l.minFrames) ?? LAYOUTS[LAYOUTS.length - 1]!;

  def.poses = spec.poses;
  def.explosionFrame = 'explosionFrame' in spec ? spec.explosionFrame : undefined;
  def.promptFrame = 'promptFrame' in spec ? spec.promptFrame : undefined;
  def.portraitFrame = 'portraitFrame' in spec ? spec.portraitFrame : undefined;

  /* 옛 시트의 개별 보정은 V1일 때만 얹는다 */
  if (spec.name === 'V1' && def.v1) {
    if (def.v1.poses) def.poses = { ...def.poses, ...def.v1.poses };
    if (def.v1.explosionFrame !== undefined) def.explosionFrame = def.v1.explosionFrame;
  }

  return spec.name;
}

/**
 * 스프라이트 시트가 준비된 캐릭터만 등록한다.
 *
 * 새 시트를 넣는 방법:
 *   1. `npm run prompts` 로 뽑은 프롬프트로 6칸짜리 묶음 7장을 생성한다
 *   2. art-source/<key>_b1.png … _b7.png 로 저장한다
 *   3. `npm run sheet:merge -- <key>`
 *
 * 규격(V1/V2/V3)은 **프레임 수를 보고 자동으로 정해진다.** 여기 적을 것은
 * 그림 자체로는 알 수 없는 것 — 표시 높이, 재생 속도, 바라보는 방향뿐이다.
 * 등록하지 않은 캐릭터는 코드로 그린 도형 아트(CharacterArt)로 자동 대체된다.
 */
export const SPRITE_SHEETS: Partial<Record<CharacterId, SpriteSheetDef>> = {
  gates: {
    key: 'billgates',
    displayHeight: 116,
    frameRate: 9,
    poses: LAYOUT_V1,
  },

  pepe: {
    key: 'pennywise',
    displayHeight: 116,
    frameRate: 10,
    poses: LAYOUT_V1,
    // 옛 시트의 8번은 캐릭터 없이 도끼 에너지만 있는 프레임이다
    v1: { explosionFrame: 8 },
  },

  musk: {
    key: 'elonmusk',
    displayHeight: 116,
    frameRate: 10,
    poses: LAYOUT_V1,
    // 옛 시트의 8번은 폭발 단독 → 로켓 드롭 착지 충격파로 쓴다
    v1: { explosionFrame: 8 },
  },

  jobs: {
    key: 'stevejobs',
    displayHeight: 116,
    frameRate: 9,
    poses: LAYOUT_V1,
    // 옛 시트는 SKILL_L2 에도 캐릭터가 있어 2프레임으로 이어 재생한다
    v1: { poses: { skill: [7, 8] } },
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
