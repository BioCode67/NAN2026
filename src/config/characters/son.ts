import { moveSet } from '../gameConfig';
import type { CharacterConfig } from '../../types';

/** 12. 손정의장 — 300년 뒤를 본다면서 3분 만에 지른다 */
export const son: CharacterConfig = {
  id: 'son',
  name: '손정의장',
  realName: 'Masayoshi Son',
  tagline: '300년 앞을 봅니다. 그러니까 지금 지릅니다',
  colors: { body: 0x3f3f46, head: 0xf5d9bd, accent: 0xf59e0b },
  stats: { speed: 270, jump: -730, doubleJump: -650, weight: 0.95 },

  art: {
    hair: 'none',
    hairColor: 0x000000,
    glasses: 'rect',
    glassesColor: 0x111827,
    prop: 'box',
    propColor: 0xf59e0b,
    beard: false,
    beardColor: 0x000000,
    mouth: 'smile',
    eyes: 'bulge',
  },

  passive: {
    type: 'absorb_random',
    name: '비전 펀드',
    desc: '타격에 성공할 때마다 피해량의 50~350%를 랜덤하게 흡수한다. 대박 아니면 쪽박',
    minRatio: 0.5,
    maxRatio: 3.5,
  },

  signature: {
    id: 'balloon',
    name: '기업가치',
    desc: '타격마다 밸류에이션이 1 오른다(최대 3). 하나당 공중 점프가 한 번 늘어난다',
    how: '때려서 몸값을 올린다. **한 대 맞으면 전부 증발한다**',
    max: 3,
    icon: '📈',
    color: 0xf59e0b,
  },

  /*
   * 도박형 2호 — 패니가 "빠르고 센 대신 리치가 짧다"면 이쪽은 "수치가 널뛴다".
   * 흡수 편차가 가장 크고 스킬이 자기 주가까지 걸므로, 판이 순식간에 뒤집힌다.
   */
  moves: moveSet({
    light: { name: '엔젤 투자', damage: 9, startup: 62 },
    light2: { name: '시리즈 A', damage: 10, startup: 98 },
    light3: {
      name: '기업 공개',
      damage: 17,
      startup: 124,
      knockbackY: -680,
      cry: '상장이다!',
    },

    heavy: { name: '비전 펀드', damage: 25, startup: 205, range: 88 },
    heavy2: {
      name: '올인 베팅',
      damage: 32,
      startup: 190,
      recovery: 420,
      knockbackX: 960,
      hitstop: 150,
      cry: '전 재산 걸었다!',
    },

    dashAttack: { name: '유니콘 사냥', damage: 17, startup: 86, lunge: 780 },

    lightUp: {
      name: '기업가치 뻥튀기',
      damage: 9,
      startup: 74,
      hitHeight: 128,
      knockbackY: -640,
    },
    lightDown: { name: '손절매', damage: 9, startup: 72, range: 100 },

    heavyUp: { name: '300년 계획', damage: 21, startup: 140, selfLaunch: -720 },
    heavyDown: {
      name: '위워크',
      // 크게 벌렸다가 크게 무너진다 — 후딜이 로스터 최장
      damage: 27,
      startup: 210,
      recovery: 480,
      range: 158,
      cry: '이건… 좀 아니었나.',
    },

    airLight: { name: '공중 투자', damage: 9, startup: 50 },
    airHeavy: { name: '지분 매각', damage: 19, startup: 118 },
    airDive: { name: '전액 손실', damage: 24, startup: 84, cry: '다 태웠다!' },

    skill: {
      name: '한 방에 간다',
      damage: 26,
      startup: 240,
      recovery: 400,
      range: 126,
      knockbackX: 620,
      knockbackY: -480,
      hitstun: 500,
      hitstop: 135,
      shake: 0.02,
      cooldown: 12500,
      // 자기 주가를 걸고 던진다 — 이 캐릭터의 정체성
      effect: 'gamble',
      effectValue: 60,
    },
  }),

  quotes: {
    intro: ['300년 앞을 봅니다.'],
    skill: ['한 방에 간다!'],
    ko: ['상장폐지도 하나의 경험이지.'],
    surge: ['이번엔 제대로 골랐어!'],
    comeback: ['한 종목만 터지면 돼.'],
    hurt: ['평가손일 뿐이야…'],
  },
};
