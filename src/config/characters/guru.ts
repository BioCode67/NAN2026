import { moveSet } from '../gameConfig';
import type { CharacterConfig } from '../../types';

/** 16. 차트 도사 — 오르면 실력, 내리면 시장 탓 */
export const guru: CharacterConfig = {
  id: 'guru',
  name: '차트 도사',
  realName: '리딩방 운영자',
  tagline: '이거 하나만 보세요. 무조건 갑니다',
  colors: { body: 0x6d28d9, head: 0xf5d5b5, accent: 0xfacc15 },
  stats: { speed: 280, jump: -760, doubleJump: -690, weight: 0.9 },

  art: {
    hair: 'swept',
    hairColor: 0x111827,
    headgear: 'topknot',
    headgearColor: 0x111827,
    glasses: 'round',
    glassesColor: 0xfacc15,
    prop: 'orb',
    propColor: 0xfacc15,
    beard: true,
    beardColor: 0x9ca3af,
    mouth: 'smirk',
    eyes: 'bulge',
  },

  passive: {
    type: 'absorb_chance',
    name: '적중률 100%',
    desc: '타격의 40% 확률로 피해량의 200%를 흡수한다. 맞은 것만 기억한다',
    chance: 0.4,
    absorbRatio: 2.0,
  },

  signature: {
    id: 'oneMoreThing',
    name: '재매수 추천',
    desc: '스킬이 맞으면 짧은 순간 쿨다운 없이 한 번 더 쓸 수 있다',
    how: '한 번 맞히면 곧바로 또 지른다. **빗나가면 조용히 사라진다**',
    max: 1,
    icon: '🔮',
    color: 0xfacc15,
  },

  /*
   * 원거리 견제형 — 부적을 던지고 수정 구슬을 쏜다.
   * 붙으면 약하지만 거리를 벌리면 계속 긁는다. 스킬이 투사체인 둘째 캐릭터.
   */
  moves: moveSet({
    light: { name: '지지선 확인', damage: 9, startup: 58, range: 76 },
    light2: { name: '저항선 돌파', damage: 10, startup: 94, range: 80 },
    light3: {
      name: '골든 크로스',
      damage: 16,
      startup: 120,
      knockbackY: -660,
      cry: '골든 크로스 떴습니다!',
    },

    heavy: { name: '수정 구슬 강타', damage: 23, startup: 198, range: 92 },
    heavy2: {
      name: '점괘 적중',
      damage: 27,
      startup: 172,
      knockbackX: 880,
      cry: '제가 뭐랬습니까.',
    },

    dashAttack: { name: '리딩방 입장', damage: 15, startup: 84, lunge: 720 },

    lightUp: { name: '목표가 상향', damage: 9, startup: 82, hitHeight: 126, knockbackY: -620 },
    lightDown: {
      name: '데드 크로스',
      damage: 9,
      startup: 72,
      range: 102,
      hitstun: 280,
    },

    heavyUp: { name: '엘리엇 파동', damage: 20, startup: 134, selfLaunch: -690 },
    heavyDown: {
      name: '차트 붕괴',
      damage: 24,
      startup: 200,
      range: 150,
      cry: '이건 시장 탓입니다.',
    },

    airLight: { name: '공중 매매 신호', damage: 8, startup: 48 },
    airHeavy: { name: '부적 투척', damage: 18, startup: 112, range: 108 },
    airDive: {
      name: '고점 추천',
      damage: 22,
      startup: 80,
      cry: '지금이 저점입니다!',
    },

    skill: {
      name: '무조건 오릅니다',
      damage: 24,
      startup: 205,
      recovery: 350,
      range: 112,
      knockbackX: 540,
      hitstop: 110,
      shake: 0.016,
      cooldown: 9000,
      // 노란 부적이 포물선을 그리며 날아간다 — 거리를 재는 맛
      projectile: {
        speed: 720,
        lifespan: 1800,
        displayHeight: 52,
        offsetY: -40,
        gravity: 420,
      },
    },
  }),

  quotes: {
    intro: ['오늘 종목 나왔습니다.'],
    skill: ['이거 무조건 오릅니다!'],
    ko: ['그러게 제 말 들으시지.'],
    surge: ['제가 뭐랬습니까? 제가 뭐랬어요?'],
    comeback: ['눌림목이었을 뿐입니다.'],
    hurt: ['이건… 예상 범위 안입니다.'],
  },
};
