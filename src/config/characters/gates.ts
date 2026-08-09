import { moveSet } from '../gameConfig';
import type { CharacterConfig } from '../../types';

/** 1. 빌 게이츠맨 — 독점 흡수 */
export const gates: CharacterConfig = {
  id: 'gates',
  name: '빌 게이츠맨',
  realName: 'Bill Gates',
  tagline: '독점은 죄가 아니다, 전략이다',
  colors: { body: 0x2f6fd0, head: 0xf1c9a5, accent: 0x7dd3fc },
  stats: { speed: 245, jump: -690, doubleJump: -620, weight: 1.05 },

  /* 이동 기질 — 특별한 기질 없이 정직하게 움직인다 */
  move: 'plain',

  art: {
    hair: 'side-part',
    hairColor: 0x8b6b4a,
    glasses: 'round',
    glassesColor: 0xd4a843,
    prop: 'hammer',
    propColor: 0x86efac,
    beard: false,
    beardColor: 0x000000,
    mouth: 'smile',
    eyes: 'dot',
  },

  passive: {
    type: 'absorb_flat',
    name: '독점 흡수',
    desc: '타격에 성공할 때마다 피해량의 150%를 주가로 흡수한다. (기본 10% → 15%)',
    absorbRatio: 1.5,
  },

  signature: {
    id: 'shares',
    name: '지분 확보',
    desc: '타격마다 지분이 1씩 쌓인다(최대 5). 스킬을 쓰면 쌓인 지분을 전부 태워 그만큼 강해진다',
    how: '오래 참았다 터뜨리는 캐릭터. 5지분 블루스크린은 화면을 멈춰 세운다',
    max: 5,
    icon: '📈',
    color: 0x7dd3fc,
  },

  /*
   * 견제형 — 리치가 길고 묵직하지만 발동이 느리다.
   * 기술은 전부 "윈도우 / 독점 / 기부"에서 따왔다.
   */
  moves: moveSet({
    light: { name: '잽', damage: 9, startup: 78, range: 64 },

    // 연속기 — 클릭하듯 두 번 치고 창을 강제로 닫아버린다
    light2: { name: '더블 클릭', damage: 10, startup: 108, range: 68 },
    light3: { name: '강제 종료', damage: 16, startup: 134, cry: '응답 없음.' },

    lightUp: {
      name: '강제 업데이트',
      // 팝업창이 위로 튀어 올라 상대를 걷어 올린다
      damage: 10,
      startup: 96,
      range: 74,
      hitHeight: 112,
      knockbackY: -560,
    },

    lightDown: {
      name: '기부금 살포',
      // 지폐를 바닥에 흩뿌린다 — 리치가 길고 상대를 낮게 붙잡아 둔다
      damage: 8,
      startup: 88,
      range: 104,
      knockbackX: 300,
    },

    heavy: {
      name: '독점 킥',
      damage: 19,
      startup: 195,
      range: 94,
    },
    // 대시 중 J/K — 달리던 기세로 밀어붙인다
    dashAttack: { name: '시장 진입', damage: 17, startup: 112, lunge: 560 },

    heavy2: {
      name: '인수 합병',
      damage: 24,
      startup: 172,
      range: 100,
      knockbackX: 860,
      cry: '이 회사, 내가 사겠소.',
    },

    heavyUp: {
      name: 'Ctrl+Alt+Del',
      // 세 손가락으로 상대를 강제 종료시키며 함께 솟구친다
      damage: 18,
      startup: 165,
      range: 82,
      hitHeight: 136,
      selfLaunch: -520,
      cry: '작업 관리자 호출!',
    },

    heavyDown: {
      name: '반독점 소송',
      // 판사봉을 내려찍는다 — 이 게임에서 가장 넓은 지상 광역기
      damage: 21,
      startup: 235,
      range: 176,
      knockbackY: -520,
      cry: '반독점 소송이다!',
    },

    airLight: { name: '팝업 광고', damage: 9, startup: 62 },

    airHeavy: {
      name: '윈도우 셔터',
      damage: 16,
      range: 122,
    },

    airDive: {
      name: '강제 재부팅',
      damage: 20,
      cry: '지금 다시 시작합니다!',
    },

    /*
     * 앞·뒤 커맨드 — 상대 쪽으로 누르며 치면 파고들고, 반대로 누르면 빠지며 친다.
     * 대시 중 K 는 미끄러지고, 공중에서는 위·뒤로도 낼 수 있다.
     */
    lightFwd: { name: '설치 마법사' },
    lightBack: { name: '취소 버튼' },
    heavyFwd: { name: '번들 끼워팔기' },
    heavyBack: { name: '라이선스 회수' },
    dashSlide: { name: '디스크 조각 모음' },
    airUp: { name: '클라우드 업로드' },
    airBack: { name: '백스페이스' },

    skill: {
      name: '블루스크린',
      damage: 20,
      startup: 260,
      active: 140,
      recovery: 420,
      // 투사체를 쓰므로 근접 히트박스는 없다
      range: 0,
      hitHeight: 0,
      knockbackX: 300,
      knockbackY: -200,
      hitstun: 1200,
      hitstop: 110,
      shake: 0.014,
      cooldown: 9000,
      effect: 'stun',
      effectDuration: 1200,
      projectile: {
        speed: 620,
        lifespan: 1800,
        // 시트 8번 = 캐릭터 없이 에너지볼만 있는 프레임
        frame: 8,
        displayHeight: 58,
        offsetY: -12,
      },
    },
  }),

  quotes: {
    intro: ["Let's upgrade!"],
    skill: ['Blue Screen!'],
    ko: ['Your stock is worthless!'],
    surge: ['Monopoly mode!'],
    comeback: ["I'll buy your company!"],
    hurt: ['치명적 오류 발생…'],
    trait: [
      '업데이트를 설치하는 중…',
      '재부팅하면 끝납니다',
    ],
  },
};
