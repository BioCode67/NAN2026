/**
 * 게임 전역 타입 정의
 * 모든 시스템이 공유하는 형태는 여기에만 선언한다.
 */

/** 캐릭터 고유 ID */
export type CharacterId =
  | 'gates'
  | 'jobs'
  | 'musk'
  | 'linus'
  | 'pepe'
  | 'buffett'
  | 'jensen'
  | 'satoshi'
  | 'zuck'
  | 'bezos'
  | 'altman'
  | 'son'
  | 'ant'
  | 'bear'
  | 'bull'
  | 'guru'
  | 'bot'
  | 'chairman'
  | 'doom'
  | 'whale';

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
/* 캐릭터 고유 메커니즘                                                */
/* ------------------------------------------------------------------ */

/**
 * 캐릭터마다 하나씩 가지는 **고유 조작 규칙**.
 *
 * 패시브(주가 흡수율 등)는 수치만 다를 뿐 조작이 같다. 그것만으로는
 * "이름과 숫자만 다른 같은 캐릭터"가 된다. 여기 있는 것들은 각자
 * **버튼을 누르는 방식 자체가 다르다** — 그래야 한 캐릭터를 파고들 이유가 생긴다.
 */
export type SignatureId =
  /** 빌 게이츠맨 — 때릴수록 지분이 쌓이고, 스킬이 쌓인 만큼 강해진다 */
  | 'shares'
  /** 스티브 잡스맨 — 스킬이 맞으면 짧은 순간 한 번 더 공짜로 쓸 수 있다 */
  | 'oneMoreThing'
  /** 일론 머스크맨 — 대시가 부스터를 쓴다. 남아 있으면 공중에서도 대시한다 */
  | 'booster'
  /** 리누스 토발즈맨 — 방어로 막은 기술을 훔쳐, 다음 스킬로 되돌려준다 */
  | 'fork'
  /** 패니 와이즈맨 — 때릴수록 풍선이 쌓여 더 뜬다. 맞으면 전부 터진다 */
  | 'balloon';

export interface SignatureConfig {
  id: SignatureId;
  /** UI 표기명 */
  name: string;
  /** 무엇을 하는지 한 줄 */
  desc: string;
  /** 어떻게 쓰는지 — 조작 안내 */
  how: string;
  /** HUD 게이지 칸 수 (0이면 게이지를 그리지 않는다) */
  max: number;
  /** 게이지 옆 아이콘 */
  icon: string;
  /** 게이지 색 */
  color: number;
}

/* ------------------------------------------------------------------ */
/* 공격 / 전투                                                         */
/* ------------------------------------------------------------------ */

export type AttackType = 'light' | 'heavy' | 'skill';

/** 공격 상태 머신 단계 */
export type AttackPhase = 'none' | 'startup' | 'active' | 'recovery';

/**
 * 공격 입력 방향.
 *
 * 같은 J/K라도 W(위)·S(아래)를 함께 누르면 다른 기술이 나간다.
 * 캐릭터 한 명이 J·K·L 세 동작만 갖는 단조로움을 없애는 축이다.
 */
export type AttackDir = 'neutral' | 'up' | 'down';

/**
 * 커맨드 무브 슬롯 — 캐릭터 한 명이 가지는 기술 목록.
 *
 * 지상 6종(J/K × 중립·위·아래) + 공중 3종 + 시그니처 스킬.
 * 슬롯 이름이 곧 입력 커맨드이므로, 새 캐릭터를 만들 때
 * 이 열 칸만 채우면 기술 세트가 완성된다.
 */
export type MoveSlot =
  /** J */
  | 'light'
  /** J 연타 2타 */
  | 'light2'
  /** J 연타 3타 — 마무리. 크게 띄운다 */
  | 'light3'
  /** K 2타 — 마무리. 멀리 날린다 */
  | 'heavy2'
  /** 대시 중 J/K — 달리던 기세를 실어 부딪친다 */
  | 'dashAttack'
  /** W + J */
  | 'lightUp'
  /** S + J */
  | 'lightDown'
  /** K */
  | 'heavy'
  /** W + K — 솟구치며 띄우는 상승기 */
  | 'heavyUp'
  /** S + K — 지면을 내려찍는 광역기 */
  | 'heavyDown'
  /** 공중 J */
  | 'airLight'
  /** 공중 K */
  | 'airHeavy'
  /** 공중 S + J/K — 내리꽂는 급강하 */
  | 'airDive'
  /** L */
  | 'skill';

/**
 * 히트박스를 몸 기준 어디에 놓을지.
 *
 * 상단기·하단기가 같은 자리에 판정을 내면 커맨드를 나눈 의미가 없다.
 */
export type HitAnchor =
  /** 전방 (기본) */
  | 'front'
  /** 머리 위 */
  | 'up'
  /** 발밑 전방 */
  | 'down'
  /** 몸 주변 전체 (광역) */
  | 'around';

