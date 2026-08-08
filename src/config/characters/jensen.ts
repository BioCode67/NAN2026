import { moveSet } from '../gameConfig';
import type { CharacterConfig } from '../../types';

/** 7. 젠슨 황제 — 살수록 아낀다 */
export const jensen: CharacterConfig = {
  id: 'jensen',
  name: '젠슨 황제',
  realName: 'Jensen Huang',
  tagline: '많이 살수록 많이 아낍니다',
  colors: { body: 0x1c1917, head: 0xe8c9a0, accent: 0x76b900 },
  stats: { speed: 285, jump: -740, doubleJump: -660, weight: 1.05 },

  art: {
    hair: 'short',
    hairColor: 0x111827,
    glasses: 'rect',
    glassesColor: 0x0f172a,
    prop: 'board',
    propColor: 0x76b900,
    beard: false,
    beardColor: 0x000000,
    mouth: 'smirk',
    eyes: 'dot',
  },

  passive: {
    type: 'power_when_high',
    name: '수요 폭증',
    desc: '주가가 140% 이상이면 공격력이 35% 오른다. 오르는 동안 더 오른다',
    threshold: 140,
    powerMul: 1.35,
  },

  signature: {
    id: 'booster',
    name: '전력 공급',
    desc: '대시가 전력을 태운다(최대 3). 남아 있으면 공중에서도 대시할 수 있다',
    how: '전력으로 위치를 산다. **다 태우면 지상에 묶인다**',
    max: 3,
    icon: '⚡',
    color: 0x76b900,
  },

  /*
   * 중거리 견제형 — 리치가 길고 판정이 빠르지만 한 방이 가볍다.
   * 스킬은 투사체 두 개를 가진 유일한 캐릭터 축(레이 트레이싱 + 지포스 나우)이다.
   */
  moves: moveSet({
    light: { name: '쿠다 잽', damage: 8, startup: 56, active: 100, range: 74 },
    light2: { name: '텐서 연산', damage: 9, startup: 92, range: 78 },
    light3: {
      name: '레이 트레이싱',
      damage: 14,
      startup: 118,
      range: 96,
      cry: '빛을 다 계산했다.',
    },

    heavy: { name: '가죽 자켓 스윙', damage: 21, startup: 195, range: 92 },
    heavy2: {
      name: '많이 살수록 아낍니다',
      damage: 27,
      startup: 170,
      knockbackX: 900,
      cry: 'The more you buy, the more you save!',
    },

    dashAttack: { name: '초당 30조 연산', damage: 15, startup: 74, lunge: 820 },

    lightUp: { name: '프레임 생성', damage: 9, startup: 82, hitHeight: 122 },
    lightDown: {
      name: '발열 배출',
      // 발밑으로 뜨거운 바람을 내뿜는다 — 넓게 퍼지는 하단기
      damage: 9,
      startup: 70,
      range: 110,
      hitstun: 240,
    },

    heavyUp: { name: '언더볼팅 어퍼', damage: 20, startup: 132, selfLaunch: -700 },
    heavyDown: {
      name: '커넥터 용융',
      damage: 24,
      startup: 200,
      range: 150,
      cry: '전력이 좀 셌나.',
    },

    airLight: { name: '공중 렌더링', damage: 8, startup: 46 },
    airHeavy: { name: '그래픽카드 강타', damage: 18, startup: 116, range: 110 },
    airDive: { name: '재고 소진', damage: 21, startup: 84 },

    /*
     * 앞·뒤 커맨드 — 상대 쪽으로 누르며 치면 파고들고, 반대로 누르면 빠지며 친다.
     * 대시 중 K 는 미끄러지고, 공중에서는 위·뒤로도 낼 수 있다.
     */
    lightFwd: { name: '워프 스케줄링' },
    lightBack: { name: '스로틀링' },
    heavyFwd: { name: '데이터센터 증설' },
    heavyBack: { name: '공급 조절' },
    dashSlide: { name: '냉각 팬 활주' },
    airUp: { name: '클럭 부스트' },
    airBack: { name: '백플레이트 강타' },

    skill: {
      name: '지포스 나우',
      damage: 20,
      startup: 210,
      recovery: 360,
      range: 116,
      knockbackX: 560,
      hitstop: 110,
      shake: 0.016,
      cooldown: 10000,
      // 초록 연산 광선을 곧게 쏜다 — 거리를 두고 싸우라는 신호
      projectile: {
        speed: 900,
        lifespan: 1400,
        displayHeight: 56,
        offsetY: -34,
        pierce: true,
      },
    },
  }),

  quotes: {
    intro: ['자, 계산을 시작하지.'],
    skill: ['연산량이 다르다!'],
    ko: ['재고가 없어서 못 사는 거야.'],
    surge: ['수요가 미쳤어.'],
    comeback: ['다음 세대는 다르다.'],
    hurt: ['전력이 부족해…'],
  },
};
