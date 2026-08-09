import { moveSet } from '../gameConfig';
import type { CharacterConfig } from '../../types';

/**
 * 18. 정주영차 — 이봐, 해보기는 했어?
 *
 * ── 왜 이 자리에 실존 인물을 넣었는가 ─────────────────────────────
 * 여기 있던 "왕 회장님"은 재벌 총수라는 **유형**이었다. 유형은 옷으로만
 * 존재하는데, 이 게임의 스무 명 중 절반이 정장을 입는다. 그래서 카드에서도
 * 판에서도 "정장 입은 아저씨" 이상으로 안 읽혔다. 유형을 사람으로 바꾼다.
 *
 * ── 왜 하필 이 사람인가 ───────────────────────────────────────────
 * 워런 버피가 이미 "늙고 돈 많은 투자자" 자리를 갖고 있어서, 또 돈을 굴리는
 * 노인을 넣으면 둘이 같은 사람이 된다. 정주영은 굴리는 사람이 아니라
 * **짓는 사람**이다 — 로스터에서 유일하게 뭔가를 만들어 본 부자다.
 *
 * 그리고 이 자리의 기계가 그대로 맞는다. 최중량(1.5) · 최저속(215) ·
 * 최고 흡수(165%) · 내려찍기(plunge). 맞아도 안 물러서고 땅을 다지는 몸이다.
 * 별명이 실제로 "불도저"였던 사람에게 이 수치를 안 줄 이유가 없다.
 *
 * ── 이름 ──────────────────────────────────────────────────────────
 * "정주영차"는 세 가지로 읽힌다 — 정주영 · 영차(무거운 것을 드는 소리) ·
 * 차(현대자동차). 로스터 최중량에게 딱 맞는 말장난이라 골랐다.
 */
export const chung: CharacterConfig = {
  id: 'chung',
  name: '정주영차',
  realName: '정주영',
  tagline: '이봐, 해보기는 했어?',
  colors: { body: 0x4d5d3a, head: 0xf0d0ae, accent: 0xea580c },
  stats: { speed: 215, jump: -670, doubleJump: -560, weight: 1.5 },

  /* 이동 기질 — 무겁게 떨어지고 착지 순간 발밑에 충격이 퍼진다 */
  move: 'plunge',

  art: {
    hair: 'side-part',
    hairColor: 0x3f3f46,
    // 로스터에서 아무도 안 쓰던 챙 모자 — 작업모다. 왕관을 벗기고 이걸 씌운다
    headgear: 'cap',
    headgearColor: 0xea580c,
    // 안경을 벗긴다. 앞자리 회장님의 금테와 갈라지는 지점이다
    glasses: 'none',
    glassesColor: 0x000000,
    prop: 'hammer',
    propColor: 0x9ca3af,
    beard: false,
    beardColor: 0x000000,
    // 호탕하게 웃는 사람이었다 — 굳은 입(flat)으로 그리면 딴사람이 된다
    mouth: 'wide',
    eyes: 'dot',
  },

  passive: {
    type: 'absorb_flat',
    name: '뚝심',
    desc: '타격에 성공할 때마다 피해량의 165%를 흡수한다. 맞고도 안 물러서는 것이 이 사람의 자산이다',
    absorbRatio: 1.65,
  },

  signature: {
    id: 'shares',
    name: '공사 진척',
    desc: '타격에 성공할 때마다 공정이 1씩 오른다(최대 4). 스킬이 오른 만큼 세진다',
    how: '하루도 안 쉰다. 네 번째 공정이면 준공이다',
    max: 4,
    icon: '🐂',
    color: 0xea580c,
  },

  /*
   * 최중량 한방형 — 가장 느리고 가장 안 밀린다. 흡수율도 가장 높다.
   * 대신 헛치면 그 자리에 한참 서 있게 된다. 위치를 잘 잡는 사람의 캐릭터.
   */
  moves: moveSet({
    light: { name: '망치질', damage: 10, startup: 88, range: 80 },
    light2: { name: '못 박기', damage: 11, startup: 122, range: 84 },
    light3: {
      name: '크레인 인양',
      damage: 20,
      startup: 155,
      knockbackX: 460,
      knockbackY: -700,
      hitstop: 165,
      cry: '올려!',
    },

    heavy: { name: '철거', damage: 26, startup: 240, recovery: 400, range: 96 },
    heavy2: {
      name: '발파',
      damage: 33,
      startup: 205,
      recovery: 440,
      knockbackX: 1000,
      hitstop: 170,
      cry: '길이 없으면 뚫습니다.',
    },

    // 별명이 실제로 불도저였다
    dashAttack: { name: '불도저', damage: 18, startup: 110, lunge: 560 },

    lightUp: { name: '철근 세우기', damage: 10, startup: 104, hitHeight: 118 },
    lightDown: {
      name: '지반 다지기',
      // 아래로 꾹 눌러 다진다 — 상대를 못 뜨게 만든다
      damage: 10,
      startup: 88,
      range: 106,
      knockbackY: -40,
      hitstun: 300,
    },

    heavyUp: { name: '철탑 등반', damage: 23, startup: 158, selfLaunch: -620 },
    heavyDown: {
      // 서산 간척 — 폐유조선을 가라앉혀 물길을 막았다. 판에서 제일 넓은 내려찍기
      name: '유조선 공법',
      damage: 28,
      startup: 250,
      range: 168,
      hitstop: 160,
      shake: 0.028,
      cry: '물길을 막았습니다.',
    },

    airLight: { name: '공중 측량', damage: 10, startup: 64 },
    airHeavy: { name: '자재 투하', damage: 20, startup: 138, range: 106 },
    airDive: {
      name: '말뚝 박기',
      damage: 26,
      startup: 96,
      cry: '박습니다.',
    },

    /*
     * 앞·뒤 커맨드 — 상대 쪽으로 누르며 치면 파고들고, 반대로 누르면 빠지며 친다.
     * 대시 중 K 는 미끄러지고, 공중에서는 위·뒤로도 낼 수 있다.
     *
     * 네 개가 공사판의 앞뒤로 짝을 이룬다 — 밀어붙이거나 한 발 빼거나,
     * 돌관으로 밤새 밀거나 아예 공사를 세우거나.
     */
    lightFwd: { name: '밀어붙이기' },
    lightBack: { name: '한 발 빼기' },
    heavyFwd: { name: '돌관 공사' },
    heavyBack: { name: '공사 중단' },
    dashSlide: { name: '포니 활주' },
    airUp: { name: '고층 증축' },
    airBack: { name: '후속 공정' },

    skill: {
      // 소 떼 오백 마리를 트럭에 싣고 휴전선을 넘은 그 장면
      name: '소떼 몰이',
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
    intro: ['시작합시다. 시간 없어.'],
    skill: ['소 떼를 몰고 간다.'],
    ko: ['공사 끝났네.'],
    surge: ['거봐, 되잖아.'],
    comeback: ['맨손으로 시작했어. 이쯤이야.'],
    hurt: ['이 정도로는 안 멈춰.'],
    trait: [
      '영차!',
      '땅부터 다진다',
    ],
  },
};
