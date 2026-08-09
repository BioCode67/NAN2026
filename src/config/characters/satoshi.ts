import { moveSet } from '../gameConfig';
import type { CharacterConfig } from '../../types';

/** 8. 사토시 나카무네 — 아무도 정체를 모른다 */
export const satoshi: CharacterConfig = {
  id: 'satoshi',
  name: '사토시 나카무네',
  realName: 'Satoshi Nakamoto',
  tagline: '나를 본 사람은 아무도 없다',
  colors: { body: 0x27272a, head: 0x3f3f46, accent: 0xf7931a },
  stats: { speed: 310, jump: -790, doubleJump: -730, weight: 0.82 },

  /* 이동 기질 — 채굴 곡괭이를 앞세우고 무겁게 내리꽂는다 */
  move: 'plunge',

  art: {
    // 후드에 가려 얼굴이 없다 — 눈만 두 점으로 빛난다
    hair: 'none',
    hairColor: 0x18181b,
    headgear: 'hood',
    headgearColor: 0x18181b,
    glasses: 'none',
    glassesColor: 0x000000,
    prop: 'pickaxe',
    propColor: 0xf7931a,
    beard: false,
    beardColor: 0x000000,
    mouth: 'flat',
    // 후드 그늘 안에서 눈만 보여야 한다 — 점눈은 어둠에 묻힌다
    eyes: 'bulge',
  },

  passive: {
    type: 'absorb_chance',
    name: '채굴 보상',
    desc: '타격의 30% 확률로 피해량의 320%를 흡수한다. 터질 때 크게 터진다',
    chance: 0.3,
    absorbRatio: 3.2,
  },

  signature: {
    id: 'fork',
    name: '하드 포크',
    desc: '방어로 막아낸 기술을 통째로 복사한다. 다음 스킬이 그 기술로 나간다',
    how: '먼저 막고 나서 돌려준다. 방어가 곧 공격이다',
    max: 1,
    icon: '⛓️',
    color: 0xf7931a,
  },

  /*
   * 히트 앤 런 — 가장 빠른 이동속도에 가장 가벼운 몸.
   * 잘 맞지만 잘 도망친다. 채굴 보상이 터지는 순간을 노리고 붙어야 한다.
   */
  moves: moveSet({
    light: { name: '해시 잽', damage: 8, startup: 48, active: 95, range: 60 },
    light2: { name: '논스 탐색', damage: 9, startup: 84 },
    light3: {
      name: '블록 생성',
      damage: 16,
      startup: 112,
      knockbackY: -660,
      cry: '한 블록 채굴 완료.',
    },

    heavy: { name: '채굴 곡괭이', damage: 22, startup: 190, range: 78 },
    heavy2: {
      name: '반감기',
      // 반으로 쪼개듯 내려친다 — 넉백은 크고 피해는 어중간하다
      damage: 25,
      startup: 160,
      knockbackX: 980,
      cry: '반으로 줄었다.',
    },

    dashAttack: { name: '51% 공격', damage: 16, startup: 76, lunge: 860 },

    lightUp: { name: '가격 펌핑', damage: 8, startup: 76, hitHeight: 126, knockbackY: -600 },
    lightDown: {
      name: '콜드 월렛',
      // 지갑을 땅에 묻는다 — 붙잡아 두는 기술
      damage: 8,
      startup: 66,
      range: 96,
      hitstun: 300,
    },

    heavyUp: { name: '떡상 사다리', damage: 19, startup: 124, selfLaunch: -740 },
    heavyDown: {
      name: '난이도 조정',
      damage: 22,
      startup: 190,
      range: 144,
      cry: '조정 들어간다.',
    },

    airLight: { name: '공중 전송', damage: 8, startup: 44 },
    airHeavy: { name: '지갑 분실', damage: 17, startup: 112 },
    airDive: {
      name: '고점 매수',
      damage: 22,
      startup: 82,
      cry: '여기가 바닥이야!',
    },

    /*
     * 앞·뒤 커맨드 — 상대 쪽으로 누르며 치면 파고들고, 반대로 누르면 빠지며 친다.
     * 대시 중 K 는 미끄러지고, 공중에서는 위·뒤로도 낼 수 있다.
     */
    lightFwd: { name: '트랜잭션 전파' },
    lightBack: { name: '익명 후퇴' },
    heavyFwd: { name: '체인 확장' },
    heavyBack: { name: '개인키 은닉' },
    dashSlide: { name: '블록 전파' },
    airUp: { name: '가격 급등' },
    airBack: { name: '이중 지불' },

    skill: {
      name: '제네시스 블록',
      damage: 29,
      startup: 230,
      recovery: 400,
      range: 128,
      knockbackX: 600,
      knockbackY: -420,
      hitstun: 500,
      hitstop: 130,
      shake: 0.02,
      cooldown: 11000,
    },
  }),

  quotes: {
    intro: ['…'],
    skill: ['첫 블록을 새긴다.'],
    ko: ['원장에 영구히 기록됐어.'],
    surge: ['탈중앙이란 이런 거지.'],
    comeback: ['체인은 끊기지 않아.'],
    hurt: ['지갑이 털렸다…'],
    trait: [
      '블록을 캤습니다',
      '나를 본 사람은 없습니다',
    ],
  },
};
