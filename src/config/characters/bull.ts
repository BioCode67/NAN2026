import { moveSet } from '../gameConfig';
import type { CharacterConfig } from '../../types';

/** 15. 월가 황소 — 앞만 본다 */
export const bull: CharacterConfig = {
  id: 'bull',
  name: '월가 황소',
  realName: 'Charging Bull',
  tagline: '뒤로 가는 법은 안 배웠다',
  colors: { body: 0x8a6a3c, head: 0xb08d57, accent: 0x22c55e },
  stats: { speed: 295, jump: -700, doubleJump: -590, weight: 1.4 },

  /* 이동 기질 — 뒤로 가는 법은 안 배웠다 — 한번 달리면 방향이 곧바로 안 꺾인다 */
  move: 'drift',

  art: {
    hair: 'none',
    hairColor: 0x000000,
    headgear: 'horns',
    headgearColor: 0xd9c17a,
    glasses: 'none',
    glassesColor: 0x000000,
    beard: false,
    beardColor: 0x000000,
    mouth: 'wide',
    eyes: 'bulge',
  },

  passive: {
    type: 'power_when_high',
    name: '불장',
    desc: '주가가 120% 이상이면 공격력이 40% 오른다. 오르기 시작하면 못 멈춘다',
    threshold: 120,
    powerMul: 1.4,
  },

  signature: {
    id: 'booster',
    name: '스탬피드',
    desc: '대시가 기세를 태운다(최대 3). 남아 있으면 공중에서도 대시할 수 있다',
    how: '기세로 밀어붙인다. 멈추면 그냥 큰 표적이다',
    max: 3,
    icon: '🐂',
    color: 0x22c55e,
  },

  /*
   * 돌진형 — 로스터에서 유일하게 돌진기 세 개(대시 공격·강2타·급강하)가
   * 전부 크게 파고든다. 앞으로 나가는 기술만 잘 써도 굴러가지만,
   * 후딜이 길어 헛치면 그대로 반격당한다.
   */
  moves: moveSet({
    light: { name: '뿔치기', damage: 10, startup: 64, range: 72 },
    light2: { name: '들이받기', damage: 11, startup: 98 },
    light3: {
      name: '상한가 돌파',
      damage: 17,
      startup: 126,
      knockbackY: -640,
      cry: '천장이 어딨어!',
    },

    heavy: { name: '황소 돌진', damage: 24, startup: 190, lunge: 420, range: 88 },
    heavy2: {
      name: '불장',
      damage: 30,
      startup: 175,
      lunge: 520,
      knockbackX: 980,
      cry: '전부 사라!',
    },

    // 로스터 최장 돌진 — 화면 절반을 가로지른다
    dashAttack: { name: '스탬피드', damage: 18, startup: 82, lunge: 980 },

    lightUp: { name: '뿔 올려치기', damage: 10, startup: 80, hitHeight: 120, knockbackY: -600 },
    lightDown: { name: '발굽 긁기', damage: 8, startup: 68, range: 98 },

    heavyUp: { name: '천장 뚫기', damage: 22, startup: 138, selfLaunch: -700 },
    heavyDown: {
      name: '지축 흔들기',
      damage: 26,
      startup: 205,
      range: 166,
      hitstop: 150,
      shake: 0.03,
      cry: '땅이 울린다!',
    },

    airLight: { name: '공중 뿔치기', damage: 10, startup: 52 },
    airHeavy: { name: '황소 회전', damage: 19, startup: 116 },
    airDive: {
      name: '피뢰침',
      // 차트 위꼬리처럼 솟았다 수직으로 꽂힌다
      damage: 25,
      startup: 78,
      cry: '위로 갔다 아래로!',
    },

    /*
     * 앞·뒤 커맨드 — 상대 쪽으로 누르며 치면 파고들고, 반대로 누르면 빠지며 친다.
     * 대시 중 K 는 미끄러지고, 공중에서는 위·뒤로도 낼 수 있다.
     */
    lightFwd: { name: '전진 뿔치기' },
    lightBack: { name: '뒤로 가는 법' },
    heavyFwd: { name: '정면 돌파' },
    heavyBack: { name: '뒷발차기' },
    dashSlide: { name: '흙먼지 활주' },
    airUp: { name: '뿔 치켜올리기' },
    airBack: { name: '공중 뒷발질' },

    skill: {
      name: '월스트리트',
      damage: 28,
      startup: 235,
      recovery: 400,
      range: 134,
      knockbackX: 700,
      hitstun: 520,
      hitstop: 140,
      shake: 0.024,
      cooldown: 11500,
    },
  }),

  quotes: {
    intro: ['뒤로 가는 법은 안 배웠다.'],
    skill: ['다 밀어버린다!'],
    ko: ['앞을 봤어야지.'],
    surge: ['불장이다! 불장!'],
    comeback: ['아직 안 끝났어. 더 간다!'],
    hurt: ['크윽… 조정인가.'],
    trait: [
      '뒤로 가는 법은 안 배웠다!',
      '뿔이 먼저 나간다',
    ],
  },
};
