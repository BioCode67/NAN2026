import { moveSet } from '../gameConfig';
import type { CharacterConfig } from '../../types';

/**
 * 16. 리콴유 — 질서가 먼저입니다
 *
 * ── 왜 유형을 또 사람으로 바꿨는가 ────────────────────────────────
 * 여기 있던 "차트 도사"는 리딩방 운영자라는 **유형**이었다. 한국 사람이면
 * 말로는 다 아는 유형인데, 그림으로는 갓과 도포 한 벌이 전부였다.
 * 옷을 두 번 고쳐 입혔지만 결국 "도포 입은 아저씨"에서 안 벗어났다 —
 * 걸 데가 없는 자리는 옷을 바꿔도 안 걸린다. 사람으로 바꾼다.
 *
 * ── 왜 정주영차와 안 겹치는가 ─────────────────────────────────────
 * 둘 다 "만든 사람"이라 자칫 같은 캐릭터가 된다. 그래서 축을 갈랐다.
 *
 *   정주영차   짓는 사람   망치 · 작업복 · 최중량 · 느리게 내려찍는다
 *   리콴유     다스리는 사람  고지서 · 흰 제복 · 최경량급 · 멀리서 긁는다
 *
 * 이 사람의 무기는 콘크리트가 아니라 **규칙**이다. 그렇게 잡으면 둘은
 * 손에 쥔 것부터 몸무게까지 정반대가 된다.
 *
 * ── 자리의 기계가 그대로 맞는다 ───────────────────────────────────
 *   투사체 스킬   포물선으로 날아가는 과태료 고지서
 *   oneMoreThing  맞으면 곧바로 한 번 더 → 가산금
 *   40% 확률 흡수  거둔 벌금은 전액 국고로
 *   빠르고 가볍다  붙어서 패는 사람이 아니라 멀리서 딱지를 붙이는 사람
 */
export const lky: CharacterConfig = {
  id: 'lky',
  name: '리콴유',
  realName: 'Lee Kuan Yew',
  tagline: '질서가 먼저입니다. 자유는 그 다음이고요',
  colors: { body: 0xf1f5f9, head: 0xeac9a4, accent: 0xe11d48 },
  stats: { speed: 280, jump: -760, doubleJump: -690, weight: 0.9 },

  /* 이동 기질 — 떨어질 때 점프를 누르고 있으면 천천히 내려온다 */
  move: 'glide',

  art: {
    hair: 'short',
    hairColor: 0xd4d4d8,
    glasses: 'rect',
    glassesColor: 0x1f2937,
    // 등나무 회초리. 로스터에서 흰옷에 붉은 띠를 두른 유일한 실루엣이다
    prop: 'stick',
    propColor: 0xb45309,
    beard: false,
    beardColor: 0x000000,
    mouth: 'flat',
    eyes: 'dot',
  },

  passive: {
    type: 'absorb_chance',
    name: '국고 환수',
    desc: '타격의 40% 확률로 피해량의 200%를 거둬들인다. 벌금은 전액 국고로 들어간다',
    chance: 0.4,
    absorbRatio: 2.0,
  },

  signature: {
    id: 'oneMoreThing',
    name: '가산금',
    desc: '스킬이 맞으면 짧은 순간 쿨다운 없이 한 번 더 쓸 수 있다',
    how: '한 번 물리면 곧바로 또 물린다. 빗나가면 조용히 넘어간다',
    max: 1,
    icon: '📋',
    color: 0xe11d48,
  },

  /*
   * 원거리 견제형 — 고지서를 던지고 회초리로 긁는다.
   * 붙으면 약하지만 거리를 벌리면 계속 긁는다. 스킬이 투사체인 둘째 캐릭터.
   */
  moves: moveSet({
    light: { name: '경고장', damage: 9, startup: 58, range: 76 },
    light2: { name: '현장 적발', damage: 10, startup: 94, range: 80 },
    light3: {
      name: '벌점 누적',
      damage: 16,
      startup: 120,
      knockbackY: -660,
      cry: '기록에 남습니다.',
    },

    heavy: { name: '등나무 회초리', damage: 23, startup: 198, range: 92 },
    heavy2: {
      // 넉백 880 — 판에서 제일 멀리 보낸다. 이름 그대로 내보내는 기술
      name: '추방 명령',
      damage: 27,
      startup: 172,
      knockbackX: 880,
      cry: '이 나라에 못 있습니다.',
    },

    dashAttack: { name: '불시 단속', damage: 15, startup: 84, lunge: 720 },

    lightUp: { name: '등급 상향', damage: 9, startup: 82, hitHeight: 126, knockbackY: -620 },
    lightDown: {
      name: '무단횡단',
      damage: 9,
      startup: 72,
      range: 102,
      hitstun: 280,
    },

    heavyUp: { name: '마천루', damage: 20, startup: 134, selfLaunch: -690 },
    heavyDown: {
      // 사거리 150 으로 넓게 쓸어낸다 — 청결 캠페인이 그대로 광역기가 된다
      name: '대청소',
      damage: 24,
      startup: 200,
      range: 150,
      cry: '깨끗하게 치웁니다.',
    },

    airLight: { name: '공중 순찰', damage: 8, startup: 48 },
    airHeavy: { name: '고지서 투척', damage: 18, startup: 112, range: 108 },
    airDive: {
      name: '즉시 집행',
      damage: 22,
      startup: 80,
      cry: '집행합니다.',
    },

    /*
     * 앞·뒤 커맨드 — 상대 쪽으로 누르며 치면 파고들고, 반대로 누르면 빠지며 친다.
     * 대시 중 K 는 미끄러지고, 공중에서는 위·뒤로도 낼 수 있다.
     *
     * 네 개가 행정 조치의 앞뒤로 짝을 이룬다 — 파고들면 단속을 강화하고,
     * 빠지면 격리한다. 크게 밀면 전면 통제, 크게 빠지면 통행 금지.
     */
    lightFwd: { name: '단속 강화' },
    lightBack: { name: '격리 조치' },
    heavyFwd: { name: '전면 통제' },
    heavyBack: { name: '통행 금지' },
    dashSlide: { name: '지하철 개통' },
    airUp: { name: '정원 도시' },
    airBack: { name: '후속 조치' },

    skill: {
      name: '과태료 부과',
      damage: 24,
      startup: 205,
      recovery: 350,
      range: 112,
      knockbackX: 540,
      hitstop: 110,
      shake: 0.016,
      cooldown: 9000,
      // 붉은 고지서가 포물선을 그리며 날아간다 — 거리를 재는 맛
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
    intro: ['규칙부터 읽고 오셨습니까?'],
    skill: ['고지서는 집으로 갑니다.'],
    ko: ['질서가 회복됐습니다.'],
    surge: ['제1세계에 올라섰습니다.'],
    comeback: ['늪지에서 시작했습니다. 이쯤이야.'],
    hurt: ['이것도 규정 위반입니다.'],
    trait: [
      '질서 있게 내려갑니다',
      '뛰어내리는 것도 허가가 필요합니다',
    ],
  },
};
