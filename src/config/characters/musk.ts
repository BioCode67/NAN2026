import { moveSet } from '../gameConfig';
import type { CharacterConfig } from '../../types';

/** 3. 일론 머스크맨 — 변동성 폭발 */
export const musk: CharacterConfig = {
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

  signature: {
    id: 'booster',
    name: '부스터',
    desc: '대시가 부스터를 1칸 쓴다(최대 3, 자동 충전). 남아 있으면 **공중에서도 대시**할 수 있다',
    how: '이 게임에서 유일하게 공중 대시를 쓴다. 장외에서 돌아오는 수단이자 도망 수단',
    max: 3,
    icon: '🔥',
    color: 0xfbbf24,
  },

  /*
   * 속도형 — 약공격이 압도적으로 빨라 연타가 들어간다. 대신 한 방이 약하다.
   * 기술은 전부 "로켓 / 터널 / 트윗"에서 따왔다.
   */
  moves: moveSet({
    light: {
      name: '트윗 연사',
      damage: 7,
      startup: 48,
      active: 90,
      recovery: 95,
      range: 56,
      knockbackX: 120,
      hitstun: 140,
      hitstop: 55,
    },

    // 연속기 — 이 캐릭터가 가장 빠르게 몰아친다
    light2: { name: '리트윗', damage: 8, startup: 88, active: 100, recovery: 110, range: 60 },
    light3: { name: '커뮤니티 노트', damage: 14, startup: 118, cry: '이 트윗에는 맥락이 필요합니다.' },

    lightUp: {
      name: '스타링크 발사',
      // 위성을 위로 쏘아 올린다 — 대공 견제
      damage: 8,
      startup: 70,
      recovery: 165,
      range: 68,
      hitHeight: 116,
      knockbackY: -520,
    },

    lightDown: {
      name: '보링 컴퍼니',
      // 바닥에 터널을 뚫으며 앞으로 파고든다 — 가장 긴 하단기
      damage: 8,
      startup: 76,
      range: 112,
      lunge: 340,
    },

    heavy: {
      name: '부스터 차지',
      damage: 20,
      startup: 165,
      recovery: 300,
      range: 86,
      // 부스터를 점화해 앞으로 치고 나간다
      lunge: 520,
    },
    // 대시 중 J/K — 부스터를 그대로 실어 가장 멀리 밀고 나간다
    dashAttack: { name: '하이퍼루프', damage: 15, startup: 88, lunge: 820 },

    heavy2: {
      name: '단수 분리',
      damage: 25,
      startup: 145,
      range: 94,
      knockbackX: 900,
      knockbackY: -520,
      cry: '1단 분리!',
    },

    heavyUp: {
      name: '팰컨 이륙',
      // 이 게임에서 가장 높이 솟는 상승기
      damage: 17,
      startup: 140,
      recovery: 400,
      range: 76,
      hitHeight: 144,
      knockbackY: -820,
      selfLaunch: -820,
      cry: 'To the moon!',
    },

    heavyDown: {
      name: '착륙 실패',
      // 착륙에 실패한 로켓이 그대로 폭발한다
      damage: 21,
      startup: 205,
      range: 158,
      shake: 0.026,
      cry: '착륙은 원래 어려워.',
    },

    airLight: { name: '도지 킥', damage: 8, startup: 46, range: 68 },

    airHeavy: {
      name: '오토파일럿',
      damage: 15,
      startup: 118,
      range: 124,
    },

    airDive: {
      name: '대기권 재진입',
      damage: 21,
      startup: 95,
      divePlunge: { speed: 1500, shockRange: 240, shockDamage: 12 },
      cry: '재진입 시작!',
    },

    skill: {
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
  }),

  quotes: {
    intro: ['To Mars!'],
    skill: ['Rocket launch!'],
    ko: ['Recycled.'],
    surge: ['Dogecoin to the moon!'],
    comeback: ["I'm buying Twitter."],
    hurt: ['재진입 실패…'],
  },
};
