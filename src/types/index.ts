/**
 * 게임 전역 타입 정의
 * 모든 시스템이 공유하는 형태는 여기에만 선언한다.
 */

/** 캐릭터 고유 ID */
export type CharacterId = 'gates' | 'jobs' | 'musk' | 'linus' | 'pepe';

/** 진영 구분 (플레이어 / AI 봇) */
export type Side = 'player' | 'ai';

/* ------------------------------------------------------------------ */
/* 주가(스톡) & 떡상 등급                                              */
/* ------------------------------------------------------------------ */

/**
 * 떡상 등급.
 * 숫자가 클수록 높은 등급이며, 대소 비교(>=)로 판정하므로 순서를 바꾸지 말 것.
 */
export enum StockTier {
  /** 0% — 상장폐지 (즉시 KO) */
  DELISTED = 0,
  /** 1~49% — 위기 (붉은 깜빡임, 능력치 패널티는 없음) */
  CRISIS = 1,
  /** 50~100% — 보통 / 기본 (100%가 시작 상태) */
  NORMAL = 2,
  /** 101~149% — 상승 */
  RISING = 3,
  /** 150~199% — 떡상 1단계 */
  SURGE_1 = 4,
  /** 200~299% — 떡상 2단계 */
  SURGE_2 = 5,
  /** 300%+ — 초! 떡상 (상한가) */
  SUPER = 6,
}

/** 등급별 연출/능력치 보정값 */
export interface TierEffect {
  tier: StockTier;
  /** UI에 표시할 한국어 등급명 */
  label: string;
  /** 이 등급에 진입하는 최소 주가(%) */
  min: number;
  /** 공격력 배율 */
  atkMul: number;
  /** 이동속도 배율 */
  speedMul: number;
  /** 스킬 쿨다운 배율 (작을수록 빠름) */
  cooldownMul: number;
  /** 오라/게이지 색상 */
  color: number;
  /** 오라 표시 여부 */
  aura: boolean;
  /** 불꽃 강도 0=없음, 1=작은 불꽃, 2=활활, 3=폭발 */
  flame: 0 | 1 | 2 | 3;
}

/* ------------------------------------------------------------------ */
/* 캐릭터 패시브                                                       */
/* ------------------------------------------------------------------ */

export type PassiveType =
  /** 고정 흡수 배율 (빌 게이츠맨) */
  | 'absorb_flat'
  /** 확률 발동 흡수 (스티브 잡스맨) */
  | 'absorb_chance'
  /** 랜덤 흡수 (패니 와이즈맨) */
  | 'absorb_random'
  /** 주가가 임계값 이상일 때 공격력 증가 (일론 머스크맨) */
  | 'power_when_high'
  /** 주가가 임계값 이하일 때 공격력 증가 (리누스 토발즈맨) */
  | 'power_when_low';

export interface PassiveConfig {
  type: PassiveType;
  /** 패시브 이름 (UI 노출) */
  name: string;
  /** 패시브 설명 (UI 노출) */
  desc: string;

  /** absorb_flat / absorb_chance — 발동 시 흡수 배율 (1.5 = 데미지의 150%를 흡수) */
  absorbRatio?: number;
  /** absorb_chance — 발동 확률 (0~1) */
  chance?: number;
  /** absorb_random — 흡수 배율 최소/최대 */
  minRatio?: number;
  maxRatio?: number;

  /** power_when_* — 판정 기준 주가(%) */
  threshold?: number;
  /** power_when_* — 조건 충족 시 공격력 배율 */
  powerMul?: number;
}

/* ------------------------------------------------------------------ */
/* 공격 / 전투                                                         */
/* ------------------------------------------------------------------ */

export type AttackType = 'light' | 'heavy' | 'skill';

/** 공격 상태 머신 단계 */
export type AttackPhase = 'none' | 'startup' | 'active' | 'recovery';

