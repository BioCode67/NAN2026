import { moveSet } from '../gameConfig';
import type { CharacterConfig } from '../../types';

/** 6. 워런 버피 — 느리지만 끝내 이긴다 */
export const buffett: CharacterConfig = {
  id: 'buffett',
  name: '워런 버피',
  realName: 'Warren Buffett',
  tagline: '남들이 팔 때 산다. 그리고 안 판다',
  colors: { body: 0x2f4f6f, head: 0xf3d4b6, accent: 0xd4a017 },
  // 가장 느리고 가장 무겁다 — 밀리지 않는 대신 따라잡지도 못한다
  stats: { speed: 205, jump: -690, doubleJump: -580, weight: 1.45 },

  art: {
    hair: 'side-part',
    hairColor: 0xe5e7eb,
    glasses: 'rect',
    glassesColor: 0x1f2937,
    prop: 'stick',
    propColor: 0xd4a017,
    beard: false,
    beardColor: 0x000000,
    mouth: 'smile',
    eyes: 'dot',
  },

  passive: {
    type: 'power_when_low',
    name: '역발상 투자',
    desc: '주가가 70% 이하로 떨어지면 공격력이 40% 오른다. 폭락장이 곧 기회다',
    threshold: 70,
    powerMul: 1.4,
  },

  signature: {
    id: 'shares',
    name: '복리',
    desc: '타격에 성공할 때마다 지분이 1씩 쌓인다(최대 4). 스킬이 쌓인 만큼 세진다',
    how: '오래 버티며 차곡차곡 모은다. **급할 것 없다 — 시간이 편이다**',
    max: 4,
    icon: '💰',
    color: 0xd4a017,
  },

  /*
   * 대기만성형 — 개별 기술은 느리고 굼뜨지만 한 방이 무겁고 넉백을 거의 안 받는다.
   * 지분이 다 차기 전까지 버티는 것이 이 캐릭터의 게임이다.
   */
  moves: moveSet({
    light: { name: '저평가 잽', damage: 9, startup: 84, range: 62 },
    light2: { name: '배당 재투자', damage: 10, startup: 118 },
    light3: {
      name: '복리의 마법',
      // 3타까지 이어 붙이면 보상이 크다 — 이 캐릭터의 핵심 보상 구조
      damage: 19,
      startup: 150,
      knockbackY: -700,
      cry: '눈덩이가 굴러간다.',
    },

    heavy: { name: '가치 투자 스윙', damage: 24, startup: 235, recovery: 380, range: 86 },
    heavy2: {
      name: '10년 보유',
      damage: 30,
      startup: 200,
      knockbackX: 880,
      cry: '10년 들고 있을 게 아니면 10분도 들고 있지 마라.',
    },

    dashAttack: { name: '기업 사냥', damage: 16, startup: 108, lunge: 560 },

    lightUp: { name: '주주 서한', damage: 9, startup: 100, hitHeight: 116 },
    lightDown: {
      name: '체리 콜라 투척',
      // 굴러가는 캔 — 리치가 가장 긴 하단기
      damage: 8,
      startup: 78,
      range: 104,
    },

    heavyUp: { name: '장기 상승장', damage: 21, startup: 148, selfLaunch: -640 },
    heavyDown: {
      name: '버크셔 해서웨이',
      damage: 26,
      startup: 240,
      range: 156,
      hitstop: 150,
      cry: '내 회사다.',
    },

    airLight: { name: '공중 배당', damage: 9, startup: 62 },
    airHeavy: { name: '지팡이 후려치기', damage: 19, startup: 132, range: 104 },
    airDive: {
      name: '폭락장 매수',
      damage: 23,
      startup: 96,
      cry: '남들이 겁낼 때가 살 때다.',
    },

    /*
     * 앞·뒤 커맨드 — 상대 쪽으로 누르며 치면 파고들고, 반대로 누르면 빠지며 친다.
     * 대시 중 K 는 미끄러지고, 공중에서는 위·뒤로도 낼 수 있다.
     */
    lightFwd: { name: '저점 매수 진입' },
    lightBack: { name: '현금 비중 확대' },
    heavyFwd: { name: '경영권 인수' },
    heavyBack: { name: '관망' },
    dashSlide: { name: '안전 마진' },
    airUp: { name: '주가 상승' },
    airBack: { name: '연차 보고서' },

    skill: {
      name: '오마하의 현인',
      damage: 28,
      startup: 300,
      recovery: 430,
      range: 132,
      knockbackX: 620,
      hitstun: 620,
      hitstop: 150,
      shake: 0.02,
      cooldown: 13000,
      // 상대를 오래 묶어 둔다 — 느린 캐릭터가 따라잡을 유일한 창구
      effect: 'stun',
      effectDuration: 1400,
    },
  }),

  quotes: {
    intro: ['천천히 가지. 어차피 내가 이겨.'],
    skill: ['오마하에서 왔다.'],
    ko: ['그건 투자가 아니라 투기였어.'],
    surge: ['복리가 일하는 중이야.'],
    comeback: ['남들이 겁낼 때 욕심을 내라.'],
    hurt: ['단기 변동일 뿐이야.'],
  },
};
