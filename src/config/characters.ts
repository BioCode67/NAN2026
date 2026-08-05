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

    passive: {
      type: 'absorb_flat',
      name: '독점 흡수',
      desc: '타격에 성공할 때마다 피해량의 150%를 주가로 흡수한다. (기본 10% → 15%)',
      absorbRatio: 1.5,
    },

    skill: {
      type: 'skill',
      name: '블루스크린',
      damage: 16,
      startup: 220,
      active: 200,
      recovery: 420,
      range: 165,
      hitHeight: 130,
      knockbackX: 180,
      knockbackY: -120,
      hitstun: 1200,
      hitstop: 110,
      shake: 0.014,
      cooldown: 9000,
      effect: 'stun',
      effectDuration: 1200,
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

    passive: {
      type: 'absorb_chance',
      name: '현실 왜곡',
      desc: '30% 확률로 피해량의 200%를 주가로 흡수한다. (기본 10% → 20%)',
      chance: 0.3,
      absorbRatio: 2.0,
    },

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

    passive: {
      type: 'power_when_high',
      name: '변동성 폭발',
      desc: '주가가 200% 이상일 때 공격력이 2배가 된다.',
      threshold: 200,
      powerMul: 2.0,
    },

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
      // 시전과 동시에 로켓처럼 솟구친다
      selfLaunch: -520,
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

    passive: {
      type: 'power_when_low',
      name: '오픈소스',
      desc: '주가가 50% 이하일 때 공격력이 1.5배가 된다.',
      threshold: 50,
      powerMul: 1.5,
    },

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
    realName: 'Pepe the Frog',
    tagline: '전부 다 걸었다',
    colors: { body: 0x22c55e, head: 0x86efac, accent: 0xfde047 },
    stats: { speed: 300, jump: -780, doubleJump: -710, weight: 0.85 },

    passive: {
      type: 'absorb_random',
      name: '밈 파워',
      desc: '타격에 성공할 때마다 피해량의 100~300%를 랜덤하게 흡수한다. (10~30%)',
      minRatio: 1.0,
      maxRatio: 3.0,
    },

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
      intro: ['Feels good man.'],
      skill: ['LET’S GO!'],
      ko: ['Rekt.'],
      surge: ['To the moon!'],
      comeback: ['Diamond hands.'],
      hurt: ['Feels bad man.'],
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
