import { moveSet } from '../gameConfig';
import type { CharacterConfig } from '../../types';

/** 13. 동학 개미 — 작고 약하지만 절대 안 판다 */
export const ant: CharacterConfig = {
  id: 'ant',
  name: '동학 개미',
  realName: '개인 투자자',
  tagline: '존버는 승리한다',
  colors: { body: 0x8b5e34, head: 0xf7d9b8, accent: 0xef4444 },
  // 가장 가볍고 가장 잘 뜬다. 대신 한 방이 로스터 최약체
  stats: { speed: 320, jump: -820, doubleJump: -760, weight: 0.72 },

  /* 이동 기질 — 무대 밖으로 밀려도 벽을 한 번 차고 돌아온다 */
  move: 'wallkick',

  art: {
    hair: 'messy',
    hairColor: 0x1f2937,
    headgear: 'helmet',
    headgearColor: 0xfacc15,
    glasses: 'round',
    glassesColor: 0x374151,
    prop: 'phone',
    propColor: 0xef4444,
    beard: false,
    beardColor: 0x000000,
    mouth: 'wide',
    eyes: 'bulge',
  },

  passive: {
    type: 'power_when_low',
    name: '물타기',
    desc: '주가가 60% 이하로 떨어지면 공격력이 60% 오른다. 떨어질수록 더 산다',
    threshold: 60,
    powerMul: 1.6,
  },

  signature: {
    id: 'balloon',
    name: '수익률',
    desc: '타격마다 수익이 1 쌓인다(최대 3). 하나당 공중 점프가 한 번 늘어난다',
    how: '벌어서 뛴다. 한 대 맞으면 계좌가 녹는다',
    max: 3,
    icon: '🐜',
    color: 0xef4444,
  },

  /*
   * 궁지형 — 정상 상태에서는 로스터에서 가장 약하다.
   * 주가가 60% 밑으로 떨어지는 순간부터가 진짜다. 몰릴수록 세지는 유일한 극단.
   */
  moves: moveSet({
    light: { name: '소액 매수', damage: 6, startup: 46, active: 90, range: 56 },
    light2: { name: '물타기', damage: 7, startup: 80 },
    light3: {
      name: '존버',
      damage: 14,
      startup: 110,
      knockbackY: -700,
      cry: '버티면 오른다!',
    },

    heavy: { name: '영끌 매수', damage: 20, startup: 190, range: 72 },
    heavy2: {
      name: '풀 베팅',
      damage: 28,
      startup: 175,
      knockbackX: 900,
      cry: '남은 거 다 넣었다!',
    },

    dashAttack: { name: '추격 매수', damage: 14, startup: 70, lunge: 840 },

    lightUp: { name: '상한가 도전', damage: 8, startup: 70, hitHeight: 124, knockbackY: -660 },
    lightDown: { name: '반대매매', damage: 7, startup: 64, range: 94 },

    heavyUp: {
      name: '떡상 기원',
      // 두 손 모아 하늘로 — 로스터에서 가장 높이 솟는 상승기
      damage: 18,
      startup: 118,
      selfLaunch: -820,
      cry: '제발!',
    },
    heavyDown: {
      name: '패닉 셀',
      damage: 21,
      startup: 185,
      range: 140,
      cry: '못 버티겠어!',
    },

    airLight: { name: '공중 단타', damage: 7, startup: 42 },
    airHeavy: { name: '곡괭이 스윙', damage: 16, startup: 106 },
    airDive: {
      name: '계좌 인증',
      damage: 21,
      startup: 76,
      cry: '이거 실화냐!',
    },

    /*
     * 앞·뒤 커맨드 — 상대 쪽으로 누르며 치면 파고들고, 반대로 누르면 빠지며 친다.
     * 대시 중 K 는 미끄러지고, 공중에서는 위·뒤로도 낼 수 있다.
     */
    lightFwd: { name: '추가 매수' },
    lightBack: { name: '익절' },
    heavyFwd: { name: '몰빵 돌격' },
    heavyBack: { name: '손절 후퇴' },
    dashSlide: { name: '단타 활주' },
    airUp: { name: '우상향' },
    airBack: { name: '뒤늦은 매도' },

    skill: {
      name: '가즈아!',
      damage: 24,
      startup: 215,
      recovery: 380,
      range: 118,
      knockbackX: 580,
      knockbackY: -520,
      hitstun: 490,
      hitstop: 125,
      shake: 0.02,
      cooldown: 10500,
      // 개미답게 주가를 건다 — 물타기 패시브와 맞물려 역전을 만든다
      effect: 'gamble',
      effectValue: 45,
    },
  }),

  quotes: {
    intro: ['오늘은 오르겠지…'],
    skill: ['가즈아아아!'],
    ko: ['너 상장폐지! 나 익절!'],
    surge: ['드디어 파란불 탈출!'],
    comeback: ['물린 게 아니라 모으는 중이야.'],
    hurt: ['계좌가… 계좌가…'],
    trait: [
      '존버는 승리한다!',
      '평단가 낮추러 왔다',
    ],
  },
};