/** 스윙 이펙트 모양 — 기술마다 다르게 보이도록 */
export type SwingFx =
  /** 찌르기 — 앞으로 뻗는 가는 선 */
  | 'thrust'
  /** 베기 — 호를 그리는 잔상 */
  | 'slash'
  /** 쳐올림 — 위로 솟는 기둥 */
  | 'rising'
  /** 내려찍기 — 지면을 따라 퍼지는 충격 */
  | 'slam'
  /** 회전 — 몸 주위를 도는 링 */
  | 'spin';

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
  /** 어느 커맨드로 나가는 기술인가 */
  slot: MoveSlot;
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
  /** 히트박스를 몸 기준 어디에 놓을지 (기본 front) */
  hitAnchor?: HitAnchor;
  /** 스윙 이펙트 모양 (기본 slash) */
  fx?: SwingFx;
  /** 판정이 켜지는 순간 앞으로 치고 나가는 속도 (돌진기) */
  lunge?: number;
  /** 발동 시 외치는 대사 — 캐릭터성을 드러내는 짧은 한마디 */
  cry?: string;

  /**
   * 같은 버튼을 다시 누르면 이어지는 다음 타.
   *
   * 한 방씩 툭툭 치는 대신 몰아치게 만드는 축이다.
   * 마무리 타에는 이 값이 없다.
   */
  chain?: MoveSlot;
  /** 연속기 중 몇 번째 타인가 (1부터). 없으면 단발기 */
  chainStep?: number;
  /**
   * 연속기의 마지막 타인가.
   * 히트스탑·화면 섬광·카메라 충격이 크게 붙는다.
   */
  finisher?: boolean;

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
  /** 시전 시 자신이 튀어오르는 속도 (음수 = 위로). 상승기·로켓 드롭이 쓴다 */
  selfLaunch?: number;
  /**
   * 내리꽂는 낙하 공격.
   * 착지 순간 지면에 광역 충격파가 생긴다.
   *
   * selfLaunch가 함께 있으면 "솟구쳤다가 정점에서 하강"(로켓 드롭),
   * 없으면 즉시 하강한다(공중 급강하).
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

/**
 * 머리 위에 얹는 것.
 *
 * ── 왜 필요한가 ────────────────────────────────────────────────────
 * 다섯 명일 때는 머리 모양·안경·수염 조합만으로 서로 구별됐다. 스무 명이
 * 되자 그 조합이 동나서, 시트가 없는 캐릭터들이 전부 "색만 다른 동그란 머리"가
 * 됐다. 게다가 새 로스터에는 사람이 아닌 것들(황소·곰·고래·로봇)이 있는데
 * 머리 모양만으로는 그게 짐승이라는 표시를 할 방법이 아예 없다.
 *
 * 실루엣은 색보다 훨씬 빨리 읽힌다. 머리 위 한 조각만 달라도
 * 작게 줄어든 선택 화면 카드에서조차 누가 누구인지 구분된다.
 */
export type Headgear =
  | 'none'
  /** 안전모 — 챙이 앞으로 나온 반구 */
  | 'helmet'
  /** 뿔 — 좌우로 뻗은 두 개 */
  | 'horns'
  /** 짐승 귀 — 머리 위 양쪽의 둥근 귀 */
  | 'ears'
  /** 후드 — 얼굴을 감싸는 그늘 */
  | 'hood'
  /** 왕관 */
  | 'crown'
  /** 안테나 — 끝에 구슬이 달린 막대 */
  | 'antenna'
  /** 상투 — 정수리에 묶은 머리 */
  | 'topknot'
  /** 분수공 — 물을 뿜는 고래 머리 */
  | 'blowhole'
  /** 챙 모자 */
  | 'cap';

/**
 * 앞손에 든 것.
 *
 * ── 왜 필요한가 ────────────────────────────────────────────────────
 * 머리 위(headgear)를 더해 카드에서는 구분이 됐는데, 전투 화면에서는 여전히
 * 비슷했다. 싸우는 동안 눈이 따라가는 것은 머리가 아니라 **움직이는 팔**이고,
 * 그 손이 전부 비어 있으면 스무 명이 같은 동작을 한다.
 *
 * 무기는 공격할 때 팔과 함께 뻗으므로, 상단기·하단기·광역기의 궤적 차이까지
 * 같이 드러난다 — 한 조각으로 "누구인가"와 "무엇을 하는가"가 동시에 읽힌다.
 */
export type HandProp =
  | 'none'
  /** 해머 — 자루 끝에 육중한 머리 */
  | 'hammer'
  /** 지팡이·골프채 — 긴 막대 */
  | 'stick'
  /** 판때기 — 그래픽카드·차트판 */
  | 'board'
  /** 곡괭이 */
  | 'pickaxe'
  /** 상자 */
  | 'box'
  /** 구슬 — 수정 구슬·에너지구 */
  | 'orb'
  /** 칼날 — 광선검·대검 */
  | 'blade'
  /** 휴대폰 */
  | 'phone'
  /** 서류 뭉치 */
  | 'doc'
  /** 총 */
  | 'gun'
  /** 발톱 — 세 갈래 */
  | 'claw';

