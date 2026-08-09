import { moveSet } from '../gameConfig';
import type { CharacterConfig } from '../../types';

/**
 * 17. 앨런 튜링 — 여러분이 돈 버는 그 기계, 제가 정의했습니다
 *
 * ── 왜 이 자리에 실존 인물을 넣었는가 ─────────────────────────────
 * 여기 있던 "챗 도우미"는 AI 어시스턴트라는 **유형**이었다. 유형은 그릴 게
 * 없다 — 흰 몸통에 안테나를 꽂아 놓으면 그게 끝이고, 그 그림은 아무나다.
 * 게다가 AI 쪽은 샘 알트맨과 젠슨 황제가 이미 둘이나 맡고 있어서
 * 자리 하나를 세 명이 나눠 쓰는 꼴이었다.
 *
 * ── 왜 하필 이 사람인가 ───────────────────────────────────────────
 * 이 자리의 기계(fork)가 **막아낸 기술을 그대로 훔쳐 되돌려주는** 것이다.
 * 튜링 테스트의 원래 이름이 "모방 게임(the imitation game)"이고,
 * 그가 실제로 한 일은 에니그마를 막아서 풀어 되돌려준 것이다.
 * 기계 설명과 인물 소개가 같은 문장이 되는 경우는 흔치 않다.
 *
 * 가볍고(1.0) 빠른(268) 수치도 맞는다. 이 사람은 때려서 이기는 쪽이 아니라
 * 상대가 방금 뭘 했는지 읽어서 이기는 쪽이다.
 *
 * 스티븐 호킹에 이어 두 번째 과학자다. 나머지 열여덟이 돈을 버는 동안
 * 이 둘만 다른 것을 보고 있다 — 그 대비가 로스터를 넓힌다.
 */
export const turing: CharacterConfig = {
  id: 'turing',
  name: '앨런 튜링',
  realName: 'Alan Turing',
  tagline: '여러분이 돈 버는 그 기계, 제가 정의했습니다',
  colors: { body: 0x4a3f35, head: 0xf1c9a5, accent: 0x2dd4bf },
  stats: { speed: 268, jump: -730, doubleJump: -670, weight: 1.0 },

  /* 이동 기질 — 공중에서 관성이 오래 남아 미끄러지듯 흐른다 */
  move: 'drift',

  art: {
    hair: 'side-part',
    hairColor: 0x4a3728,
    glasses: 'none',
    glassesColor: 0x000000,
    // 봄브가 뱉어낸 해독 용지 뭉치. 앞자리가 비운 자리를 물려받는다
    prop: 'doc',
    propColor: 0xe5e7eb,
    beard: false,
    beardColor: 0x000000,
    mouth: 'smirk',
    eyes: 'dot',
  },

  passive: {
    type: 'absorb_flat',
    name: '통계 축적',
    desc: '타격에 성공할 때마다 피해량의 160%를 흡수한다. 한 번 본 것은 표에 남는다',
    absorbRatio: 1.6,
  },

  signature: {
    id: 'fork',
    name: '암호 해독',
    desc: '방어로 막아낸 기술을 그대로 해독한다. 다음 스킬이 그 기술로 나간다',
    how: '막는 것이 곧 읽는 것이다. 한 번 읽힌 암호는 다시 못 쓴다',
    max: 1,
    icon: '🔐',
    color: 0x2dd4bf,
  },

  /*
   * 학습형 — 수치가 전부 평균이다. 이 캐릭터의 강함은 표에 없고
   * "상대가 방금 뭘 썼는가"에 있다. 상대를 읽는 사람에게 가장 강하다.
   */
  moves: moveSet({
    light: { name: '문자 대조', damage: 9, startup: 58, recovery: 130 },
    light2: { name: '빈도 분석', damage: 10, startup: 92 },
    light3: {
      name: '해독 완료',
      damage: 15,
      startup: 120,
      cry: '읽혔습니다.',
    },

    heavy: { name: '봄브 가동', damage: 22, startup: 198 },
    heavy2: {
      name: '에니그마 격파',
      damage: 28,
      startup: 172,
      knockbackX: 890,
      cry: '오늘 것도 풀렸습니다.',
    },

    dashAttack: { name: '테이프 전송', damage: 16, startup: 80, lunge: 760 },

    lightUp: { name: '비트 반전', damage: 9, startup: 84, hitHeight: 118 },
    lightDown: {
      name: '회로 차단',
      damage: 9,
      startup: 74,
      range: 100,
      hitstun: 270,
    },

    heavyUp: { name: '재귀 호출', damage: 20, startup: 136, selfLaunch: -690 },
    heavyDown: {
      // 봄브가 한 일 그 자체 — 될 때까지 전부 넣어 본다. 판에서 제일 넓게 훑는다
      name: '전수 조사',
      damage: 24,
      startup: 202,
      range: 148,
      cry: '전부 다 해봤습니다.',
    },

    airLight: { name: '표본 추출', damage: 9, startup: 50 },
    airHeavy: { name: '로터 회전', damage: 18, startup: 116 },
    airDive: {
      name: '무한 루프',
      damage: 22,
      startup: 80,
      cry: '이건 멈추지 않습니다.',
    },

    /*
     * 앞·뒤 커맨드 — 상대 쪽으로 누르며 치면 파고들고, 반대로 누르면 빠지며 친다.
     * 대시 중 K 는 미끄러지고, 공중에서는 위·뒤로도 낼 수 있다.
     *
     * 네 개가 암호의 앞뒤로 짝을 이룬다 — 파고들면 평문화(드러내기),
     * 빠지면 암호화(감추기). 크게 밀면 전면 해독, 크게 빠지면 통신 차단.
     */
    lightFwd: { name: '평문화' },
    lightBack: { name: '암호화' },
    heavyFwd: { name: '전면 해독' },
    heavyBack: { name: '통신 차단' },
    dashSlide: { name: '천공 테이프' },
    // 그가 실제로 만든 베이즈식 순차 분석(밴버리즘)
    airUp: { name: '베이즈 추정' },
    airBack: { name: '되감기' },

    skill: {
      // 튜링 테스트의 원래 이름. 이 자리의 기계가 곧 이 이름이다
      name: '모방 게임',
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
    intro: ['기계가 생각할 수 있느냐고요? 질문이 틀렸습니다.'],
    skill: ['이제 당신 것을 씁니다.'],
    ko: ['패턴이 보였습니다.'],
    surge: ['확률이 유리하게 기울었습니다.'],
    comeback: ['아직 경우의 수가 남았습니다.'],
    hurt: ['표본이 하나 늘었습니다.'],
    trait: [
      '경로를 다시 계산합니다',
      '관성도 계산에 들어갑니다',
    ],
  },
};
