import { moveSet } from '../gameConfig';
import type { CharacterConfig } from '../../types';

/** 11. 샘 알트맨 — 잘려도 닷새면 돌아온다 */
export const altman: CharacterConfig = {
  id: 'altman',
  name: '샘 알트맨',
  realName: 'Sam Altman',
  tagline: '조금 무섭지만, 아주 좋은 물건입니다',
  colors: { body: 0x374151, head: 0xf2d3bb, accent: 0x10a37f },
  stats: { speed: 275, jump: -750, doubleJump: -680, weight: 0.95 },

  /* 이동 기질 — 무대 밖으로 밀려도 벽을 한 번 차고 돌아온다 */
  move: 'wallkick',

  art: {
    hair: 'swept',
    hairColor: 0x6b4a2f,
    glasses: 'none',
    glassesColor: 0x000000,
    prop: 'orb',
    propColor: 0x10a37f,
    beard: false,
    beardColor: 0x000000,
    mouth: 'smirk',
    eyes: 'dot',
  },

  passive: {
    type: 'power_when_high',
    name: '스케일링 법칙',
    desc: '주가가 130% 이상이면 공격력이 30% 오른다. 크게 만들수록 세진다',
    threshold: 130,
    powerMul: 1.3,
  },

  signature: {
    id: 'oneMoreThing',
    name: '닷새 만에 복귀',
    desc: '스킬이 맞으면 짧은 순간 쿨다운 없이 한 번 더 쓸 수 있다',
    how: '한 번 통하면 곧바로 다시 누른다. **쫓겨나도 돌아온다**',
    max: 1,
    icon: '🔁',
    color: 0x10a37f,
  },

  /*
   * 연타형 — 약공격이 로스터에서 가장 빠르고 이어치기가 잘 붙는다.
   * 한 방은 가장 약하다. 계속 붙어서 토큰을 뽑아내는 캐릭터.
   */
  moves: moveSet({
    light: { name: '토큰 잽', damage: 7, startup: 44, active: 90, recovery: 120 },
    light2: { name: '컨텍스트 확장', damage: 8, startup: 78, recovery: 130 },
    light3: {
      name: '추론 완료',
      damage: 15,
      startup: 106,
      knockbackY: -640,
      cry: '답이 나왔다.',
    },

    heavy: { name: 'GPU 클러스터', damage: 20, startup: 185 },
    heavy2: {
      name: '스케일링 법칙',
      damage: 26,
      startup: 158,
      knockbackX: 860,
      cry: '더 키우면 더 세진다.',
    },

    dashAttack: { name: '데이터 크롤링', damage: 15, startup: 78, lunge: 800 },

    lightUp: { name: '파라미터 증설', damage: 9, startup: 78, hitHeight: 120 },
    lightDown: {
      name: '환각 생성',
      // 없는 것을 그럴듯하게 지어낸다 — 판정이 이상하게 넓다
      damage: 8,
      startup: 68,
      range: 104,
      hitstun: 260,
    },

    heavyUp: { name: '창발적 능력', damage: 20, startup: 126, selfLaunch: -720 },
    heavyDown: {
      name: '모델 붕괴',
      damage: 23,
      startup: 195,
      range: 146,
      cry: '학습 데이터가 오염됐어.',
    },

    airLight: { name: '공중 프롬프트', damage: 8, startup: 44 },
    airHeavy: { name: '파인 튜닝', damage: 17, startup: 110 },
    airDive: { name: '정렬 실패', damage: 21, startup: 80, cry: '통제가 안 돼!' },

    /*
     * 앞·뒤 커맨드 — 상대 쪽으로 누르며 치면 파고들고, 반대로 누르면 빠지며 친다.
     * 대시 중 K 는 미끄러지고, 공중에서는 위·뒤로도 낼 수 있다.
     */
    lightFwd: { name: '컨텍스트 주입' },
    lightBack: { name: '안전 정지' },
    heavyFwd: { name: '사전 학습' },
    heavyBack: { name: '배포 연기' },
    dashSlide: { name: '추론 가속' },
    airUp: { name: '성능 도약' },
    airBack: { name: '시스템 프롬프트' },

    skill: {
      name: '범용 인공지능',
      damage: 21,
      startup: 200,
      recovery: 340,
      range: 122,
      hitHeight: 108,
      knockbackX: 520,
      hitstun: 470,
      hitstop: 115,
      shake: 0.018,
      // 짧은 쿨다운 + 고유 메커니즘 = 연속으로 밀어붙이는 압박형
      cooldown: 8500,
      effect: 'dot',
      effectValue: 4,
      effectDuration: 3000,
    },
  }),

  quotes: {
    intro: ['조금 무섭지만, 아주 좋은 물건입니다.'],
    skill: ['AGI가 왔다.'],
    ko: ['정렬에 실패하셨군요.'],
    surge: ['스케일이 곧 실력이야.'],
    comeback: ['닷새면 돌아옵니다.'],
    hurt: ['컨텍스트가 날아갔어…'],
    trait: [
      '해고당해도 돌아옵니다',
      '닷새면 충분합니다',
    ],
  },
};