export interface ArtConfig {
  /** 머리 모양 */
  hair: 'side-part' | 'short' | 'swept' | 'messy' | 'none';
  hairColor: number;
  /** 머리 위에 얹는 것. 적지 않으면 아무것도 얹지 않는다 */
  headgear?: Headgear;
  /** headgear 색. 적지 않으면 포인트 색(colors.accent)을 쓴다 */
  headgearColor?: number;
  /** 앞손에 든 것. 적지 않으면 빈손이다 */
  prop?: HandProp;
  /** prop 색. 적지 않으면 포인트 색(colors.accent)을 쓴다 */
  propColor?: number;
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
   * 이 캐릭터만의 조작 규칙.
   * 패시브가 "얼마나 강한가"라면, 이쪽은 "어떻게 다루는가"다.
   */
  signature: SignatureConfig;
  /**
   * 커맨드 무브 세트.
   *
   * 속도형·리치형·한방형의 차이뿐 아니라,
   * "그 인물이라면 이렇게 싸울 것"이라는 캐릭터성이 여기서 갈린다.
   */
  moves: Record<MoveSlot, AttackConfig>;
  quotes: QuoteSet;
}

/* ------------------------------------------------------------------ */
/* 프롬프트 기믹                                                        */
/* ------------------------------------------------------------------ */

/**
 * 프롬프트 기믹의 갈래.
 *
 * 프롬프트 오브를 깨면 플레이어가 문장을 입력하고, 그 문장이 아래 셋 중
 * 하나로 해석되어 판 자체를 바꾼다. "AI로 게임을 조종한다"가 이 게임의 축이다.
 */
export type GimmickKind =
  /** 아이템을 쏟아낸다 */
  | 'item'
  /** 맵의 물리·지형을 바꾼다 */
  | 'map'
  /** 승부 규칙 자체를 바꾼다 (리듬 배틀 등) */
  | 'rule';

/** 프롬프트가 해석되어 나오는 결과물 */
export interface GimmickSpec {
  id: string;
  kind: GimmickKind;
  /** 화면에 뜨는 이름 */
  name: string;
  /** 한 줄 설명 */
  desc: string;
  icon: string;
  color: number;
  /** 지속 시간(ms). 0이면 즉시 발동하고 끝난다 */
  duration: number;
  /**
   * 이 기믹을 부르는 말들.
   * 프롬프트에 이 중 하나가 들어 있으면 해당 기믹으로 해석된다.
   */
  keywords: string[];
}

/** 리듬 판정 결과 */
export interface RhythmJudge {
  label: string;
  /** 피해 배율 */
  mul: number;
  color: string;
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
  /**
   * 온라인에서 자리 순서대로의 사람 캐릭터 (0번이 호스트).
   * 있으면 이 목록이 playerId/player2Id 를 대신한다.
   */
  humanIds?: CharacterId[];
  /** 온라인에서 내 자리 번호 (0 = 호스트) */
  netSlot?: number;
  /**
   * 2P가 고른 캐릭터. 없으면 1인 플레이다.
   *
   * 한 키보드를 나눠 쓰는 로컬 2인 대전이다. 봇 성격을 아무리 갈라 놔도
   * 옆 사람이 뭘 할지 모르는 것과는 다르다 — 이 게임에서 제일 재미있는
   * 순간은 사람 둘이 붙었을 때 나온다.
   */
  player2Id?: CharacterId;
  /** AI 봇 캐릭터 목록 */
  aiIds: CharacterId[];
  /**
   * 무대를 지정한다. 적지 않으면 앞 판과 다른 곳으로 무작위 선정.
   * (검사가 네 무대를 하나씩 돌려 보는 데 쓴다)
   */
  stageId?: string;
  /**
   * 지금까지 몇 판을 이겼는가. 0이면 첫 판.
   * 봇의 판단 속도가 이 값에 따라 빨라진다.
   */
  streak?: number;
  /** 플레이어의 시작 주가 — 연승 도전은 앞 판의 주가를 이어받는다 */
  startStock?: number;
  /**
   * 온라인 1:1 결투에서 내 역할.
   *
   * 호스트가 판 전체를 계산하고 게스트는 자기 입력만 보낸다.
   * 없으면 평소대로 이 기계 안에서만 도는 판이다.
   */
  netRole?: 'host' | 'guest';
  /**
   * 1:1 결투인가 (봇·아이템·오브 없음).
   *
   * 온라인은 이 모드만 쓴다. 넷이 뒤엉키고 아이템이 떨어지고 오브가 도는 판을
   * 회선 너머로 맞추려면 동기화할 것이 열 배가 되는데, 3일 안에 그것을
   * 안정적으로 만들 수는 없다. 둘이 정면으로 붙는 것부터 확실히 되게 한다.
   */
  duel?: boolean;
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
    /** 이 타격을 낸 기술 이름 — 전적 집계에 쓴다 */
    moveName: string;
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
