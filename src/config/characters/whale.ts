import { moveSet } from '../gameConfig';
import type { CharacterConfig } from '../../types';

/** 20. 큰손 고래 — 한 번 움직이면 시장이 흔들린다 */
export const whale: CharacterConfig = {
  id: 'whale',
  name: '큰손 고래',
  realName: '기관 큰손',
  tagline: '내가 사면 오르고, 내가 팔면 내린다',
  colors: { body: 0x1d4ed8, head: 0x93c5fd, accent: 0x38bdf8 },
  // 로스터 최중량 · 최저 점프. 대신 한 방이 가장 무겁다
  stats: { speed: 200, jump: -650, doubleJump: -520, weight: 1.45 },

  /* 이동 기질 — 무겁게 떨어지고 착지 순간 발밑에 충격이 퍼진다 */
  move: 'plunge',

  art: {
    hair: 'none',
    hairColor: 0x000000,
    headgear: 'blowhole',
    headgearColor: 0xbae6fd,
    glasses: 'none',
    glassesColor: 0x000000,
    beard: false,
    beardColor: 0x000000,
    mouth: 'wide',
    eyes: 'bulge',
  },

  passive: {
    type: 'absorb_random',
    name: '대량 체결',
    desc: '타격에 성공할 때마다 피해량의 80~200%를 랜덤하게 흡수한다',
    minRatio: 0.8,
    maxRatio: 2.0,
  },

  signature: {
    id: 'balloon',
    name: '부력',
    desc: '타격마다 부력이 1 오른다(최대 3). 하나당 공중 점프가 한 번 늘어난다',
    how: '무거운 몸을 때려서 띄운다. **맞으면 다시 가라앉는다**',
    max: 3,
    icon: '🐋',
    color: 0x38bdf8,
  },

  /*
   * 최중량 광역형 — 느리고 안 뜨지만, 지상 광역기의 범위가 로스터 최대다.
   * 붙은 상대를 통째로 쓸어내는 대신, 도망친 상대는 절대 못 잡는다.
   * 부력을 쌓아야만 겨우 공중에 닿는다 — 그 관리가 이 캐릭터의 게임이다.
   */
  moves: moveSet({
    light: { name: '지느러미 툭', damage: 11, startup: 92, range: 84 },
    light2: { name: '꼬리 치기', damage: 12, startup: 126, range: 90 },
    light3: {
      name: '물기둥',
      damage: 21,
      startup: 160,
      range: 104,
      knockbackY: -720,
      hitstop: 165,
      cry: '솟아라!',
    },

    heavy: { name: '몸통 박치기', damage: 27, startup: 245, recovery: 410, range: 100 },
    heavy2: {
      name: '대량 매집',
      damage: 34,
      startup: 210,
      recovery: 450,
      range: 108,
      knockbackX: 1020,
      hitstop: 175,
      shake: 0.03,
      cry: '전부 내가 산다.',
    },

    dashAttack: { name: '해일', damage: 19, startup: 115, lunge: 600, range: 90 },

    lightUp: { name: '물보라', damage: 11, startup: 106, hitHeight: 120 },
    lightDown: {
      name: '바닥 훑기',
      damage: 11,
      startup: 90,
      range: 118,
      hitstun: 300,
    },

    heavyUp: {
      name: '수면 위로',
      // 무거운 만큼 잘 못 뜬다 — 상승기가 로스터에서 가장 낮다
      damage: 24,
      startup: 165,
      selfLaunch: -560,
    },
    heavyDown: {
      name: '심해 잠수',
      // 로스터 최대 범위 광역기
      damage: 29,
      startup: 255,
      range: 168,
      hitstop: 170,
      shake: 0.032,
      cry: '가라앉아라.',
    },

    airLight: { name: '공중 유영', damage: 11, startup: 68 },
    airHeavy: { name: '꼬리 회전', damage: 21, startup: 142, range: 118 },
    airDive: {
      name: '고래 낙하',
      damage: 28,
      startup: 100,
      cry: '비켜.',
    },

    /*
     * 앞·뒤 커맨드 — 상대 쪽으로 누르며 치면 파고들고, 반대로 누르면 빠지며 친다.
     * 대시 중 K 는 미끄러지고, 공중에서는 위·뒤로도 낼 수 있다.
     */
    lightFwd: { name: '지느러미 밀기' },
    lightBack: { name: '잠수 후퇴' },
    heavyFwd: { name: '고래 돌진' },
    heavyBack: { name: '물살 가르기' },
    dashSlide: { name: '수면 활주' },
    airUp: { name: '분수 뿜기' },
    airBack: { name: '등지느러미 강타' },

    skill: {
      name: '고래가 움직인다',
      damage: 31,
      startup: 285,
      recovery: 450,
      range: 150,
      hitHeight: 122,
      knockbackX: 720,
      knockbackY: -420,
      hitstun: 600,
      hitstop: 165,
      shake: 0.03,
      cooldown: 14000,
    },
  }),

  quotes: {
    intro: ['시장이 좀 조용하군.'],
    skill: ['고래가 움직인다.'],
    ko: ['체결 완료.'],
    surge: ['물량이 다 내 거야.'],
    comeback: ['바닥에서 다 주웠다.'],
    hurt: ['건방진…'],
  },
};
