import { moveSet } from '../gameConfig';
import type { CharacterConfig } from '../../types';

/** 14. 공매도 곰 — 남이 망해야 내가 번다 */
export const bear: CharacterConfig = {
  id: 'bear',
  name: '공매도 곰',
  realName: '숏 셀러',
  tagline: '내려가는 데 걸었습니다',
  colors: { body: 0x1e1b1b, head: 0x5b4636, accent: 0x3b82f6 },
  stats: { speed: 240, jump: -690, doubleJump: -600, weight: 1.35 },

  art: {
    hair: 'messy',
    hairColor: 0x2b211a,
    headgear: 'ears',
    headgearColor: 0x6b5344,
    glasses: 'rect',
    glassesColor: 0x0f172a,
    beard: true,
    beardColor: 0x2b211a,
    mouth: 'flat',
    eyes: 'dot',
  },

  passive: {
    type: 'power_when_low',
    name: '공매도 포지션',
    desc: '주가가 80% 이하로 떨어지면 공격력이 30% 오른다. 내 주가가 내려가면 수익이다',
    threshold: 80,
    powerMul: 1.3,
  },

  signature: {
    id: 'fork',
    name: '대차 거래',
    desc: '방어로 막아낸 기술을 빌려온다. 다음 스킬이 그 기술로 나간다',
    how: '빌려서 팔고 나중에 갚는다. **막지 못하면 아무것도 못 빌린다**',
    max: 1,
    icon: '🐻',
    color: 0x3b82f6,
  },

  /*
   * 카운터형 — 스스로 먼저 들어가면 약하다. 막고 되돌려주는 회수가 전부다.
   * 무거워서 잘 안 밀리므로 자리를 잡고 버티는 싸움에 강하다.
   */
  moves: moveSet({
    light: { name: '숏 포지션', damage: 9, startup: 70, range: 70 },
    light2: { name: '추가 매도', damage: 10, startup: 104 },
    light3: {
      name: '투매 유발',
      damage: 16,
      startup: 130,
      knockbackY: -600,
      cry: '다들 던져!',
    },

    heavy: { name: '곰 발톱', damage: 23, startup: 200, range: 86 },
    heavy2: {
      name: '베어마켓',
      damage: 29,
      startup: 180,
      knockbackX: 920,
      cry: '겨울이 왔다.',
    },

    dashAttack: { name: '공매도 폭격', damage: 16, startup: 90, lunge: 690 },

    lightUp: { name: '고점 경고', damage: 9, startup: 88, hitHeight: 118 },
    lightDown: {
      name: '대차 잔고',
      // 발밑을 훑어 상대를 붙잡아 둔다 — 카운터를 준비할 시간을 번다
      damage: 9,
      startup: 76,
      range: 106,
      knockbackX: 130,
      hitstun: 330,
    },

    heavyUp: { name: '마진콜', damage: 21, startup: 142, selfLaunch: -660 },
    heavyDown: {
      name: '서킷 브레이커',
      damage: 25,
      startup: 215,
      range: 154,
      hitstop: 145,
      cry: '거래 중단.',
    },

    airLight: { name: '공중 매도', damage: 9, startup: 54 },
    airHeavy: { name: '곰 강타', damage: 19, startup: 122 },
    airDive: {
      name: '하한가 직행',
      damage: 24,
      startup: 82,
      cry: '바닥까지 간다.',
    },

    skill: {
      name: '리먼 브라더스',
      damage: 27,
      startup: 245,
      recovery: 410,
      range: 130,
      knockbackX: 600,
      hitstun: 560,
      hitstop: 140,
      shake: 0.022,
      cooldown: 12000,
      // 천천히 갉아먹는다 — 이 캐릭터는 한 방보다 시간으로 이긴다
      effect: 'dot',
      effectValue: 5,
      effectDuration: 3500,
    },
  }),

  quotes: {
    intro: ['내려가는 데 걸었습니다.'],
    skill: ['다 무너진다.'],
    ko: ['제 예측이 맞았네요.'],
    surge: ['이럴 리가… 숏 커버링이다!'],
    comeback: ['바닥은 아직 멀었어.'],
    hurt: ['손실이 무제한이라니…'],
  },
};