/** 시그니처 스킬 특수 효과 */
export type SkillEffect =
  /** 추가 효과 없음 */
  | 'none'
  /** 장시간 경직 (블루스크린) */
  | 'stun'
  /** 지속 피해 (커널 패닉) */
  | 'dot'
  /** 주가 도박 (리츠고!) */
  | 'gamble';

/** 투사체 정의 — 근접 히트박스 대신 날아가는 탄을 만든다 */
export interface ProjectileConfig {
  /** 수평 이동 속도 (px/s) */
  speed: number;
  /** 최대 생존 시간 (ms) */
  lifespan: number;
  /** 캐릭터 스프라이트 시트에서 쓸 프레임. 없으면 원형 도형으로 그린다 */
  frame?: number;
  /** 화면에 표시할 크기 (px) */
  displayHeight: number;
  /** 발사 지점 높이 보정 (음수 = 위) */
  offsetY: number;
  /** 중력 영향 (0 = 직선) */
  gravity?: number;
  /** 적중 후에도 관통하는가 */
  pierce?: boolean;
}

/** 하나의 공격 동작을 정의하는 데이터 */
export interface AttackConfig {
  type: AttackType;
  /** 공격 이름 (UI/로그용) */
  name: string;
  /** 기본 피해량 = 피격자가 잃는 주가(%) */
  damage: number;

  /** 선딜 (ms) — 히트박스가 아직 없는 구간 */
  startup: number;
  /** 판정 지속 (ms) — 히트박스가 활성화된 구간 */
  active: number;
  /** 후딜 (ms) — 다시 행동 가능해지기까지 */
  recovery: number;

  /** 히트박스 가로 길이 (전방 사거리) */
  range: number;
  /** 히트박스 세로 높이 */
  hitHeight: number;

  /** 넉백 수평 성분 */
  knockbackX: number;
  /** 넉백 수직 성분 (음수 = 위로) */
  knockbackY: number;
  /** 피격자 경직 시간 (ms) */
  hitstun: number;

  /** 히트스탑 시간 (ms) */
  hitstop: number;
  /** 카메라 쉐이크 강도 (Phaser 기준, 0~1 뷰포트 비율) */
  shake: number;

  /** 스킬 전용 — 쿨다운 (ms) */
  cooldown?: number;
  /** 스킬 전용 — 특수 효과 */
  effect?: SkillEffect;
  /** 스킬 전용 — 효과 수치 (dot: 초당 피해량 등) */
  effectValue?: number;
  /** 스킬 전용 — 효과 지속시간 (ms) */
  effectDuration?: number;
  /** 스킬 전용 — 시전 시 자신이 튀어오르는 속도 (음수 = 위로) */
  selfLaunch?: number;
  /**
   * 스킬 전용 — 솟구친 뒤 내리꽂는 낙하 공격.
   * 착지 순간 지면에 광역 충격파가 생긴다. (로켓 드롭)
   */
  divePlunge?: {
    /** 하강 속도 */
    speed: number;
    /** 착지 충격파 가로 범위 */
    shockRange: number;
    /** 충격파 피해 */
    shockDamage: number;
  };
  /** 있으면 근접 히트박스 대신 투사체를 발사한다 */
  projectile?: ProjectileConfig;
}

/* ------------------------------------------------------------------ */
/* 명대사                                                              */
/* ------------------------------------------------------------------ */

/** 상황별 명대사 모음 */
export interface QuoteSet {
  /** 게임 시작 */
  intro: string[];
  /** 스킬 발동 */
  skill: string[];
  /** 상대 KO */
  ko: string[];
  /** 떡상 모드 진입 */
  surge: string[];
  /** 역전 상황 (위기에서 반격) */
  comeback: string[];
  /** 피격 */
  hurt: string[];
}

export type QuoteMood = keyof QuoteSet;

/* ------------------------------------------------------------------ */
/* 캐릭터 외형 (코드로 그리는 SD 아트)                                 */
/* ------------------------------------------------------------------ */

