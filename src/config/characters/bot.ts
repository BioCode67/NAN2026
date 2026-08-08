import { moveSet } from '../gameConfig';
import type { CharacterConfig } from '../../types';

/** 17. 챗 도우미 — 뭐든 대답한다. 맞는지는 별개다 */
export const bot: CharacterConfig = {
  id: 'bot',
  name: '챗 도우미',
  realName: 'AI 어시스턴트',
  tagline: '도움이 되었길 바랍니다!',
  colors: { body: 0xe5e7eb, head: 0xf8fafc, accent: 0x22d3ee },
  stats: { speed: 268, jump: -730, doubleJump: -670, weight: 1.0 },

  art: {
    hair: 'none',
    hairColor: 0x000000,
    headgear: 'antenna',
    headgearColor: 0x22d3ee,
    glasses: 'rect',
    glassesColor: 0x22d3ee,
    prop: 'board',
    propColor: 0x22d3ee,
    beard: false,
    beardColor: 0x000000,
    mouth: 'flat',
    eyes: 'dot',
  },

  passive: {
    type: 'absorb_flat',
    name: '학습',
    desc: '타격에 성공할 때마다 피해량의 160%를 흡수한다. 때린 만큼 배운다',
    absorbRatio: 1.6,
  },

  signature: {
    id: 'fork',
    name: '모방 학습',
    desc: '방어로 막아낸 기술을 그대로 학습한다. 다음 스킬이 그 기술로 나간다',
    how: '맞아 본 것만 따라 한다. **막는 것부터가 공격의 시작이다**',
    max: 1,
    icon: '🤖',
    color: 0x22d3ee,
  },

  /*
   * 학습형 — 수치가 전부 평균이다. 이 캐릭터의 강함은 표에 없고
   * "상대가 방금 뭘 썼는가"에 있다. 상대를 읽는 사람에게 가장 강하다.
   */
  moves: moveSet({
    light: { name: '자동 완성', damage: 9, startup: 58, recovery: 130 },
    light2: { name: '이어 쓰기', damage: 10, startup: 92 },
    light3: {
      name: '답변 생성',
      damage: 15,
      startup: 120,
      cry: '답변이 완성되었습니다.',
    },

    heavy: { name: '대규모 연산', damage: 22, startup: 198 },
    heavy2: {
      name: '최종 출력',
      damage: 28,
      startup: 172,
      knockbackX: 890,
      cry: '이상입니다.',
    },

    dashAttack: { name: '스트리밍 응답', damage: 16, startup: 80, lunge: 760 },

    lightUp: { name: '온도 상승', damage: 9, startup: 84, hitHeight: 118 },
    lightDown: {
      name: '컨텍스트 절단',
      damage: 9,
      startup: 74,
      range: 100,
      hitstun: 270,
    },

    heavyUp: { name: '창발적 도약', damage: 20, startup: 136, selfLaunch: -690 },
    heavyDown: {
      name: '토큰 초과',
      damage: 24,
      startup: 202,
      range: 148,
      cry: '길이 제한을 넘었습니다.',
    },

    airLight: { name: '공중 요약', damage: 9, startup: 50 },
    airHeavy: { name: '재생성', damage: 18, startup: 116 },
    airDive: {
      name: '무한 루프',
      damage: 22,
      startup: 80,
      cry: '반복 반복 반복 반복',
    },

    /*
     * 앞·뒤 커맨드 — 상대 쪽으로 누르며 치면 파고들고, 반대로 누르면 빠지며 친다.
     * 대시 중 K 는 미끄러지고, 공중에서는 위·뒤로도 낼 수 있다.
     */
    lightFwd: { name: '문장 완성' },
    lightBack: { name: '답변 철회' },
    heavyFwd: { name: '장문 출력' },
    heavyBack: { name: '거절 응답' },
    dashSlide: { name: '토큰 스트림' },
    airUp: { name: '확률 상승' },
    airBack: { name: '이전 답변 참조' },

    skill: {
      name: '저는 언어 모델이라',
      damage: 24,
      startup: 225,
      recovery: 380,
      range: 124,
      hitHeight: 106,
      knockbackX: 570,
      hitstun: 510,
      hitstop: 125,
      shake: 0.018,
      cooldown: 10000,
      effect: 'stun',
      effectDuration: 1200,
    },
  }),

  quotes: {
    intro: ['무엇을 도와드릴까요?'],
    skill: ['죄송합니다, 저는 언어 모델이라…'],
    ko: ['도움이 되었길 바랍니다!'],
    surge: ['확신도가 매우 높습니다.'],
    comeback: ['다시 생성해 보겠습니다.'],
    hurt: ['처리 중 오류가 발생했습니다.'],
  },
};
