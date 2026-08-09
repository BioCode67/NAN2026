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
 * 카메라 — 뭉치면 파고들고, 흩어지면 물러난다.
 *
 * ── 왜 당기기만 하는가 ─────────────────────────────────────────────
 * 월드는 1920×720, 화면은 1280×720 이다. **세로가 정확히 같아서** 1.0 보다
 * 물러나는 순간 무대 위아래로 아무것도 없는 빈 공간이 드러난다. 줌은
 * 가로세로가 함께 가므로 "가로로만 물러나기"도 없다. 1.0 이 가장 넓다.
 */
export const CAMERA = {
  /** 가장 많이 당겼을 때 */
  MAX_ZOOM: 1.32,
  /**
   * 전원이 화면에 들어올 때 가장자리에 남겨 둘 여유 (px).
   *
   * 좁게 잡으면 화면 끝에 딱 붙은 채로 싸우다가, 한 대 맞아 밀리는 순간
   * 곧바로 밖으로 나간다. 캐릭터 반 몸 + 한 번 날아갈 자리다.
   */
  MARGIN: 230,
  /**
   * 줌 보간 계수 — 1초 뒤 남는 오차의 비율이다 (작을수록 빠르다).
   *
   * 스크롤(0.0015)보다 훨씬 느리게 둔다. 넷이 뒤엉킨 판은 사람 사이 거리가
   * 매 순간 출렁이는데, 줌이 그걸 그대로 따라가면 화면이 숨 쉬듯 울렁거려
   * 눈이 먼저 지친다.
   */
  ZOOM_IN_EASE: 0.28,
  /** 물러나는 쪽은 조금 빠르게 — 늦으면 누군가 화면 밖에 잠깐 머문다 */
  ZOOM_OUT_EASE: 0.06,
  /**
   * 격추 순간 한 호흡 들어갔다 나오는 펀치의 세기.
   *
   * 따라가는 줌 위에 **배수로** 얹힌다. 절대값으로 두면 이미 당겨 있던
   * 판에서 오히려 물러났다 돌아오는 반대 연출이 된다.
   */
  KO_PUNCH: 0.09,
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
 *
 * ── 거품이 클수록 크게 터진다 (kbTakenMul) ─────────────────────────
 * 떡상한 사람은 **더 멀리 날아간다.** 0.82배(위기)에서 1.55배(초!떡상)까지.
 *
 * 넷이 붙는 판에서 이 한 줄이 하는 일이 크다. 지금까지 앞서 나가는 사람은
 * 공격력·속도·쿨다운이 전부 좋아지기만 했다 — 한 번 벌어지면 그대로
 * 굳어서, 나머지 셋은 판이 끝나기를 기다리는 시간이 됐다. 셋이 힘을 합쳐도
 * 되돌릴 수단이 없으면 합칠 이유도 없다.
 *
 * 이제 앞선 사람은 세지만 **가볍다.** 왕관 쓴 사람을 장외로 밀어내는 것이
 * 실제로 되는 일이 되고, 그 순간 셋의 이해가 맞아떨어진다. 파티 게임에서
 * 제일 시끄러운 순간이 거기서 나온다.
 *
 * 반대쪽도 같은 이유다. 주가가 바닥이면(위기) 0.82배로 잘 안 밀린다 —
 * 어차피 0%면 상장폐지라 이미 벼랑 끝인데 장외로도 쉽게 나가면 손쓸
 * 시간이 아예 없다. 바닥에 눌어붙은 동전주는 잘 안 움직인다.
 *
 * **규칙이 이미 화면에 있다.** 오라와 불꽃이 등급 표시라, 새로 그릴 것이
 * 없다 — "불타는 사람은 멀리 날아간다" 한 줄이면 설명이 끝난다.
 */
export const TIERS: Record<StockTier, TierEffect> = {
  [StockTier.DELISTED]: {
    tier: StockTier.DELISTED,
    label: '상장폐지',
    min: 0,
    atkMul: 1,
    speedMul: 1,
    cooldownMul: 1,
    kbTakenMul: 1,
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
    kbTakenMul: 0.82,
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
    kbTakenMul: 1,
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
    kbTakenMul: 1.12,
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
    kbTakenMul: 1.24,
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
    kbTakenMul: 1.38,
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
    kbTakenMul: 1.55,
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
  /**
   * 피격 후 무적 시간 (ms) — 스턴락 방지.
   *
   * 연속기가 생기면서 낮췄다. 무적이 길면 2·3타가 통째로 씹혀
   * 몰아치는 손맛이 사라진다. (판정 지속이 이보다 길어 무적이 풀리는 순간
   * 이어서 맞는다 — 완전히 없애지 않고도 연속기가 성립한다)
   */
  INVULN_MS: 140,
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

  /* --- 조작감 ---------------------------------------------------- */

  /**
   * 점프 버튼을 일찍 떼면 상승이 잘리는 비율 (숏홉).
   *
   * 대난투류에서 "낮게 톡 뛰어 공중 약공격"이 성립하는 이유가 이것이다.
   * 점프가 늘 같은 높이면 공중 기술은 정점에서만 쓰게 되고, 지상과 공중을
   * 오가는 리듬이 사라진다. 짧게 누르면 낮게, 길게 누르면 높게 —
   * **같은 버튼에 두 개의 선택지**가 생긴다.
   */
  SHORT_HOP_MUL: 0.46,
  /**
   * 버튼을 뗀 뒤 상승에 얹는 추가 중력 (px/s²).
   *
   * 뗀 "순간"만 잡아 한 번에 속도를 자르는 방식은 프레임이 드문 환경에서
   * 누르고 떼는 것이 통째로 프레임 사이에 들어가면 통째로 사라진다.
   * 매 프레임 조금씩 눌러 내리면 그 문제가 없고, 뚝 끊기지 않아 더 부드럽다.
   */
  LOW_JUMP_GRAVITY: 3400,
  /**
   * 착지 직전에 누른 점프를 기억하는 시간 (ms).
   *
   * 사람은 착지하는 순간에 정확히 누르지 못한다. 조금 일찍 누른 것을
   * 버려 버리면 "점프가 씹혔다"로 느껴지고, 그 감각이 이 게임을
   * 뻑뻑하게 만드는 가장 큰 원인이었다.
   */
  JUMP_BUFFER_MS: 140,

  /* --- 회피 ------------------------------------------------------ */

  /** 회피 지속 (ms) */
  DODGE_MS: 300,
  /** 회피 중 무적이 유지되는 시간 (ms) — 지속보다 짧다 */
  DODGE_INVULN_MS: 210,
  /** 구르기 이동 속도 배율 */
  DODGE_SPEED_MUL: 2.6,
  /** 회피 재사용 대기 (ms) */
  DODGE_COOLDOWN: 620,

  /* --- 공중 회피 --------------------------------------------------- */

  /**
   * 공중 회피 무적 (ms) — 지상 회피보다 짧다.
   *
   * ── 왜 넣는가 ──────────────────────────────────────────────────
   * 구르기도 제자리 회피도 지상 전용이라, **날아가는 동안에는 할 수 있는
   * 것이 하나도 없었다.** 크게 얻어맞고 공중에 뜬 순간부터 착지할 때까지
   * 손이 논다. 그 몇 초가 이 게임에서 제일 재미없는 시간이고, 넷이 붙는
   * 판에서는 그 사이에 다른 둘이 쫓아와 그대로 마무리한다.
   *
   * 공중에서도 빠져나갈 수 있어야 쫓는 쪽도 읽을 것이 생긴다.
   *
   * ── 왜 지상보다 짧은가 ─────────────────────────────────────────
   * 공중 회피는 **회피이면서 동시에 이동**이다. 무적이 지상만큼 길면
   * 무적으로 감싼 채 장외에서 돌아오는 수단이 되어, 복귀 저지라는 판이
   * 통째로 사라진다. 짧게 둬서 "타이밍을 맞히면 살아남는다"까지만 준다.
   */
  AIR_DODGE_INVULN_MS: 150,
  /** 공중 회피가 뻗는 거리의 속도 (px/s) */
  AIR_DODGE_SPEED: 470,
  /**
   * 회피 뒤 굳는 시간 (ms) — 무적이 끝나고도 이만큼 못 움직인다.
   *
   * 대가가 없으면 뜨자마자 누르는 것이 언제나 정답이 된다. 빗나가면
   * 그대로 떨어지는 시간이 있어야 **지를지 참을지**가 판단이 된다.
   */
  AIR_DODGE_LAG_MS: 240,
  /**
   * 한 번 뜬 동안 몇 번 쓸 수 있는가.
   *
   * 한 번이다. 여러 번 되면 공중에서 무적을 이어 붙여 내려오지 않는
   * 캐릭터가 생긴다. 착지하면 다시 채워진다.
   */
  AIR_DODGE_PER_AIRTIME: 1,

  /* --- 벗어나기 (DI) ----------------------------------------------- */

  /**
   * 맞는 순간 누르고 있던 방향으로 넉백을 얼마나 휘게 하는가 (0~1).
   *
   * ── 왜 필요한가 ────────────────────────────────────────────────
   * 지금은 어디로 날아갈지가 때린 기술만으로 정해진다. 맞는 쪽은 구경만
   * 한다 — 살아남는 것이 실력이 아니라 운이다. 누르고 있던 방향으로
   * 궤도가 조금 휘면, 큰 거 한 방을 맞고도 **버텨 낸 것이 내 손 덕**이 된다.
   *
   * 0.28 은 궤도를 16도쯤 튼다. 방향을 뒤집을 만큼은 아니고, 장외 직전에
   * 무대 쪽으로 반 칸 당겨 오기에는 충분한 정도다. 더 키우면 때린 쪽이
   * "분명히 밖으로 보냈는데" 가 되고, 그건 때리는 재미를 깎는다.
   */
  DI_BEND: 0.28,

  /* --- 차지 강공격 ----------------------------------------------- */

  /** 이만큼 누르고 있어야 차지가 시작된다 (ms) */
  CHARGE_MIN_MS: 130,
  /** 최대 차지까지 (ms) */
  CHARGE_MAX_MS: 900,
  /** 최대 차지에서의 피해 배율 */
  CHARGE_DAMAGE_MUL: 1.75,
  /** 최대 차지에서의 넉백 배율 */
  CHARGE_KNOCKBACK_MUL: 1.5,

  /* --- 잡기 ------------------------------------------------------- */
  /**
   * 잡기는 **가드를 뚫는 유일한 수단**이다.
   *
   * 가드와 회피가 생기고 나니 반대쪽 문제가 드러났다. 웅크리고 버티는 상대에게
   * 답이 없다 — 계속 때려서 가드를 깨는 것 말고는. 잡기가 들어가면
   *
   *   공격 → 가드에 막힌다
   *   가드 → 잡기에 뚫린다
   *   잡기 → 공격에 진다 (헛치면 크게 손해)
   *
   * 삼각형이 닫힌다. 이 셋 중 무엇을 낼지가 매 순간의 판단이 된다.
   */
  GRAB_STARTUP: 100,
  GRAB_ACTIVE: 120,
  /** 헛쳤을 때의 후딜 — 공격보다 확실히 길어야 "지르면 손해"가 성립한다 */
  GRAB_WHIFF: 400,
  GRAB_RANGE: 62,
  GRAB_COOLDOWN: 700,
  /** 최대로 붙잡고 있을 수 있는 시간 — 지나면 자동으로 앞으로 던진다 */
  GRAB_HOLD_MS: 1300,
  /** 두드림으로 인정하는 최소 간격 — 연타 매크로가 즉시 탈출하지 못하게 */
  GRAB_MASH_GAP: 55,
  /**
   * 이만큼 두드리면 그 자리에서 뿌리치고 나간다.
   *
   * 사람이 편하게 두드리는 속도가 초당 열 번쯤이니 대략 1초다.
   * 자동 던지기(1.3초)보다 확실히 짧아야 "두드리면 빠져나간다"가 성립하고,
   * 잡은 쪽에는 **툭툭 치며 욕심내지 말고 빨리 던지라**는 압박이 된다.
   */
  GRAB_ESCAPE_MASHES: 10,
  /** 붙잡은 상대를 세워 두는 거리 */
  GRAB_HOLD_OFFSET: 42,
  /** 잡기 공격 1회 피해 */
  PUMMEL_DAMAGE: 3,
  PUMMEL_INTERVAL: 300,
  /** 탈출에 성공한 쪽이 받는 무적 — 탈출하자마자 다시 잡히면 의미가 없다 */
  GRAB_ESCAPE_INVULN: 320,

  /**
   * 공중에서 때리면 점프를 한 번 돌려받는다 (공중 체공 1회 한정).
   *
   * 나루토vs블리치의 공중 연속기가 성립하는 규칙이다. 이것이 없으면
   * 띄운 뒤 쫓아 올라가 한 대 치는 것으로 끝난다 — 위로 던지기도,
   * 상단기도 "띄우면 뭐가 되는" 기술이 아니라 그냥 넉백 큰 기술이 된다.
   */
  AIR_HIT_JUMP_REFUND: true,
} as const;

/**
 * 던지기 네 방향.
 *
 * 방향마다 쓰임이 갈려야 "잡았다" 다음에 생각할 것이 생긴다.
 *  - 앞: 무난한 거리 벌리기
 *  - 뒤: 가장 아프다. 등지고 선 낭떠러지로 넘긴다
 *  - 위: 피해는 낮지만 높이 뜬다 — 쫓아 올라가 공중 연속기
 *  - 아래: 바닥에 꽂아 그 자리에서 다시 붙는다
 */
export const THROW = {
  forward: { name: '앞으로 내던지기', damage: 11, kbX: 620, kbY: -300, hitstun: 420 },
  back: { name: '뒤로 메치기', damage: 13, kbX: 710, kbY: -250, hitstun: 440 },
  up: { name: '위로 띄우기', damage: 9, kbX: 90, kbY: -780, hitstun: 540 },
  down: { name: '바닥에 꽂기', damage: 12, kbX: 240, kbY: -400, hitstun: 380 },
} as const;

export type ThrowKind = keyof typeof THROW;

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

  /**
   * J — 빠르고 가벼운 견제. 연속기 1타.
   *
   * 넉백을 아주 작게 잡는다. 1·2타에서 상대가 밀려나면 3타가 닿지 않아
   * 연속기가 끊긴다 — 마무리 타에서만 크게 날린다.
   */
  light: {
    type: 'light',
    slot: 'light',
    name: '약공격',
    damage: 10,
    startup: 70,
    active: 110,
    recovery: 150,
    range: 66,
    hitHeight: 76,
    hitAnchor: 'front',
    fx: 'thrust',
    knockbackX: 150,
    knockbackY: -90,
    hitstun: 200,
    hitstop: 70,
    shake: 0.008,
    chain: 'light2',
    chainStep: 1,
  },

  /** J 2타 — 반대 손으로 이어 친다 */
  light2: {
    type: 'light',
    slot: 'light2',
    name: '연타 2',
    damage: 10,
    startup: 105,
    active: 115,
    recovery: 160,
    range: 70,
    hitHeight: 78,
    hitAnchor: 'front',
    fx: 'slash',
    knockbackX: 170,
    knockbackY: -110,
    hitstun: 210,
    hitstop: 85,
    shake: 0.01,
    chain: 'light3',
    chainStep: 2,
  },

  /**
   * J 3타 — 마무리.
   * 크게 띄워 올려 공중 콤보로 이어갈 수 있게 한다.
   */
  light3: {
    type: 'light',
    slot: 'light3',
    name: '마무리 일격',
    damage: 15,
    startup: 130,
    active: 130,
    recovery: 330,
    range: 82,
    hitHeight: 96,
    hitAnchor: 'front',
    fx: 'rising',
    knockbackX: 380,
    knockbackY: -620,
    hitstun: 460,
    hitstop: 150,
    shake: 0.024,
    chainStep: 3,
    finisher: true,
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


  /**
   * 앞+J — 파고들며 찌른다.
   *
   * 상대 쪽으로 누르며 치는 기술이라 **거리를 좁히면서 나가야** 의미가 있다.
   * 리치는 짧지만 lunge 로 몸이 따라 들어가므로, 도망가는 상대를 붙잡는
   * 용도가 된다. 대신 넉백이 작아 붙은 거리를 스스로 다시 벌리지 않는다.
   */
  lightFwd: {
    type: 'light',
    slot: 'lightFwd',
    name: '전진 찌르기',
    damage: 10,
    startup: 86,
    active: 96,
    recovery: 196,
    range: 70,
    hitHeight: 78,
    hitAnchor: 'front',
    fx: 'thrust',
    lunge: 260,
    knockbackX: 190,
    knockbackY: -120,
    hitstun: 230,
    hitstop: 75,
    shake: 0.009,
  },

  /**
   * 뒤+J — 빠지면서 앞을 긁는다.
   *
   * 몸은 뒤로 물러나는데 판정은 앞에 남는 견제기다. 몰릴 때 숨 쉴 구멍이
   * 있어야 붙어서 두들기는 쪽도 함부로 들어오지 못한다 — 방어와 회피만으로는
   * "그 자리에서 깨질 때까지 맞는" 상황이 계속 나온다.
   */
  lightBack: {
    type: 'light',
    slot: 'lightBack',
    name: '물러서며 긁기',
    damage: 8,
    startup: 74,
    active: 84,
    recovery: 210,
    range: 86,
    hitHeight: 88,
    hitAnchor: 'front',
    fx: 'slash',
    // 스스로 뒤로 빠진다 (음수 lunge)
    lunge: -300,
    knockbackX: 260,
    knockbackY: -140,
    hitstun: 220,
    hitstop: 70,
    shake: 0.008,
  },

  /* --- 지상 강공격 계열 ------------------------------------------ */

  /**
   * K — 느리지만 강하다. 연속기 1타.
   * 여기서 크게 날려버리면 2타가 닿지 않으므로 넉백은 억제해 두었다.
   */
  heavy: {
    type: 'heavy',
    slot: 'heavy',
    name: '강공격',
    damage: 18,
    startup: 180,
    active: 120,
    recovery: 320,
    range: 84,
    hitHeight: 88,
    hitAnchor: 'front',
    fx: 'slash',
    knockbackX: 300,
    knockbackY: -200,
    hitstun: 340,
    hitstop: 120,
    shake: 0.016,
    chain: 'heavy2',
    chainStep: 1,
  },

  /** K 2타 — 마무리. 멀리 날려 장외를 노린다 */
  heavy2: {
    type: 'heavy',
    slot: 'heavy2',
    name: '마무리 강타',
    damage: 22,
    startup: 165,
    active: 130,
    recovery: 400,
    range: 92,
    hitHeight: 94,
    hitAnchor: 'front',
    fx: 'slam',
    knockbackX: 820,
    knockbackY: -420,
    hitstun: 520,
    hitstop: 175,
    shake: 0.03,
    chainStep: 2,
    finisher: true,
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

  /**
   * 대시 중 J/K — 돌진 공격.
   *
   * 대시에 공격을 붙이면 "거리를 좁히는 행동"과 "때리는 행동"이 하나가 된다.
   * 대신 후딜이 길어 헛치면 크게 손해다.
   */
  dashAttack: {
    type: 'heavy',
    slot: 'dashAttack',
    name: '돌진 공격',
    damage: 16,
    startup: 105,
    active: 150,
    recovery: 340,
    range: 96,
    hitHeight: 84,
    hitAnchor: 'front',
    fx: 'thrust',
    lunge: 620,
    knockbackX: 640,
    knockbackY: -330,
    hitstun: 400,
    hitstop: 125,
    shake: 0.018,
  },


  /**
   * 앞+K — 몸을 실어 밀어붙인다.
   *
   * 이 게임에서 가장 멀리 파고드는 지상기. 느린 대신 맞으면 상대가 크게
   * 날아가므로, 장외로 밀어내는 마무리 수단이 된다.
   */
  heavyFwd: {
    type: 'heavy',
    slot: 'heavyFwd',
    name: '몸통 밀어붙이기',
    damage: 20,
    startup: 178,
    active: 112,
    recovery: 300,
    range: 96,
    hitHeight: 96,
    hitAnchor: 'front',
    fx: 'thrust',
    lunge: 520,
    knockbackX: 620,
    knockbackY: -240,
    hitstun: 320,
    hitstop: 95,
    shake: 0.013,
  },

  /**
   * 뒤+K — 거리를 벌리며 크게 후린다.
   *
   * 물러나면서 내는 큰 기술이라 헛치면 크게 굳는다. 대신 들어오는 상대를
   * 정확히 맞히면 그대로 다시 멀어진다 — 도망 다니며 싸우는 선택지가
   * 성립하려면 이런 것이 하나는 있어야 한다.
   */
  heavyBack: {
    type: 'heavy',
    slot: 'heavyBack',
    name: '거리 벌리기',
    damage: 18,
    startup: 168,
    active: 104,
    recovery: 330,
    range: 108,
    hitHeight: 92,
    hitAnchor: 'front',
    fx: 'slash',
    lunge: -420,
    knockbackX: 560,
    knockbackY: -300,
    hitstun: 330,
    hitstop: 92,
    shake: 0.012,
  },

  /**
   * 대시 중 K — 미끄러지며 발밑을 쓸어버린다.
   *
   * 같은 대시에서 J 는 어깨로 들이받고(dashAttack) K 는 미끄러진다.
   * 하나뿐이던 돌진기가 둘로 갈리고, 낮게 깔리는 판정이라 서서 막는
   * 상대에게 통한다.
   */
  dashSlide: {
    type: 'heavy',
    slot: 'dashSlide',
    name: '슬라이딩',
    damage: 15,
    startup: 96,
    active: 130,
    recovery: 300,
    range: 118,
    hitHeight: 44,
    hitAnchor: 'down',
    fx: 'slash',
    lunge: 700,
    knockbackX: 380,
    knockbackY: -160,
    hitstun: 300,
    hitstop: 85,
    shake: 0.011,
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


  /**
   * 공중 W + J/K — 머리 위를 걷어 올린다.
   *
   * 공중전이 "지나가며 한 번 치기"에서 벗어나려면 **위를 치는 수단**이
   * 있어야 한다. 나보다 높이 뜬 상대를 계속 쫓아 올라가며 이어칠 수 있고,
   * 2단 점프와 짝지으면 공중 연속기가 성립한다.
   */
  airUp: {
    type: 'light',
    slot: 'airUp',
    name: '공중 올려차기',
    damage: 11,
    startup: 66,
    active: 108,
    recovery: 150,
    range: 62,
    hitHeight: 128,
    hitAnchor: 'up',
    fx: 'rising',
    knockbackX: 140,
    knockbackY: -560,
    hitstun: 320,
    hitstop: 82,
    shake: 0.011,
  },

  /**
   * 공중 뒤 + J/K — 뒤쫓아 온 상대를 걷어찬다.
   *
   * 도망치며 뛰는 동안 뒤가 완전히 무방비였다. 뒤로 내는 판정 하나가
   * 붙으면 쫓는 쪽도 생각할 것이 생긴다.
   */
  airBack: {
    type: 'heavy',
    slot: 'airBack',
    name: '공중 뒤차기',
    damage: 15,
    startup: 92,
    active: 116,
    recovery: 180,
    range: 88,
    hitHeight: 84,
    hitAnchor: 'front',
    fx: 'slash',
    knockbackX: 520,
    knockbackY: -260,
    hitstun: 340,
    hitstop: 95,
    shake: 0.013,
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
  { slot: 'lightFwd', keys: '앞+J' },
  { slot: 'lightBack', keys: '뒤+J' },
  { slot: 'heavy', keys: 'K' },
  { slot: 'heavyUp', keys: 'W+K' },
  { slot: 'heavyDown', keys: 'S+K' },
  { slot: 'heavyFwd', keys: '앞+K' },
  { slot: 'heavyBack', keys: '뒤+K' },
  { slot: 'dashAttack', keys: '대시 중 J' },
  { slot: 'dashSlide', keys: '대시 중 K' },
  { slot: 'airLight', keys: '공중 J' },
  { slot: 'airHeavy', keys: '공중 K' },
  { slot: 'airUp', keys: '공중 W+J/K' },
  { slot: 'airBack', keys: '공중 뒤+J/K' },
  { slot: 'airDive', keys: '공중 S+J/K' },
  { slot: 'skill', keys: 'L' },
];

/**
 * 연속기 — 같은 버튼을 이어 누르면 순서대로 나간다.
 *
 * 커맨드 목록과 따로 두는 이유: 이건 "다른 입력"이 아니라
 * "같은 입력을 이어서" 내는 것이라, 나열하면 오히려 헷갈린다.
 */
export const CHAIN_STRINGS: Array<{ keys: string; slots: MoveSlot[] }> = [
  { keys: 'J J J', slots: ['light', 'light2', 'light3'] },
  { keys: 'K K', slots: ['heavy', 'heavy2'] },
];

/** 연속기 관련 타이밍 */
export const CHAIN = {
  /**
   * 한 타가 완전히 끝난 뒤에도 이만큼은 이어 칠 수 있다.
   *
   * 후딜이 끝나는 순간에 정확히 눌러야 이어진다면 연타가 아니라 암기가 된다.
   * 조금 늦어도 이어지게 해야 몰아치는 느낌이 난다.
   */
  GRACE_MS: 260,
} as const;

/**
 * 템플릿에 있는 슬롯 전부 — 커맨드 목록에 없는 연속기 링크도 빠짐없이 채워야 한다.
 * 온라인에서 슬롯을 번호로 주고받는 순서표도 겸한다 (양쪽이 같은 코드를 본다).
 */
export const MOVE_SLOTS = Object.keys(MOVE_TEMPLATES) as MoveSlot[];

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
  dashing = false,
): MoveSlot {
  if (!onGround) {
    /*
     * 공중에서 방향을 섞으면 약·강을 가리지 않고 같은 기술로 모은다.
     * 공중은 이미 발판이 없어 불안한 곳이라, 여기서까지 여덟 갈래로 나누면
     * 무엇을 냈는지 스스로도 모르게 된다. 위·아래·뒤 셋만 갈라 둔다.
     */
    if (dir === 'down') return 'airDive';
    if (dir === 'up') return 'airUp';
    if (dir === 'back') return 'airBack';
    return intent === 'light' ? 'airLight' : 'airHeavy';
  }
  /*
   * 대시 중에는 위·아래를 눌러도 돌진기가 나간다.
   * 대시하면서 방향키를 함께 잡고 있는 일이 잦은데, 그때마다 상단기가 나가면
   * "달려가서 쳤는데 엉뚱한 게 나온다"가 된다.
   *
   * 다만 J 와 K 는 가른다 — 어깨로 들이받는 것과 미끄러져 발밑을 쓰는 것은
   * 쓰임이 전혀 다르고, 달리는 중에도 그 둘은 구별해서 내고 싶다.
   */
  if (dashing) return intent === 'light' ? 'dashAttack' : 'dashSlide';

  if (dir === 'up') return intent === 'light' ? 'lightUp' : 'heavyUp';
  if (dir === 'down') return intent === 'light' ? 'lightDown' : 'heavyDown';
  if (dir === 'forward') return intent === 'light' ? 'lightFwd' : 'heavyFwd';
  if (dir === 'back') return intent === 'light' ? 'lightBack' : 'heavyBack';
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
  /*
   * 피격 찌그러짐은 여기 있던 고정값(1.35 / 0.68 / 90ms)을 버리고
   * HIT_REACTIONS 로 옮겼다 — 기술마다 다른 모양이 필요해졌기 때문이다.
   */
  /** 임팩트 파티클 개수 */
  PARTICLE_COUNT: 14,
  /** 데미지 숫자 팝업 지속 (ms) */
  FLOATING_MS: 700,
} as const;

/* ------------------------------------------------------------------ */
/* 맞은 쪽의 반응                                                      */
/* ------------------------------------------------------------------ */

/**
 * 맞은 몸이 그리는 모양.
 *
 * ── 왜 나눠야 하나 ────────────────────────────────────────────────
 * 때리는 쪽은 기술마다 갈라 놓았다 — 예비동작, 내지르는 폭, 이펙트 모양,
 * 타수별 크기까지. 그런데 **맞는 쪽은 전부 같은 모양으로 찌그러졌다.**
 * 쳐올려서 상대가 하늘로 뜨는데 몸은 옆으로 밀릴 때와 똑같이 납작해지면,
 * 절반만 전달된다. 무엇을 맞혔는지는 때린 쪽이 아니라 **맞은 쪽 몸**에
 * 가장 크게 쓰여 있다.
 *
 * 값을 정한 기준: 실제로 날아가는 방향과 몸 모양이 어긋나지 않을 것.
 * 위로 뜨면 세로로 늘어나고, 바닥에 꽂히면 납작해진다.
 */
export type HitReaction = 'launch' | 'slam' | 'blow' | 'spin' | 'jab';

export interface HitReactionSpec {
  /** 사람이 읽을 이름 — 검사와 기록에 쓴다 */
  label: string;
  /** 몸이 젖혀지는 각도 (음수 = 뒤로. 360이면 한 바퀴 돈다) */
  lean: number;
  /** 찌그러짐 */
  squashX: number;
  squashY: number;
  /** 되돌아오는 시간 (ms) */
  ms: number;
}

export const HIT_REACTIONS: Record<HitReaction, HitReactionSpec> = {
  /** 쳐올림 — 뒤로 크게 젖혀지며 세로로 늘어난다 */
  launch: { label: '떠오름', lean: -38, squashX: 0.82, squashY: 1.3, ms: 300 },
  /** 바닥으로 꽂음 — 젖혀질 틈 없이 눌린다 */
  slam: { label: '짓눌림', lean: -8, squashX: 1.46, squashY: 0.56, ms: 210 },
  /** 후려침 — 상체가 젖혀지며 뒤로 밀려난다 */
  blow: { label: '날아감', lean: -27, squashX: 1.34, squashY: 0.72, ms: 250 },
  /** 회전기 — 같이 휘말려 한 바퀴 돈다 */
  spin: { label: '휘말림', lean: -360, squashX: 1.14, squashY: 0.9, ms: 360 },
  /** 잔타 — 짧게 흠칫한다. 여기까지 크게 만들면 3타의 무게가 죽는다 */
  jab: { label: '흠칫', lean: -13, squashX: 1.2, squashY: 0.86, ms: 130 },
};

/**
 * 이 공격을 맞으면 몸이 어떻게 되는가.
 *
 * 기술 이름이 아니라 **넉백 방향**으로 고른다. "내려찍기"라는 이름을 달고도
 * 실제로는 상대를 띄우는 기술이 있는데(heavyDown), 이름을 따라가면 몸은
 * 눌리는데 상대는 하늘로 뜨는 그림이 나온다. 눈에 보이는 것과 물리가
 * 어긋나는 쪽이 훨씬 나쁘다.
 */
/**
 * 반응을 번호로 주고받기 위한 고정 순서 (POSE_ORDER 와 같은 이유).
 * 뒤에만 덧붙일 것 — 중간이 밀리면 참가자 화면에서 엉뚱한 반응이 나온다.
 */
export const HIT_REACTION_ORDER: HitReaction[] = [
  'jab',
  'blow',
  'launch',
  'slam',
  'spin',
];

export function hitReactionOf(atk: AttackConfig): HitReaction {
  // 아래로 꽂는 기술 (다이브) — 부호가 뒤집힌 유일한 경우라 먼저 거른다
  if (atk.knockbackY >= 0) return 'slam';
  if (atk.fx === 'spin') return 'spin';

  const up = -atk.knockbackY;
  const back = atk.knockbackX;

  // 옆으로 미는 힘보다 띄우는 힘이 클 때만 "떠오름"이다
  if (up >= 420 && up >= back) return 'launch';
  if (atk.hitAnchor === 'down') return 'slam';
  if (back >= 300) return 'blow';
  return 'jab';
}

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