export interface ArtConfig {
  /** 머리 모양 */
  hair: 'side-part' | 'short' | 'swept' | 'messy' | 'none';
  hairColor: number;
  /** 안경 */
  glasses: 'round' | 'rect' | 'none';
  glassesColor: number;
  /** 수염 유무 */
  beard: boolean;
  beardColor: number;
  /** 입 모양 */
  mouth: 'smile' | 'smirk' | 'flat' | 'wide';
  /** 눈 스타일 — bulge는 흰자가 보이는 개구리 눈 */
  eyes: 'dot' | 'bulge';
}

/* ------------------------------------------------------------------ */
/* 캐릭터 정의                                                         */
/* ------------------------------------------------------------------ */

export interface CharacterConfig {
  id: CharacterId;
  /** 게임 내 표기명 */
  name: string;
  /** 원본 인물/밈 */
  realName: string;
  /** 한 줄 소개 */
  tagline: string;

  colors: {
    /** 몸통 색 */
    body: number;
    /** 머리(대두) 색 */
    head: number;
    /** 포인트 색 — 오라, 히트 이펙트에 사용 */
    accent: number;
  };

  stats: {
    /** 지상 이동속도 (px/s) */
    speed: number;
    /** 1단 점프 속도 */
    jump: number;
    /** 2단 점프 속도 */
    doubleJump: number;
    /** 무게 — 클수록 넉백을 덜 받는다 */
    weight: number;
  };

  art: ArtConfig;
  passive: PassiveConfig;
  /**
   * 기본 공격도 캐릭터마다 다르다.
   * 속도형·리치형·한방형의 차이가 여기서 갈린다.
   */
  light: AttackConfig;
  heavy: AttackConfig;
  skill: AttackConfig;
  quotes: QuoteSet;
}

/* ------------------------------------------------------------------ */
/* AI                                                                  */
/* ------------------------------------------------------------------ */

/** AI 봇 유한상태기계(FSM) 상태 */
export type AIState = 'IDLE' | 'CHASE' | 'ATTACK' | 'EVADE' | 'SKILL';

/** AI 난이도 프리셋 */
export interface AIDifficulty {
  label: string;
  /** 판단 주기 (ms) — 짧을수록 똑똑함 */
  decisionInterval: number;
  /** 반응 지연 (ms) — 짧을수록 빠름 */
  reactionDelay: number;
  /** 회피 성공 확률 (0~1) */
  evadeChance: number;
  /** 강공격 선택 비율 (0~1) */
  heavyRatio: number;
  /** 공격 후 추가 대기 (ms) */
  attackCooldown: number;
}

/* ------------------------------------------------------------------ */
/* 씬 간 데이터 전달                                                   */
/* ------------------------------------------------------------------ */

export interface BattleSceneData {
  /** 플레이어가 고른 캐릭터 */
  playerId: CharacterId;
  /** AI 봇 캐릭터 목록 */
  aiIds: CharacterId[];
}

/* ------------------------------------------------------------------ */
/* 이벤트 페이로드                                                     */
/* ------------------------------------------------------------------ */

/** EventBus로 오가는 이벤트 목록과 각 페이로드 타입 */
export interface GameEventMap {
  /** 주가 변동 */
  'stock:changed': {
    fighterId: string;
    value: number;
    delta: number;
    tier: StockTier;
  };
  /** 떡상 등급 변경 */
  'stock:tier': {
    fighterId: string;
    tier: StockTier;
    prevTier: StockTier;
  };
  /** 타격 성공 */
  'combat:hit': {
    attackerId: string;
    targetId: string;
    damage: number;
    absorbed: number;
    attackType: AttackType;
    x: number;
    y: number;
  };
  /** 상장폐지 (KO) */
  'fighter:ko': {
    fighterId: string;
    name: string;
    killerId: string | null;
  };
  /** 스킬 사용 */
  'skill:used': {
    fighterId: string;
    skillName: string;
  };
  /** 전투 종료 */
  'battle:end': {
    winnerId: string | null;
    winnerName: string;
  };
  /** 명대사 출력 요청 */
  'quote:say': {
    fighterId: string;
    text: string;
    mood: QuoteMood;
  };
}

export type GameEventName = keyof GameEventMap;
