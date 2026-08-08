import { moveSet } from '../gameConfig';
import type { CharacterConfig } from '../../types';

/** 18. 왕 회장님 — 회사가 곧 나다 */
export const chairman: CharacterConfig = {
  id: 'chairman',
  name: '왕 회장님',
  realName: '재벌 총수',
  tagline: '내 회사에서 내가 못 할 게 뭐가 있나',
  colors: { body: 0x111827, head: 0xf0d0ae, accent: 0xd4af37 },
  stats: { speed: 215, jump: -670, doubleJump: -560, weight: 1.5 },

  art: {
    hair: 'side-part',
    hairColor: 0xd1d5db,
    headgear: 'crown',
    headgearColor: 0xd4af37,
    glasses: 'rect',
    glassesColor: 0xd4af37,
    prop: 'stick',
    propColor: 0xd4af37,
    beard: false,
    beardColor: 0x000000,
    mouth: 'flat',
    eyes: 'dot',
  },

  passive: {
    type: 'absorb_flat',
    name: '지배 구조',
    desc: '타격에 성공할 때마다 피해량의 165%를 흡수한다. 무게와 함께 버티는 축이다',
    absorbRatio: 1.65,
  },

  signature: {
    id: 'shares',
    name: '지분율',
    desc: '타격에 성공할 때마다 지분이 1씩 쌓인다(최대 4). 스킬이 쌓인 만큼 세진다',
    how: '조금씩 사 모아 이사회를 장악한다. **다 모으면 아무도 못 막는다**',
    max: 4,
    icon: '👑',
    color: 0xd4af37,
  },

  /*
   * 최중량 한방형 — 가장 느리고 가장 안 밀린다. 흡수율도 가장 높다.
   * 대신 헛치면 그 자리에 한참 서 있게 된다. 위치를 잘 잡는 사람의 캐릭터.
   */
  moves: moveSet({
    light: { name: '골프채 잽', damage: 10, startup: 88, range: 80 },
    light2: { name: '스윙 연습', damage: 11, startup: 122, range: 84 },
    light3: {
      name: '홀인원',
      damage: 20,
      startup: 155,
      knockbackX: 460,
      knockbackY: -700,
      hitstop: 165,
      cry: '나이스 샷.',
    },

    heavy: { name: '드라이버 풀스윙', damage: 26, startup: 240, recovery: 400, range: 96 },
    heavy2: {
      name: '경영 승계',
      damage: 33,
      startup: 205,
      recovery: 440,
      knockbackX: 1000,
      hitstop: 170,
      cry: '이제 네 차례다… 는 없어.',
    },

    dashAttack: { name: '갑질 돌진', damage: 18, startup: 110, lunge: 560 },

    lightUp: { name: '주가 부양', damage: 10, startup: 104, hitHeight: 118 },
    lightDown: {
      name: '단가 인하',
      // 아래로 꾹 눌러 깎는다 — 상대를 못 뜨게 만든다
      damage: 10,
      startup: 88,
      range: 106,
      knockbackY: -40,
      hitstun: 300,
    },

    heavyUp: { name: '무상 증자', damage: 23, startup: 158, selfLaunch: -620 },
    heavyDown: {
      name: '유상 증자',
      damage: 28,
      startup: 250,
      range: 168,
      hitstop: 160,
      shake: 0.028,
      cry: '주주 여러분, 조금만 더.',
    },

    airLight: { name: '공중 결재', damage: 10, startup: 64 },
    airHeavy: { name: '서류 투척', damage: 20, startup: 138, range: 106 },
    airDive: {
      name: '회장님 강림',
      damage: 26,
      startup: 96,
      cry: '내려간다.',
    },

    /*
     * 앞·뒤 커맨드 — 상대 쪽으로 누르며 치면 파고들고, 반대로 누르면 빠지며 친다.
     * 대시 중 K 는 미끄러지고, 공중에서는 위·뒤로도 낼 수 있다.
     */
    lightFwd: { name: '어프로치' },
    lightBack: { name: '백스윙' },
    heavyFwd: { name: '정리 해고' },
    heavyBack: { name: '계열 분리' },
    dashSlide: { name: '카트 활주' },
    airUp: { name: '승진 발령' },
    airBack: { name: '뒷돈' },

    skill: {
      name: '이사회 소집',
      damage: 30,
      startup: 290,
      recovery: 440,
      range: 138,
      hitHeight: 118,
      knockbackX: 680,
      hitstun: 600,
      hitstop: 160,
      shake: 0.026,
      cooldown: 13500,
      effect: 'stun',
      effectDuration: 1300,
    },
  }),

  quotes: {
    intro: ['자네가 그 친군가.'],
    skill: ['전원 소집해.'],
    ko: ['정리 해고일세.'],
    surge: ['역시 내 판단이 옳았어.'],
    comeback: ['이 회사, 내가 세웠어.'],
    hurt: ['이런 무례한…'],
  },
};
