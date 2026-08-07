import { moveSet } from '../gameConfig';
import type { CharacterConfig } from '../../types';

/** 10. 제프 베조스 — 오늘 주문하면 오늘 도착한다 */
export const bezos: CharacterConfig = {
  id: 'bezos',
  name: '제프 베조스',
  realName: 'Jeff Bezos',
  tagline: '고객님, 문 앞에 두고 갑니다',
  colors: { body: 0x1f2937, head: 0xf0cfae, accent: 0xff9900 },
  stats: { speed: 245, jump: -700, doubleJump: -600, weight: 1.3 },

  art: {
    // 반들반들한 민머리 + 지나치게 커진 어깨
    hair: 'none',
    hairColor: 0x000000,
    // 민머리 + 짙은 선글라스 — 이 둘만으로 알아본다
    glasses: 'rect',
    glassesColor: 0x0b0f18,
    prop: 'box',
    propColor: 0xff9900,
    beard: false,
    beardColor: 0x000000,
    mouth: 'wide',
    eyes: 'dot',
  },

  passive: {
    type: 'absorb_flat',
    name: '물류 마진',
    desc: '타격에 성공할 때마다 피해량의 150%를 흡수한다. 한 건마다 남긴다',
    absorbRatio: 1.5,
  },

  signature: {
    id: 'booster',
    name: '블루 오리진',
    desc: '대시가 연료를 태운다(최대 3). 남아 있으면 공중에서도 대시할 수 있다',
    how: '무거운 몸을 연료로 옮긴다. **다 태우면 정말 안 움직인다**',
    max: 3,
    icon: '🚀',
    color: 0xff9900,
  },

  /*
   * 리치형 — 택배 상자를 던지고 휘두르므로 사거리가 로스터에서 가장 길다.
   * 대신 선딜이 길어 읽히면 그대로 맞는다.
   */
  moves: moveSet({
    light: { name: '당일 배송', damage: 10, startup: 72, range: 78 },
    light2: { name: '재배송', damage: 10, startup: 106, range: 82 },
    light3: {
      name: '문 앞 투척',
      damage: 16,
      startup: 132,
      range: 100,
      cry: '수령 확인 부탁드립니다.',
    },

    heavy: { name: '택배 상자 강타', damage: 24, startup: 215, range: 100 },
    heavy2: {
      name: '풀필먼트',
      damage: 29,
      startup: 185,
      range: 104,
      knockbackX: 940,
      cry: '전 창고를 동원했다.',
    },

    dashAttack: { name: '새벽 배송', damage: 17, startup: 92, lunge: 740 },

    lightUp: {
      name: '드론 배송',
      damage: 9,
      startup: 96,
      hitHeight: 132,
      knockbackY: -580,
    },
    lightDown: {
      name: '반품 처리',
      // 앞의 상대를 자기 쪽으로 끌어당기듯 낮게 쓸어 담는다
      damage: 9,
      startup: 80,
      range: 112,
      knockbackX: 120,
      hitstun: 310,
    },

    heavyUp: { name: '블루 오리진', damage: 22, startup: 150, selfLaunch: -760 },
    heavyDown: {
      name: '창고 적재',
      // 상자 더미가 통째로 무너진다
      damage: 26,
      startup: 225,
      range: 162,
      hitstop: 150,
      cry: '재고 정리다.',
    },

    airLight: { name: '공중 배송', damage: 9, startup: 56, range: 82 },
    airHeavy: { name: '무인기 강습', damage: 19, startup: 124, range: 116 },
    airDive: {
      name: '로켓 귀환',
      damage: 24,
      startup: 88,
      cry: '착륙합니다.',
    },

    skill: {
      name: '프라임 데이',
      damage: 27,
      startup: 250,
      recovery: 420,
      range: 140,
      hitHeight: 112,
      knockbackX: 640,
      knockbackY: -460,
      hitstun: 540,
      hitstop: 140,
      shake: 0.022,
      cooldown: 12000,
    },
  }),

  quotes: {
    intro: ['오늘 주문하면 오늘 도착합니다.'],
    skill: ['프라임 데이 시작!'],
    ko: ['배송 완료. 리뷰 부탁드립니다.'],
    surge: ['물량이 밀려들어온다.'],
    comeback: ['아직 1일차입니다.'],
    hurt: ['배송 지연이군…'],
  },
};
