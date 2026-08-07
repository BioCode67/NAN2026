import { moveSet } from '../gameConfig';
import type { CharacterConfig } from '../../types';

/** 4. 리누스 토발즈맨 — 오픈소스 */
export const linus: CharacterConfig = {
  id: 'linus',
  name: '리누스 토발즈맨',
  realName: 'Linus Torvalds',
  tagline: '궁지에 몰릴수록 강해진다',
  colors: { body: 0x334155, head: 0xf1c9a5, accent: 0x38bdf8 },
  stats: { speed: 250, jump: -700, doubleJump: -630, weight: 1.0 },

  art: {
    hair: 'messy',
    hairColor: 0x7c6244,
    glasses: 'rect',
    glassesColor: 0x1f2937,
    beard: true,
    beardColor: 0x8a7050,
    mouth: 'flat',
    eyes: 'dot',
  },

  passive: {
    type: 'power_when_low',
    name: '오픈소스',
    desc: '주가가 50% 이하일 때 공격력이 1.5배가 된다.',
    threshold: 50,
    powerMul: 1.5,
  },

  signature: {
    id: 'fork',
    name: '포크',
    desc: '방어로 막아낸 기술을 훔쳐 저장한다. 다음 L은 커널 패닉 대신 그 기술로 나간다',
    how: '막는 것이 곧 습득이다. 상대의 강한 기술을 일부러 받아내고 되돌려준다',
    max: 1,
    icon: '🍴',
    color: 0x38bdf8,
  },

  /*
   * 리치형 — 가장 멀리 닿지만 가장 느리다. 거리 유지 싸움에 강하다.
   * 기술은 전부 "git / 커널 / 코드 리뷰 독설"에서 따왔다.
   */
  moves: moveSet({
    light: {
      name: '코드 리뷰',
      damage: 9,
      startup: 90,
      active: 120,
      recovery: 170,
      range: 84,
    },

    // 연속기 — 지적하고, 되돌리고, 결국 갈아엎는다
    light2: { name: '변경 요청', damage: 10, startup: 112, range: 86 },
    light3: { name: '전면 재작성', damage: 17, startup: 140, range: 92, cry: '이건 처음부터 다시 짜.' },

    lightUp: {
      name: '머지 리퀘스트',
      // 대검을 위로 곧게 세워 찌른다 — 가장 높이 닿는 대공 견제
      damage: 10,
      startup: 105,
      recovery: 200,
      range: 78,
      hitHeight: 126,
      knockbackY: -520,
    },

    lightDown: {
      name: 'rm -rf',
      // 바닥을 통째로 쓸어버린다 — 이 게임에서 가장 긴 하단기
      damage: 9,
      startup: 95,
      recovery: 215,
      range: 132,
    },

    heavy: {
      name: '커밋 해머',
      damage: 21,
      startup: 215,
      recovery: 350,
      range: 102,
      hitstop: 135,
    },
    // 대시 중 J/K — 느리지만 대검 리치가 그대로 실린다
    dashAttack: { name: '강제 푸시', damage: 18, startup: 130, range: 112, lunge: 480 },

    heavy2: {
      name: '메인라인 병합',
      damage: 26,
      startup: 178,
      range: 108,
      knockbackX: 880,
      cry: '메인라인에 들어간다.',
    },

    heavyUp: {
      name: 'force push',
      // 대검을 아래에서 위로 밀어 올린다
      damage: 19,
      startup: 175,
      recovery: 395,
      range: 88,
      hitHeight: 140,
      selfLaunch: -480,
      cry: 'git push --force!',
    },

    heavyDown: {
      name: '롤백 슬램',
      // 커밋을 통째로 되돌리듯 지면을 내려찍는다
      damage: 22,
      startup: 240,
      range: 168,
      hitstop: 155,
      cry: '전부 되돌린다.',
    },

    airLight: { name: '패치 투척', damage: 9, startup: 66, range: 82 },

    airHeavy: {
      name: '펭귄 태클',
      damage: 17,
      startup: 145,
      range: 128,
    },

    airDive: {
      name: '커널 강림',
      damage: 20,
      startup: 125,
      cry: 'Talk is cheap.',
    },

    skill: {
      name: '커널 패닉',
      damage: 12,
      startup: 200,
      active: 180,
      recovery: 380,
      range: 140,
      hitHeight: 118,
      knockbackX: 220,
      knockbackY: -180,
      hitstun: 300,
      hitstop: 100,
      shake: 0.012,
      cooldown: 10000,
      effect: 'dot',
      // 5초 동안 1초당 4% 지속 피해
      effectValue: 4,
      effectDuration: 5000,
    },
  }),

  quotes: {
    intro: ['Talk is cheap. Show me the code.'],
    skill: ['Kernel panic!'],
    ko: ['Segmentation fault.'],
    surge: ['Open source, baby!'],
    comeback: ['포크해서 다시 만들면 되지.'],
    hurt: ['이건 내 커널이 아니야.'],
  },
};
