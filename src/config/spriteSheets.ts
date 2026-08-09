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
  | 'airUp'
  | 'airBack'
  /* 지상 연속기 */
  | 'attackJ'
  | 'attackJ2'
  | 'attackJ3'
  | 'attackK'
  | 'attackK2'
  | 'dashAttack'
  | 'dashSlide'
  /* 방향 커맨드 */
  | 'attackJUp'
  | 'attackJDown'
  | 'attackKUp'
  | 'attackKDown'
  | 'attackJFwd'
  | 'attackJBack'
  | 'attackKFwd'
  | 'attackKBack'
  /** 개성 필살 — 완전 충전 강공격에서 재생되는 그 캐릭터만의 3장 연출 */
  | 'flair'
  /* 스킬 · 프롬프트 */
  | 'skillCharge'
  | 'skill'
  | 'promptCast'
  /* 아이템 */
  | 'itemGet'
  | 'itemHold'
  | 'itemThrow'
  | 'itemSwing'
  /* 잡기 */
  | 'grab'
  | 'grabHold'
  | 'grabbed'
  | 'throw'
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

/**
 * 포즈를 번호로 주고받기 위한 고정 순서.
 *
 * 온라인 대전에서 게스트는 상태를 계산하지 않으므로 포즈도 못 정한다.
 * 호스트가 정한 것을 번호 하나로 보내면 되는데, 그러려면 양쪽이 같은
 * 순서표를 봐야 한다. **뒤에만 덧붙이고 중간을 건드리지 말 것** —
 * 순서가 밀리면 상대 화면에서 걷는 사람이 갑자기 쓰러진다.
 */
export const POSE_ORDER: Pose[] = [
  'idle', 'walk', 'run', 'dash',
  'jump', 'fall', 'land', 'airJ', 'airK', 'dive',
  'attackJ', 'attackJ2', 'attackJ3', 'attackK', 'attackK2', 'dashAttack',
  'attackJUp', 'attackJDown', 'attackKUp', 'attackKDown',
  'skillCharge', 'skill', 'promptCast',
  'itemGet', 'itemHold', 'itemThrow', 'itemSwing',
  'grab', 'grabHold', 'grabbed', 'throw',
  'guard', 'dizzy', 'taunt', 'down',
  'hit', 'hitAir', 'knockback', 'win', 'lose',
  // ↓ 앞뒤 커맨드·공중 확장에서 늘어난 포즈. 반드시 뒤에만 붙일 것
  'attackJFwd', 'attackJBack', 'attackKFwd', 'attackKBack',
  'dashSlide', 'airUp', 'airBack',
  'flair',
];

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
  lightFwd: 'attackJFwd',
  lightBack: 'attackJBack',
  heavyUp: 'attackKUp',
  heavyDown: 'attackKDown',
  heavyFwd: 'attackKFwd',
  heavyBack: 'attackKBack',
  dashSlide: 'dashSlide',
  airLight: 'airJ',
  airHeavy: 'airK',
  airUp: 'airUp',
  airBack: 'airBack',
  airDive: 'dive',
  skill: 'skill',
};

/**
 * 포즈 → 기술 슬롯 (MOVE_POSE 의 역).
 *
 * 온라인 참가자는 포즈 번호만 받는다. 공격 포즈로 넘어가는 순간 그것이
 * 어느 기술인지 알아야 같은 연출(예비동작·이펙트·소리)을 틀 수 있다.
 * 손으로 또 적지 않고 역으로 만든다 — 표가 둘이면 한쪽만 고쳐진다.
 * flair 는 슬롯이 아니라 완전 충전 강공격의 연출이므로 heavy 로 친다.
 */
export const POSE_SLOT: Partial<Record<Pose, MoveSlot>> = Object.fromEntries([
  ...Object.entries(MOVE_POSE).map(([slot, pose]) => [pose, slot]),
  ['flair', 'heavy'],
]) as Partial<Record<Pose, MoveSlot>>;

/**
 * 포즈 대체 사슬.
 *
 * 커맨드 무브가 늘어난 만큼 필요한 그림도 늘었지만,
 * 기존 15프레임 시트에는 상단기·하단기 그림이 없다.
 * 없는 포즈는 여기를 따라 내려가 가장 가까운 그림으로 대체되므로,
 * 새 시트를 뽑기 전에도 모든 기술이 정상 동작한다.
 */
