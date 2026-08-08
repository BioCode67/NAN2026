import { moveSet } from '../gameConfig';
import type { CharacterConfig } from '../../types';

/** 9. 마크 저크버그 — 사람인 척은 잘한다 */
export const zuck: CharacterConfig = {
  id: 'zuck',
  name: '마크 저크버그',
  realName: 'Mark Zuckerberg',
  tagline: '저도 물을 마십니다. 사람이니까요',
  colors: { body: 0x9ca3af, head: 0xf6ddc9, accent: 0x1877f2 },
  stats: { speed: 265, jump: -720, doubleJump: -640, weight: 1.0 },

  art: {
    hair: 'short',
    hairColor: 0x8b5a3c,
    glasses: 'none',
    glassesColor: 0x000000,
    prop: 'board',
    propColor: 0x1877f2,
    beard: false,
    beardColor: 0x000000,
    // 각도가 늘 똑같은 웃음 — 표정 근육이 하나뿐인 것처럼
    mouth: 'smile',
    eyes: 'bulge',
  },

  passive: {
    type: 'absorb_flat',
    name: '데이터 수집',
    desc: '타격에 성공할 때마다 피해량의 150%를 흡수한다. 늘 일정하게, 늘 조금씩',
    absorbRatio: 1.5,
  },

  signature: {
    id: 'oneMoreThing',
    name: '사명 변경',
    desc: '스킬이 맞으면 짧은 순간 쿨다운 없이 한 번 더 쓸 수 있다',
    how: '맞히면 곧바로 다시 누른다. **빗나가면 그냥 긴 쿨다운이다**',
    max: 1,
    icon: '♾️',
    color: 0x1877f2,
  },

  /*
   * 표준형 — 어느 쪽으로도 치우치지 않은 기준 캐릭터.
   * 처음 잡는 사람이 조작을 익히기 좋도록 모든 수치를 템플릿 근처에 둔다.
   */
  moves: moveSet({
    light: { name: '좋아요', damage: 10, startup: 66 },
    light2: { name: '따봉 연타', damage: 10, startup: 100 },
    light3: {
      name: '친구 추가',
      damage: 15,
      startup: 128,
      cry: '이제 우린 친구야.',
    },

    heavy: { name: '메타버스 강타', damage: 22, startup: 200, range: 84 },
    heavy2: {
      name: '사명 변경',
      damage: 28,
      startup: 175,
      knockbackX: 900,
      cry: '오늘부터 이름이 바뀝니다.',
    },

    dashAttack: { name: '알고리즘 추천', damage: 16, startup: 88, lunge: 700 },

    lightUp: { name: '스토리 업로드', damage: 9, startup: 90, hitHeight: 112 },
    lightDown: {
      name: '개인정보 수집',
      damage: 8,
      startup: 82,
      range: 98,
      hitstun: 270,
    },

    heavyUp: { name: '아바타 소환', damage: 20, startup: 138, selfLaunch: -680 },
    heavyDown: {
      name: '서버 다운',
      damage: 23,
      startup: 210,
      range: 148,
      cry: '전 세계가 멈췄네요.',
    },

    airLight: { name: '공중 태그', damage: 9, startup: 52 },
    airHeavy: { name: 'VR 헤드셋 강타', damage: 18, startup: 120 },
    airDive: {
      name: '주짓수 테이크다운',
      // 실제로 대회에 나가는 취미 — 유일하게 사람다운 순간
      damage: 23,
      startup: 78,
      cry: '그라운드로 가시죠.',
    },

    /*
     * 앞·뒤 커맨드 — 상대 쪽으로 누르며 치면 파고들고, 반대로 누르면 빠지며 친다.
     * 대시 중 K 는 미끄러지고, 공중에서는 위·뒤로도 낼 수 있다.
     */
    lightFwd: { name: '친구 요청 폭탄' },
    lightBack: { name: '차단' },
    heavyFwd: { name: '경쟁사 복제' },
    heavyBack: { name: '계정 비활성화' },
    dashSlide: { name: '뉴스피드 스크롤' },
    airUp: { name: '아바타 부양' },
    airBack: { name: '뒷광고' },

    skill: {
      name: '이용약관 동의',
      damage: 22,
      startup: 220,
      recovery: 380,
      range: 120,
      hitHeight: 110,
      knockbackX: 540,
      hitstun: 520,
      hitstop: 120,
      shake: 0.018,
      cooldown: 9500,
      // 깨알 같은 글씨의 약관이 상대를 뒤덮는다
      effect: 'stun',
      effectDuration: 1100,
    },
  }),

  quotes: {
    intro: ['반갑습니다. 저도 인간입니다.'],
    skill: ['여기 동의만 하시면 됩니다.'],
    ko: ['계정이 정지되었습니다.'],
    surge: ['참여도가 아주 좋네요.'],
    comeback: ['빠르게 움직이고 부수면 됩니다.'],
    hurt: ['오류가… 아니, 아픕니다.'],
  },
};
