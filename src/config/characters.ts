import { melee } from './gameConfig';
import type { CharacterConfig, CharacterId } from '../types';

/**
 * 캐릭터 5종 데이터.
 *
 * 캐릭터 고유 동작은 전부 이 데이터로 표현되며,
 * BaseCharacter가 이를 읽어 그대로 구동한다.
 * (고유 모션이 필요해지면 그때 BillGates.ts 등으로 분리한다)
 */
export const CHARACTERS: Record<CharacterId, CharacterConfig> = {
  /* ---------------------------------------------------------------- */
  /* 1. 빌 게이츠맨 — 독점 흡수                                        */
  /* ---------------------------------------------------------------- */
  gates: {
    id: 'gates',
    name: '빌 게이츠맨',
    realName: 'Bill Gates',
    tagline: '독점은 죄가 아니다, 전략이다',
    colors: { body: 0x2f6fd0, head: 0xf1c9a5, accent: 0x7dd3fc },
    stats: { speed: 245, jump: -690, doubleJump: -620, weight: 1.05 },

    art: {
      hair: 'side-part',
      hairColor: 0x8b6b4a,
      glasses: 'round',
      glassesColor: 0xd4a843,
      beard: false,
      beardColor: 0x000000,
      mouth: 'smile',
      eyes: 'dot',
    },

    passive: {
      type: 'absorb_flat',
      name: '독점 흡수',
      desc: '타격에 성공할 때마다 피해량의 150%를 주가로 흡수한다. (기본 10% → 15%)',
      absorbRatio: 1.5,
    },

    // 견제형 — 리치가 길고 묵직하지만 발동이 느리다
    light: melee('light', { name: '잽', damage: 9, startup: 78, range: 64 }),
    heavy: melee('heavy', {
      name: '독점 킥',
      damage: 19,
      startup: 195,
      range: 94,
      knockbackX: 600,
      knockbackY: -400,
    }),

    skill: {
      type: 'skill',
      name: '블루스크린',
      damage: 20,
      startup: 260,
      active: 140,
      recovery: 420,
      // 투사체를 쓰므로 근접 히트박스는 없다
      range: 0,
      hitHeight: 0,
      knockbackX: 300,
      knockbackY: -200,
      hitstun: 1200,
      hitstop: 110,
      shake: 0.014,
      cooldown: 9000,
      effect: 'stun',
      effectDuration: 1200,
      projectile: {
        speed: 620,
        lifespan: 1800,
        // 시트 8번 = 캐릭터 없이 에너지볼만 있는 프레임
        frame: 8,
        displayHeight: 58,
        offsetY: -12,
      },
    },

    quotes: {
      intro: ["Let's upgrade!"],
      skill: ['Blue Screen!'],
      ko: ['Your stock is worthless!'],
      surge: ['Monopoly mode!'],
      comeback: ["I'll buy your company!"],
      hurt: ['치명적 오류 발생…'],
    },
  },

  /* ---------------------------------------------------------------- */
  /* 2. 스티브 잡스맨 — 현실 왜곡                                      */
  /* ---------------------------------------------------------------- */
  jobs: {
    id: 'jobs',
    name: '스티브 잡스맨',
    realName: 'Steve Jobs',
    tagline: '한 방이면 충분하다',
    colors: { body: 0x1f2937, head: 0xf1c9a5, accent: 0xe5e7eb },
    stats: { speed: 265, jump: -720, doubleJump: -650, weight: 0.95 },

    art: {
      hair: 'short',
      hairColor: 0x6b7280,
      glasses: 'round',
      glassesColor: 0x111827,
      beard: true,
      beardColor: 0x9ca3af,
      mouth: 'smirk',
      eyes: 'dot',
    },

    passive: {
      type: 'absorb_chance',
      name: '현실 왜곡',
      desc: '30% 확률로 피해량의 200%를 주가로 흡수한다. (기본 10% → 20%)',
      chance: 0.3,
      absorbRatio: 2.0,
    },

    // 한방형 — 발동이 빠르고 회복도 짧아 근접 압박에 강하다
    light: melee('light', {
      name: '훅',
      damage: 11,
      startup: 62,
      recovery: 135,
      range: 60,
    }),
    heavy: melee('heavy', {
      name: '현실 왜곡 강타',
      damage: 22,
      startup: 200,
      recovery: 300,
      range: 78,
      knockbackX: 640,
      knockbackY: -430,
    }),

    skill: {
      type: 'skill',
      name: '스포트라이트 펀치',
      damage: 34,
      startup: 280,
      active: 110,
      recovery: 380,
      range: 96,
      hitHeight: 86,
      knockbackX: 780,
      knockbackY: -440,
      hitstun: 520,
      hitstop: 150,
      shake: 0.02,
      cooldown: 8000,
      effect: 'none',
    },

    quotes: {
      intro: ['Think different.'],
      skill: ['One more thing!'],
      ko: ["You're fired."],
      surge: ['Reality distortion!'],
      comeback: ["Here's the iPhone."],
      hurt: ['이건… 내 디자인이 아니야.'],
    },
  },

  /* ---------------------------------------------------------------- */
  /* 3. 일론 머스크맨 — 변동성 폭발                                    */
  /* ---------------------------------------------------------------- */
  musk: {
    id: 'musk',
    name: '일론 머스크맨',
    realName: 'Elon Musk',
    tagline: '떡상하면 아무도 못 막는다',
    colors: { body: 0xdc2626, head: 0xf1c9a5, accent: 0xfbbf24 },
    stats: { speed: 285, jump: -760, doubleJump: -690, weight: 0.9 },

    art: {
      hair: 'swept',
      hairColor: 0x3f2d20,
      glasses: 'none',
      glassesColor: 0x000000,
      beard: false,
      beardColor: 0x000000,
      mouth: 'smirk',
      eyes: 'dot',
    },

    passive: {
      type: 'power_when_high',
      name: '변동성 폭발',
      desc: '주가가 200% 이상일 때 공격력이 2배가 된다.',
      threshold: 200,
      powerMul: 2.0,
    },

    // 속도형 — 약공격이 압도적으로 빨라 연타가 들어간다. 대신 한 방이 약하다
    light: melee('light', {
      name: '연타',
      damage: 7,
      startup: 48,
      active: 70,
      recovery: 95,
      range: 56,
      knockbackX: 200,
      hitstun: 150,
      hitstop: 55,
    }),
    heavy: melee('heavy', {
      name: '부스터 차지',
      damage: 20,
      startup: 165,
      recovery: 300,
      range: 86,
      knockbackX: 560,
      knockbackY: -360,
    }),

    skill: {
      type: 'skill',
      name: '로켓 드롭',
      damage: 28,
      startup: 260,
      active: 260,
      recovery: 460,
      range: 200,
      hitHeight: 160,
      knockbackX: 440,
      knockbackY: -780,
      hitstun: 520,
      hitstop: 140,
      shake: 0.022,
      cooldown: 11000,
      effect: 'none',
      // 로켓처럼 솟구쳤다가 내리꽂고, 착지 지점에 충격파가 퍼진다
      selfLaunch: -760,
      divePlunge: {
        speed: 1500,
        shockRange: 420,
        shockDamage: 22,
      },
    },

    quotes: {
      intro: ['To Mars!'],
      skill: ['Rocket launch!'],
      ko: ['Recycled.'],
      surge: ['Dogecoin to the moon!'],
      comeback: ["I'm buying Twitter."],
      hurt: ['재진입 실패…'],
    },
  },

  /* ---------------------------------------------------------------- */
  /* 4. 리누스 토발즈맨 — 오픈소스                                     */
  /* ---------------------------------------------------------------- */
  linus: {
    id: 'linus',
    name: '리누스 토발즈맨',
    realName: 'Linus Torvalds',
    tagline: '궁지에 몰릴수록 강해진다',
    colors: { body: 0x334155, head: 0xf1c9a5, accent: 0x38bdf8 },
    stats: { speed: 250, jump: -700, doubleJump: -630, weight: 1.0 },

    art: {
      hair: 'messy',
      hairColor: 0x7c6244,
      glasses: 'rect',
      glassesColor: 0x1f2937,
      beard: true,
      beardColor: 0x8a7050,
      mouth: 'flat',
      eyes: 'dot',
    },

    passive: {
      type: 'power_when_low',
      name: '오픈소스',
      desc: '주가가 50% 이하일 때 공격력이 1.5배가 된다.',
      threshold: 50,
      powerMul: 1.5,
    },

    // 리치형 — 가장 멀리 닿지만 가장 느리다. 거리 유지 싸움에 강하다
    light: melee('light', {
      name: '롱 잽',
      damage: 9,
      startup: 90,
      active: 100,
      recovery: 170,
      range: 84,
    }),
    heavy: melee('heavy', {
      name: '커밋 해머',
      damage: 21,
      startup: 215,
      recovery: 350,
      range: 102,
      knockbackX: 600,
      knockbackY: -410,
      hitstop: 135,
    }),

    skill: {
      type: 'skill',
      name: '커널 패닉',
      damage: 12,
      startup: 200,
      active: 180,
      recovery: 380,
      range: 140,
      hitHeight: 118,
      knockbackX: 220,
      knockbackY: -180,
      hitstun: 300,
      hitstop: 100,
      shake: 0.012,
      cooldown: 10000,
      effect: 'dot',
      // 5초 동안 1초당 4% 지속 피해
      effectValue: 4,
      effectDuration: 5000,
    },

    quotes: {
      intro: ['Talk is cheap. Show me the code.'],
      skill: ['Kernel panic!'],
      ko: ['Segmentation fault.'],
      surge: ['Open source, baby!'],
      comeback: ['포크해서 다시 만들면 되지.'],
      hurt: ['이건 내 커널이 아니야.'],
    },
  },

  /* ---------------------------------------------------------------- */
  /* 5. 패니 와이즈맨 — 밈 파워                                        */
  /* ---------------------------------------------------------------- */
  pepe: {
    id: 'pepe',
    name: '패니 와이즈맨',
    realName: 'Pennywise',
    tagline: '전부 다 걸었다. 너도 걸어라',
    colors: { body: 0xd8d2e8, head: 0xf5f0f5, accent: 0xef4444 },
    stats: { speed: 300, jump: -780, doubleJump: -710, weight: 0.85 },

    art: {
      // 붉게 솟구친 광대 머리 + 귀까지 찢어진 입 + 부릅뜬 눈
      hair: 'messy',
      hairColor: 0xdc2626,
      glasses: 'none',
      glassesColor: 0x000000,
      beard: false,
      beardColor: 0x000000,
      mouth: 'wide',
      eyes: 'bulge',
    },

    passive: {
      type: 'absorb_random',
      name: '밈 파워',
      desc: '타격에 성공할 때마다 피해량의 100~300%를 랜덤하게 흡수한다. (10~30%)',
      minRatio: 1.0,
      maxRatio: 3.0,
    },

    // 도박형 — 가장 빠른 약공격 + 가장 센 강공격. 대신 리치가 짧아 파고들어야 한다
    light: melee('light', {
      name: '개굴 펀치',
      damage: 6,
      startup: 45,
      active: 65,
      recovery: 90,
      range: 54,
      knockbackX: 190,
      hitstun: 140,
      hitstop: 50,
    }),
    heavy: melee('heavy', {
      name: '올인 스윙',
      damage: 25,
      startup: 210,
      recovery: 360,
      range: 80,
      knockbackX: 700,
      knockbackY: -470,
      hitstop: 140,
    }),

    skill: {
      type: 'skill',
      name: '리츠고!',
      damage: 24,
      startup: 240,
      active: 150,
      recovery: 400,
      range: 124,
      hitHeight: 104,
      knockbackX: 580,
      knockbackY: -500,
      hitstun: 480,
      hitstop: 130,
      shake: 0.018,
      cooldown: 12000,
      // 시전 시 50% 확률로 자기 주가 +50% / -30%
      effect: 'gamble',
      effectValue: 50,
    },

    quotes: {
      intro: ['우리 같이 떠내려가자.'],
      skill: ['리츠고!'],
      ko: ['너도 상장폐지될 거야.'],
      surge: ['풍선 하나 줄까?'],
      comeback: ['여기선 다들 떠내려가.'],
      hurt: ['아직 안 끝났어…'],
    },
  },
};

/** 선택 화면 등에서 쓰는 고정 순서 */
export const CHARACTER_ORDER: CharacterId[] = [
  'gates',
  'jobs',
  'musk',
  'linus',
  'pepe',
];

/** ID로 캐릭터 설정을 가져온다. */
export function getCharacter(id: CharacterId): CharacterConfig {
  return CHARACTERS[id];
}