export const POSE_FALLBACK: Partial<Record<Pose, Pose>> = {
  /*
   * 공격 그림이 아예 없는 시트도 있다 (이동 묶음만 뽑은 경우).
   *
   * 그때 대기 자세로 떨어지면 **공격해도 그림이 안 바뀐다** — 화면만 보고는
   * 눌렀는지 알 수가 없다. 앞으로 기울어진 대시 자세로 떨어뜨리면 적어도
   * "앞으로 나갔다"는 것이 읽히고, 몸통 모션이 얹혀 한 방으로 보인다.
   * (공격 그림이 있는 시트에는 아무 영향이 없다 — 그쪽이 먼저 잡힌다)
   */
  attackJ: 'dash',
  attackK: 'dash',
  skill: 'dash',
  // 연속기 2·3타 → 기본 약공격
  attackJ2: 'attackJ',
  attackJ3: 'attackJ',
  attackJUp: 'attackJ',
  attackJDown: 'attackJ',
  airJ: 'attackJ',
  /*
   * 앞·뒤 커맨드는 위·아래보다 **기본기에 가깝다.**
   * 상단기 그림으로 대신하면 앞으로 파고드는 기술에서 팔이 하늘을 향한다.
   * 몸이 하는 일이 다르므로 기본 약·강공격 쪽으로 떨어뜨린다.
   */
  attackJFwd: 'attackJ',
  attackJBack: 'attackJ',
  // 강공격 계열 → 기본 강공격
  attackK2: 'attackK',
  attackKUp: 'attackK',
  attackKDown: 'attackK',
  attackKFwd: 'attackK',
  attackKBack: 'attackK',
  // 개성 필살 그림이 없으면 강공격 마무리가 가장 가깝다
  flair: 'attackK2',
  airK: 'attackK',
  dive: 'attackK',
  dashAttack: 'attackK',
  // 미끄러지는 그림이 없으면 달려드는 그림이 그나마 가깝다
  dashSlide: 'dashAttack',
  // 공중 올려차기는 상단기, 뒤차기는 공중 강공격이 가장 가깝다
  airUp: 'attackKUp',
  airBack: 'airK',
  /*
   * 잡기 — 전용 그림이 없어도 손을 뻗는 그림(attackJ)이면 읽힌다.
   * 잡힌 쪽은 맞는 자세, 붙잡고 선 자세는 서 있는 그림으로 떨어진다.
   */
  grab: 'attackJ',
  throw: 'attackK',
  grabHold: 'idle',
  grabbed: 'hit',
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
/* 묶음 일부만 뽑은 시트                                                */
/* ------------------------------------------------------------------ */

/**
 * V3 42칸이 어떤 순서로 무엇을 담는가.
 *
 * ── 왜 이런 표가 따로 필요한가 ────────────────────────────────────
 * 캐릭터 스무 명 × 7묶음 = 140장이다. 한 장 뽑는 데 마음에 들 때까지
 * 몇 번씩 다시 돌리는 것을 생각하면, 전원 완성은 현실적인 목표가 아니다.
 *
 * 그런데 42칸 중에는 없어도 티가 덜 나는 것들이 있다. 도발·아이템·기절은
 * 한 판에 몇 번 안 나오고, 포즈 대체 사슬(POSE_FALLBACK)이 비슷한 그림으로
 * 메워 준다. 반대로 대기·달리기·연속기·초상은 늘 화면에 있다.
 *
 * 그래서 "1·3·7 묶음만 뽑은 18칸 시트"를 정식으로 받아들인다.
 * 스무 명을 60장으로 그럴듯하게 채울 수 있다 — 도형 아트로 두는 것보다
 * 비교가 안 되게 낫다. 나머지 묶음은 시간이 남을 때 채워 넣으면
 * 게임 쪽은 손댈 것 없이 자동으로 늘어난다.
 *
 * 'fx:' 로 시작하는 칸은 포즈가 아니라 이펙트·초상으로 쓴다.
 */
const V3_CELLS: string[] = [
  /* 1묶음 이동 */ 'idle', 'walk', 'run', 'run', 'run', 'dash',
  /* 2묶음 공중 */ 'jump', 'fall', 'land', 'airJ', 'airK', 'dive',
  /* 3묶음 연속기 */ 'attackJ', 'attackJ2', 'attackJ3', 'attackK', 'attackK2', 'dashAttack',
  /* 4묶음 방향기 */ 'attackJUp', 'attackJDown', 'attackKUp', 'attackKDown', 'guard', 'dizzy',
  /* 5묶음 스킬 */ 'skillCharge', 'skill', 'skill', 'fx:skill', 'promptCast', 'fx:prompt',
  /* 6묶음 아이템 */ 'itemGet', 'itemHold', 'itemThrow', 'itemSwing', 'taunt', 'down',
  /* 7묶음 결과 */ 'hit', 'hitAir', 'knockback', 'win', 'lose', 'fx:portrait',
  /*
   * 8묶음 앞뒤 커맨드 — 커맨드가 열넷에서 스물하나로 늘면서 생긴 자리다.
   * 앞으로 파고드는 기술과 빠지면서 내는 기술은 몸이 하는 일이 정반대라,
   * 한 그림으로 돌려 쓰면 방향을 나눈 의미가 통째로 사라진다.
   */
  /* 8묶음 앞뒤 */ 'attackJFwd', 'attackJBack', 'attackKFwd', 'attackKBack', 'dashSlide', 'airUp',
  /*
   * 9묶음 잡기 — 지금까지 잡기는 전용 그림이 하나도 없어서, 붙잡고 선 자세가
   * 그냥 서 있는 그림이었다. 무슨 일이 벌어지는 중인지 화면만 봐서는 모른다.
   * 마지막 칸의 IDLE_B 는 대기 자세 두 번째 칸이다 — 두 장이 오가면
   * 가만히 서 있어도 숨을 쉰다.
   */
  /* 9묶음 잡기 */ 'grab', 'grabHold', 'grabbed', 'throw', 'airBack', 'idle',
  /*
   * 10·11묶음 — 공격의 "다음 순간".
   *
   * 태그를 앞 묶음과 똑같이 적는 것이 핵심이다. buildV3Layout 은 같은 태그가
   * 또 나오면 배열로 합치고, 배열 포즈는 자동으로 애니메이션이 된다.
   * 즉 이 두 묶음을 뽑아 넣는 것만으로 **한 장짜리 공격이 두 장짜리
   * 휘두름(내지름 → 팔로우스루)으로 바뀐다.** 게임 코드는 손대지 않는다.
   */
  /* 10묶음 후속A */ 'attackJ', 'attackK', 'attackJ3', 'attackK2', 'dashAttack', 'dive',
  /* 11묶음 후속B */ 'attackKUp', 'attackKDown', 'attackKFwd', 'attackKBack', 'airK', 'skill',
  /*
   * 12묶음 — 개성 필살 + 살아나는 대기 동작.
   *
   * FLAIR 세 장은 그 캐릭터만의 자유 연출이다. 규격의 어떤 기술에도 묶이지
   * 않고 "이 인물이 가장 그 인물다운 공격"을 그리게 한다. 게임에서는 완전
   * 충전 강공격이 이 3장을 재생한다 — 참았다 터뜨린 한 방이 그 캐릭터의
   * 서명이 되도록. WALK 두 장째·TAUNT·WIN 후속은 반복 동작을 살린다.
   */
  /* 12묶음 개성 */ 'flair', 'flair', 'flair', 'walk', 'taunt', 'win',
];

/** 한 묶음에 들어가는 칸 수 */
const V3_BATCH_SIZE = 6;

/** 묶음 총 개수 — 프롬프트 생성기(art-characters.mjs)와 반드시 같아야 한다 */
export const TOTAL_BATCHES = V3_CELLS.length / V3_BATCH_SIZE;

interface BuiltLayout {
  poses: Partial<Record<Pose, PoseFrames>>;
  explosionFrame?: number;
  promptFrame?: number;
  portraitFrame?: number;
}

/**
 * 뽑은 묶음 번호만 가지고 배치표를 만든다.
 *
 * 빠진 묶음의 포즈는 아예 등록하지 않는다 — 없는 포즈는 resolvePose 가
 * 대체 사슬을 타고 비슷한 그림으로 대신한다. 여기서 억지로 0번 칸 같은 것을
 * 넣어 두면 모든 기술이 대기 자세로 나가서, 오히려 없느니만 못하다.
 */
export function buildV3Layout(batches: number[]): BuiltLayout {
  const out: BuiltLayout = { poses: {} };
  let frame = 0;

  for (const b of batches) {
    const start = (b - 1) * V3_BATCH_SIZE;
    for (const tag of V3_CELLS.slice(start, start + V3_BATCH_SIZE)) {
      if (tag.startsWith('fx:')) {
        const which = tag.slice(3);
        if (which === 'skill') out.explosionFrame = frame;
        if (which === 'prompt') out.promptFrame = frame;
        if (which === 'portrait') out.portraitFrame = frame;
      } else {
        const pose = tag as Pose;
        const prev = out.poses[pose];
        // 같은 태그가 연달아 나오면 여러 칸짜리 애니메이션이다 (run, skill)
        if (prev === undefined) out.poses[pose] = frame;
        else if (Array.isArray(prev)) prev.push(frame);
        else out.poses[pose] = [prev, frame];
      }
      frame++;
    }
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* 규격 자동 판별                                                       */
/* ------------------------------------------------------------------ */

/**
 * 9묶음을 다 담은 시트(54칸).
 *
 * 손으로 표를 하나 더 적지 않고 배치 조립기에서 뽑는다 — 칸 순서가 적힌
 * 곳이 둘이면 반드시 한쪽만 고쳐지고, 그때 증상은 "그림은 멀쩡한데 게임에서
 * 엉뚱한 자세가 나온다"로 나타난다. 원인과 하나도 안 닮은 증상이다.
 */
const BUILT_V4 = buildV3Layout(
  Array.from({ length: TOTAL_BATCHES }, (_, i) => i + 1),
);

/** 프레임 수로 고르는 규격표 — 위에서부터 처음 맞는 것을 쓴다 */
const LAYOUTS = [
  {
    name: 'V4',
    minFrames: TOTAL_BATCHES * V3_BATCH_SIZE,
    poses: BUILT_V4.poses,
    explosionFrame: BUILT_V4.explosionFrame,
    promptFrame: BUILT_V4.promptFrame,
    portraitFrame: BUILT_V4.portraitFrame,
  },
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
export function applyLayout(
  def: SpriteSheetDef,
  frameCount: number,
  batches?: number[],
): string {
  /*
   * 시트가 "어느 묶음을 담았는지" 직접 말해 주면 프레임 수로 추측할 필요가 없다.
   * 1·3·7 묶음만 뽑은 18칸 시트는 프레임 수만 보면 V1(15칸)으로 오인되어
   * 전혀 다른 칸이 나온다 — 그림은 멀쩡한데 게임에서 캐릭터가 망가진다.
   */
  if (batches?.length && batches.length * V3_BATCH_SIZE === frameCount) {
    const built = buildV3Layout(batches);
    def.poses = built.poses;
    def.explosionFrame = built.explosionFrame;
    def.promptFrame = built.promptFrame;
    def.portraitFrame = built.portraitFrame;
    return batches.length === TOTAL_BATCHES
      ? 'V4'
      : `V4-부분(${batches.join('·')}묶음)`;
  }

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
/**
 * 캐릭터 표시 높이(px).
 *
 * 이 값은 **서 있는 그림의 키**다 (칸 높이가 아니다).
 *
 * 전에는 칸 높이를 이 값으로 맞췄는데, 칸 크기는 그 시트에서 가장 큰 프레임이
 * 정한다 — 이펙트가 큰 칸이 하나 있으면 시트 전체의 칸이 커지고 사람은
 * 작아진다. 그래서 시트마다 서 있는 키가 134~151px 로 갈렸다.
 * 이제 서 있는 그림을 직접 재서 맞추므로, 시트를 어떻게 뽑았든 키가 같다.
 * 144는 갈려 있던 값들의 가운데다 — 전체 크기감은 그대로 두고 줄만 맞춘다.
 *
 * 116으로 시작했는데, 배경이 실제 그림으로 바뀌자 화면 대비 너무 작아졌다.
 * 웅장한 거래소 안에서 손가락만 한 사람들이 싸우는 꼴이라, 공격 동작이
 * 아무리 달라도 눈에 안 들어온다. 발판 간격과 점프 높이는 그대로 두고
 * 보이는 크기만 키운다 — 물리 바디는 FIGHTER.BODY_H 가 따로 잡고 있다.
 */
const SD_HEIGHT = 144;

export const SPRITE_SHEETS: Partial<Record<CharacterId, SpriteSheetDef>> = {
  gates: {
    key: 'billgates',
    displayHeight: SD_HEIGHT,
    frameRate: 9,
    poses: LAYOUT_V1,
  },

  pepe: {
    key: 'pennywise',
    displayHeight: SD_HEIGHT,
    frameRate: 10,
    poses: LAYOUT_V1,
    // 옛 시트의 8번은 캐릭터 없이 도끼 에너지만 있는 프레임이다
    v1: { explosionFrame: 8 },
  },

  musk: {
    key: 'elonmusk',
    displayHeight: SD_HEIGHT,
    frameRate: 10,
    poses: LAYOUT_V1,
    // 옛 시트의 8번은 폭발 단독 → 로켓 드롭 착지 충격파로 쓴다
    v1: { explosionFrame: 8 },
  },

  jobs: {
    key: 'stevejobs',
    displayHeight: SD_HEIGHT,
    frameRate: 9,
    poses: LAYOUT_V1,
    // 옛 시트는 SKILL_L2 에도 캐릭터가 있어 2프레임으로 이어 재생한다
    v1: { poses: { skill: [7, 8] } },
  },

  linus: {
    key: 'linustorvalds',
    displayHeight: SD_HEIGHT,
    frameRate: 9,
    poses: LAYOUT_V1,
    // 8 = 캐릭터 없이 커널 패닉 에너지만 있는 프레임 → 투사체로 쓴다
    v1: { explosionFrame: 8 },
  },

  /*
   * ── 아래는 아직 그림이 없는 캐릭터들 ──────────────────────────
   * 그래도 미리 등록해 둔다. 로딩 쪽이 파일이 실제로 있는지 먼저 확인하고
   * 없으면 조용히 도형 아트로 넘어가므로, 등록해 둔다고 손해 볼 것이 없다.
   *
   * 얻는 것은 크다 — `npm run sheet:merge -- warrenbuffett` 한 줄로
   * 나온 시트를 public/sprites/ 에 넣으면 코드를 한 글자도 안 고치고 붙는다.
   * 규격(몇 묶음을 뽑았는지)도 시트가 스스로 알려준다.
   */
  buffett: { key: 'warrenbuffett', displayHeight: SD_HEIGHT, frameRate: 9, poses: LAYOUT_V1 },
  jensen: { key: 'jensenhuang', displayHeight: SD_HEIGHT, frameRate: 10, poses: LAYOUT_V1 },
  satoshi: { key: 'satoshinakamoto', displayHeight: SD_HEIGHT, frameRate: 10, poses: LAYOUT_V1 },
  zuck: { key: 'markzuckerberg', displayHeight: SD_HEIGHT, frameRate: 9, poses: LAYOUT_V1 },
  bezos: { key: 'jeffbezos', displayHeight: SD_HEIGHT, frameRate: 9, poses: LAYOUT_V1 },
  altman: { key: 'samaltman', displayHeight: SD_HEIGHT, frameRate: 10, poses: LAYOUT_V1 },
  son: { key: 'masayoshison', displayHeight: SD_HEIGHT, frameRate: 10, poses: LAYOUT_V1 },
  ant: { key: 'antinvestor', displayHeight: SD_HEIGHT, frameRate: 11, poses: LAYOUT_V1 },
  bear: { key: 'shortseller', displayHeight: SD_HEIGHT, frameRate: 9, poses: LAYOUT_V1 },
  bull: { key: 'chargingbull', displayHeight: SD_HEIGHT, frameRate: 10, poses: LAYOUT_V1 },
  guru: { key: 'chartguru', displayHeight: SD_HEIGHT, frameRate: 10, poses: LAYOUT_V1 },
  turing: { key: 'alanturing', displayHeight: SD_HEIGHT, frameRate: 9, poses: LAYOUT_V1 },
  chung: { key: 'chungjuyung', displayHeight: SD_HEIGHT, frameRate: 8, poses: LAYOUT_V1 },
  hawking: { key: 'stephenhawking', displayHeight: SD_HEIGHT, frameRate: 9, poses: LAYOUT_V1 },
  whale: { key: 'whaleinvestor', displayHeight: SD_HEIGHT, frameRate: 8, poses: LAYOUT_V1 },
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
  /**
   * 이 시트에 담긴 묶음 번호 (1~7).
   * sheet:merge 가 적어 준다. 일부만 뽑은 시트에서 배치를 정확히 맞추는 근거다.
   */
  batches?: number[];
}
