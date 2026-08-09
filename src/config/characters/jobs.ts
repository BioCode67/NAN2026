import { moveSet } from '../gameConfig';
import type { CharacterConfig } from '../../types';

/** 2. 스티브 잡스맨 — 현실 왜곡 */
export const jobs: CharacterConfig = {
  id: 'jobs',
  name: '스티브 잡스맨',
  realName: 'Steve Jobs',
  tagline: '한 방이면 충분하다',
  colors: { body: 0x1f2937, head: 0xf1c9a5, accent: 0xe5e7eb },
  stats: { speed: 265, jump: -720, doubleJump: -650, weight: 0.95 },

  /* 이동 기질 — 공중에서 관성이 오래 남아 미끄러지듯 흐른다 */
  move: 'drift',

  art: {
    hair: 'short',
    hairColor: 0x6b7280,
    glasses: 'round',
    glassesColor: 0x111827,
    prop: 'blade',
    propColor: 0xffffff,
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

  signature: {
    id: 'oneMoreThing',
    name: '원 모어 씽',
    desc: '스킬이 적중하면 1.6초 안에 L을 한 번 더 눌러 쿨다운 없이 다시 쓸 수 있다',
    how: '스킬을 맞히는 순간이 곧 다음 기회다. 맞혔으면 바로 L을 한 번 더',
    max: 0,
    icon: '💡',
    color: 0xe5e7eb,
  },

  /*
   * 한방형 — 발동이 빠르고 회복도 짧아 근접 압박에 강하다.
   * 기술은 전부 "키노트 / 앱스토어 / 가격 발표"에서 따왔다.
   */
  moves: moveSet({
    light: {
      name: '훅',
      damage: 11,
      startup: 62,
      recovery: 135,
      range: 60,
    },

    // 연속기 — 발표하듯 몰아치다 마지막에 한 장 더 꺼낸다
    light2: { name: '스트레이트', damage: 11, startup: 96, recovery: 140, range: 64 },
    light3: { name: '슬라이드 넘기기', damage: 17, startup: 122, cry: '다음 슬라이드.' },

    lightUp: {
      name: '원 모어 씽',
      // 검지를 치켜드는 그 동작. 짧지만 확실하게 띄운다
      damage: 10,
      startup: 78,
      recovery: 170,
      range: 66,
      hitHeight: 108,
      knockbackY: -570,
    },

    lightDown: {
      name: '씬 앤 라이트',
      // 서류봉투에 들어갈 만큼 얇게 베어낸다
      damage: 9,
      startup: 70,
      recovery: 180,
      range: 96,
    },

    heavy: {
      name: '현실 왜곡 강타',
      damage: 22,
      startup: 200,
      recovery: 300,
      range: 78,
    },
    // 대시 중 J/K — 가장 빠르게 파고든다
    dashAttack: { name: '기습 발표', damage: 15, startup: 92, lunge: 680 },

    heavy2: {
      name: '단종 선언',
      damage: 26,
      startup: 150,
      range: 86,
      knockbackX: 880,
      cry: '이 제품은 오늘부로 단종입니다.',
    },

    heavyUp: {
      name: '키노트 어퍼',
      // 무대 조명이 아래에서 위로 솟구친다
      damage: 18,
      startup: 138,
      recovery: 350,
      range: 74,
      hitHeight: 128,
      selfLaunch: -600,
      cry: 'One more thing!',
    },

    heavyDown: {
      name: '심사 반려',
      // 앱스토어 반려 도장을 내려찍는다 — 좁지만 발동이 빠르다
      damage: 19,
      startup: 195,
      range: 138,
      cry: '반려합니다.',
    },

    airLight: { name: '멀티터치', damage: 10, startup: 52, range: 70 },

    airHeavy: {
      name: '레티나 슬래시',
      damage: 17,
      startup: 125,
      range: 112,
    },

    airDive: {
      name: '가격 인하',
      // 발표하듯 급강하해 상대를 바닥에 처박는다
      damage: 20,
      startup: 100,
      cry: '이제 399달러입니다.',
    },

    /*
     * 앞·뒤 커맨드 — 상대 쪽으로 누르며 치면 파고들고, 반대로 누르면 빠지며 친다.
     * 대시 중 K 는 미끄러지고, 공중에서는 위·뒤로도 낼 수 있다.
     */
    lightFwd: { name: '한 발 더' },
    lightBack: { name: '프로토타입 회수' },
    heavyFwd: { name: '유니바디 압착' },
    heavyBack: { name: '리콜 통보' },
    dashSlide: { name: '미끄러지는 인터페이스' },
    airUp: { name: '공중 부양 발표' },
    airBack: { name: '이어폰 잭 제거' },

    skill: {
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
  }),

  quotes: {
    intro: ['Think different.'],
    skill: ['One more thing!'],
    ko: ["You're fired."],
    surge: ['Reality distortion!'],
    comeback: ["Here's the iPhone."],
    hurt: ['이건… 내 디자인이 아니야.'],
  },
};
