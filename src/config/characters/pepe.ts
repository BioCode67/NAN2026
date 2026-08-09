import { moveSet } from '../gameConfig';
import type { CharacterConfig } from '../../types';

/** 5. 패니 와이즈맨 — 밈 파워 */
export const pepe: CharacterConfig = {
  id: 'pepe',
  name: '패니 와이즈맨',
  realName: 'Pennywise',
  tagline: '전부 다 걸었다. 너도 걸어라',
  colors: { body: 0xd8d2e8, head: 0xf5f0f5, accent: 0xef4444 },
  stats: { speed: 300, jump: -780, doubleJump: -710, weight: 0.85 },

  /* 이동 기질 — 떨어질 때 점프를 누르고 있으면 천천히 내려온다 */
  move: 'glide',

  art: {
    // 붉게 솟구친 광대 머리 + 귀까지 찢어진 입 + 부릅뜬 눈
    hair: 'messy',
    hairColor: 0xdc2626,
    glasses: 'none',
    glassesColor: 0x000000,
    prop: 'pickaxe',
    propColor: 0xdc2626,
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

  signature: {
    id: 'balloon',
    name: '붉은 풍선',
    desc: '타격마다 풍선이 1개 늘어난다(최대 3). 풍선 하나당 공중 점프가 한 번 늘어난다',
    how: '때려서 기동력을 번다. 대신 **한 대라도 맞으면 전부 터진다**',
    max: 3,
    icon: '🎈',
    color: 0xef4444,
  },

  /*
   * 도박형 — 가장 빠른 약공격 + 가장 센 강공격. 대신 리치가 짧아 파고들어야 한다.
   * 기술은 전부 "붉은 풍선 / 하수구 / 광대"에서 따왔다.
   */
  moves: moveSet({
    light: {
      name: '광대 펀치',
      damage: 6,
      startup: 45,
      active: 90,
      recovery: 90,
      range: 54,
      knockbackX: 110,
      hitstun: 140,
      hitstop: 50,
    },

    // 연속기 — 저글링하듯 가지고 놀다 풍선을 터뜨린다
    light2: { name: '저글링', damage: 8, startup: 86, active: 100, recovery: 105, range: 58 },
    light3: { name: '풍선 터뜨리기', damage: 15, startup: 116, cry: '펑!' },

    lightUp: {
      name: '붉은 풍선',
      // 풍선을 띄워 상대를 함께 들어 올린다 — 가장 잘 뜨는 약공격
      damage: 8,
      startup: 68,
      recovery: 175,
      range: 64,
      hitHeight: 118,
      knockbackY: -620,
    },

    lightDown: {
      name: '하수구의 손',
      // 발밑 하수구에서 손이 튀어나와 발목을 잡는다
      damage: 8,
      startup: 62,
      recovery: 190,
      range: 88,
      // 붙잡아 두는 기술이라 거의 밀어내지 않는다
      knockbackX: 150,
      hitstun: 320,
    },

    heavy: {
      name: '올인 스윙',
      damage: 25,
      startup: 210,
      recovery: 360,
      range: 80,
      hitstop: 140,
    },
    // 대시 중 J/K — 물살을 타고 미끄러져 들어간다
    dashAttack: { name: '하수구 질주', damage: 17, startup: 84, lunge: 760 },

    heavy2: {
      name: '광대의 초대',
      damage: 30,
      startup: 168,
      range: 88,
      knockbackX: 940,
      cry: '너도 떠내려갈 거야!',
    },

    heavyUp: {
      name: '점프 스케어',
      // 하수구에서 튀어 오르며 상대를 놀래킨다
      damage: 20,
      startup: 130,
      recovery: 370,
      range: 70,
      hitHeight: 130,
      selfLaunch: -700,
      cry: '까꿍!',
    },

    heavyDown: {
      name: '하수구 개봉',
      // 발밑 맨홀 뚜껑이 통째로 열린다
      damage: 23,
      startup: 200,
      range: 146,
      knockbackY: -600,
      cry: '내려와서 같이 놀자.',
    },

    airLight: { name: '풍선 후려치기', damage: 8, startup: 48, range: 66 },

    airHeavy: {
      name: '광대 회전',
      damage: 18,
      startup: 120,
      range: 116,
    },

    airDive: {
      name: '떠내려가기',
      damage: 22,
      startup: 90,
      cry: '너도 떠내려갈 거야.',
    },

    /*
     * 앞·뒤 커맨드 — 상대 쪽으로 누르며 치면 파고들고, 반대로 누르면 빠지며 친다.
     * 대시 중 K 는 미끄러지고, 공중에서는 위·뒤로도 낼 수 있다.
     */
    lightFwd: { name: '다가오는 광대' },
    lightBack: { name: '하수구로 후퇴' },
    heavyFwd: { name: '풍선 다발 돌진' },
    heavyBack: { name: '웃으며 물러나기' },
    dashSlide: { name: '미끄러운 하수구' },
    airUp: { name: '풍선 상승' },
    airBack: { name: '뒤통수 광대' },

    skill: {
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
  }),

  quotes: {
    intro: ['우리 같이 떠내려가자.'],
    skill: ['리츠고!'],
    ko: ['너도 상장폐지될 거야.'],
    surge: ['풍선 하나 줄까?'],
    comeback: ['여기선 다들 떠내려가.'],
    hurt: ['아직 안 끝났어…'],
    trait: [
      '전부 다 걸었다!',
      '개구리는 안 판다',
    ],
  },
};
