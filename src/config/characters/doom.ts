import { moveSet } from '../gameConfig';
import type { CharacterConfig } from '../../types';

/** 19. 닥터 둠 — 20년째 폭락을 예언 중 */
export const doom: CharacterConfig = {
  id: 'doom',
  name: '닥터 둠',
  realName: '비관론 이코노미스트',
  tagline: '제가 20년 전부터 말했습니다',
  colors: { body: 0x232936, head: 0xe6c8a8, accent: 0x64748b },
  stats: { speed: 235, jump: -700, doubleJump: -620, weight: 1.2 },

  art: {
    hair: 'messy',
    hairColor: 0x4b5563,
    glasses: 'round',
    glassesColor: 0x1f2937,
    beard: true,
    beardColor: 0x6b7280,
    mouth: 'flat',
    eyes: 'dot',
  },

  passive: {
    type: 'power_when_low',
    name: '예언 적중',
    desc: '주가가 75% 이하로 떨어지면 공격력이 45% 오른다. 무너질수록 말이 맞아떨어진다',
    threshold: 75,
    powerMul: 1.45,
  },

  signature: {
    id: 'shares',
    name: '경고 누적',
    desc: '타격에 성공할 때마다 경고가 1씩 쌓인다(최대 4). 스킬이 쌓인 만큼 세진다',
    how: '틀려도 계속 경고한다. **네 번째 경고가 진짜다**',
    max: 4,
    icon: '🐦‍⬛',
    color: 0x64748b,
  },

  /*
   * 지속 피해형 — 한 방이 크지 않은 대신 스킬 지속딜이 로스터 최장이다.
   * 붙어서 이기는 것이 아니라, 상대가 시간에 깎여 나가는 것을 보는 캐릭터.
   */
  moves: moveSet({
    light: { name: '비관 지적', damage: 9, startup: 68, range: 72 },
    light2: { name: '지표 제시', damage: 9, startup: 100 },
    light3: {
      name: '경고 발령',
      damage: 15,
      startup: 126,
      cry: '이미 늦었습니다.',
    },

    heavy: { name: '폭락 예언', damage: 22, startup: 205, range: 86 },
    heavy2: {
      name: '거품 붕괴',
      damage: 28,
      startup: 180,
      knockbackX: 900,
      cry: '거품은 반드시 꺼집니다.',
    },

    dashAttack: { name: '위기 확산', damage: 15, startup: 92, lunge: 660 },

    lightUp: { name: '금리 인상', damage: 9, startup: 86, hitHeight: 122 },
    lightDown: {
      name: '유동성 고갈',
      // 발밑의 땅이 마르듯 상대의 발이 무거워진다
      damage: 9,
      startup: 76,
      range: 104,
      knockbackX: 110,
      hitstun: 340,
    },

    heavyUp: { name: '인플레이션', damage: 20, startup: 140, selfLaunch: -650 },
    heavyDown: {
      name: '경기 침체',
      damage: 24,
      startup: 210,
      range: 152,
      cry: '바닥은 아직입니다.',
    },

    airLight: { name: '공중 경고', damage: 9, startup: 52 },
    airHeavy: { name: '까마귀 소환', damage: 18, startup: 118, range: 112 },
    airDive: {
      name: '블랙 먼데이',
      damage: 23,
      startup: 84,
      cry: '검은 월요일이다.',
    },

    skill: {
      name: '내가 그랬지',
      damage: 20,
      startup: 230,
      recovery: 390,
      range: 128,
      knockbackX: 540,
      hitstun: 520,
      hitstop: 125,
      shake: 0.018,
      cooldown: 11000,
      // 가장 오래 갉아먹는다 — 총합 피해는 로스터 최상위
      effect: 'dot',
      effectValue: 6,
      effectDuration: 4200,
    },
  }),

  quotes: {
    intro: ['제가 20년 전부터 말했습니다.'],
    skill: ['거 봐요, 내가 그랬지.'],
    ko: ['예상대로군요.'],
    surge: ['이건… 예외적인 국면입니다.'],
    comeback: ['진짜 위기는 지금부터입니다.'],
    hurt: ['이것도 예측했습니다…'],
  },
};
