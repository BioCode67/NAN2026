import { moveSet } from '../gameConfig';
import type { CharacterConfig } from '../../types';

/**
 * 19. 스티븐 호킹 — 시장은 못 계산해도 블랙홀은 계산한다
 *
 * ── 왜 물리학자가 이 판에 있는가 ──────────────────────────────────
 * 로스터 열아홉 명이 전부 돈을 버는 사람이다. 버는 방식만 다를 뿐 목적이
 * 같으니, 한 명쯤은 **아예 다른 것을 보고 있는 사람**이 있어야 판이
 * 재미있어진다. 다들 주가를 보는데 혼자 시공간을 본다.
 *
 * ── 왜 원래 기계를 그대로 물려받았는가 ────────────────────────────
 * 이 자리에 있던 캐릭터(비관론 이코노미스트)의 수치는 하나도 안 바꿨다.
 * 바꿀 이유가 없어서가 아니라, 세 축이 전부 이 사람에게 **더 잘 맞기**
 * 때문이다.
 *   - 활공(glide)   — 중력을 연구한 사람이 천천히 내려온다
 *   - 낮을수록 강함 — 별은 무너질 때 블랙홀이 된다
 *   - 지속 피해 스킬 — 호킹 복사는 말 그대로 천천히 증발시키는 것이다
 * 이름만 갈아 끼운 것이 아니라, 원래 이 수치가 기다리던 사람이었다.
 *
 * ── 그리는 사람에게 ───────────────────────────────────────────────
 * 의자는 약함의 표시가 아니라 **이 로스터에서 제일 좋은 장비**다.
 * 바퀴가 없고 중력 고리 위에 떠 있다 — 탈것을 탄 캐릭터로 그린다.
 * 힘은 전부 물리에서 나온다. 몸으로 농담하지 않는다.
 */
export const hawking: CharacterConfig = {
  id: 'hawking',
  name: '스티븐 호킹',
  realName: 'Stephen Hawking',
  tagline: '우주는 공짜 점심입니다. 시장은 아니고요',
  colors: { body: 0x151a2e, head: 0xe6c8a8, accent: 0xa855f7 },
  stats: { speed: 235, jump: -700, doubleJump: -620, weight: 1.2 },

  /* 이동 기질 — 떨어질 때 점프를 누르고 있으면 천천히 내려온다 */
  move: 'glide',

  art: {
    hair: 'messy',
    hairColor: 0xd4d4d8,
    // 네모난 안경 — 이 사람을 알아보게 하는 조각이다
    glasses: 'rect',
    glassesColor: 0x1f2937,
    // 손 위에 떠 있는 축소된 블랙홀
    prop: 'orb',
    propColor: 0xa855f7,
    beard: false,
    beardColor: 0x000000,
    mouth: 'flat',
    eyes: 'dot',
  },

  passive: {
    type: 'power_when_low',
    name: '중력 붕괴',
    desc: '주가가 75% 이하로 떨어지면 공격력이 45% 오른다. 별은 무너질 때 블랙홀이 된다',
    threshold: 75,
    powerMul: 1.45,
  },

  signature: {
    id: 'shares',
    name: '사건의 지평선',
    desc: '타격에 성공할 때마다 지평선이 1씩 넓어진다(최대 4). 스킬이 넓어진 만큼 세진다',
    how: '한 번 넘어간 것은 돌아오지 않는다. 네 번째면 빠져나갈 방법이 없다',
    max: 4,
    icon: '🕳️',
    color: 0xa855f7,
  },

  /*
   * 지속 피해형 — 한 방이 크지 않은 대신 스킬 지속딜이 로스터 최장이다.
   * 붙어서 이기는 것이 아니라, 상대가 시간에 깎여 나가는 것을 보는 캐릭터.
   */
  moves: moveSet({
    light: { name: '조석력', damage: 9, startup: 68, range: 72 },
    light2: { name: '중력 렌즈', damage: 9, startup: 100 },
    light3: {
      name: '탈출 속도',
      damage: 15,
      startup: 126,
      cry: '못 벗어납니다.',
    },

    heavy: { name: '특이점', damage: 22, startup: 205, range: 86 },
    heavy2: {
      name: '빅뱅',
      damage: 28,
      startup: 180,
      knockbackX: 900,
      cry: '태초에 폭발이 있었습니다.',
    },

    dashAttack: { name: '궤도 진입', damage: 15, startup: 92, lunge: 660 },

    lightUp: { name: '반중력', damage: 9, startup: 86, hitHeight: 122 },
    lightDown: {
      name: '중력 우물',
      // 발밑이 깔때기처럼 꺼진다 — 안 아픈 대신 오래 못 움직인다
      damage: 9,
      startup: 76,
      range: 104,
      knockbackX: 110,
      hitstun: 340,
    },

    heavyUp: { name: '스윙바이', damage: 20, startup: 140, selfLaunch: -650 },
    heavyDown: {
      name: '초신성',
      damage: 24,
      startup: 210,
      range: 152,
      cry: '별은 이렇게 끝납니다.',
    },

    airLight: { name: '무중력', damage: 9, startup: 52 },
    airHeavy: { name: '각운동량', damage: 18, startup: 118, range: 112 },
    airDive: {
      name: '자유 낙하',
      damage: 23,
      startup: 84,
      cry: '자유 낙하입니다.',
    },

    /*
     * 앞·뒤 커맨드 — 상대 쪽으로 누르며 치면 파고들고, 반대로 누르면 빠지며 친다.
     * 대시 중 K 는 미끄러지고, 공중에서는 위·뒤로도 낼 수 있다.
     *
     * 앞뒤 네 개가 물리 용어 두 쌍으로 짝을 이룬다 — 다가가면 청색 편이,
     * 물러나면 적색 편이. 끌면 인력, 밀면 척력. 버튼의 방향이 곧 이름이다.
     */
    lightFwd: { name: '인력' },
    lightBack: { name: '적색 편이' },
    heavyFwd: { name: '청색 편이' },
    heavyBack: { name: '척력' },
    dashSlide: { name: '관성 활주' },
    airUp: { name: '급팽창' },
    airBack: { name: '시간 지연' },

    skill: {
      name: '호킹 복사',
      damage: 20,
      startup: 230,
      recovery: 390,
      range: 128,
      knockbackX: 540,
      hitstun: 520,
      hitstop: 125,
      shake: 0.018,
      cooldown: 11000,
      // 가장 오래 갉아먹는다 — 총합 피해는 로스터 최상위
      effect: 'dot',
      effectValue: 6,
      effectDuration: 4200,
    },
  }),

  quotes: {
    intro: ['별의 궤도는 계산됩니다. 사람은 아니고요.'],
    skill: ['천천히, 남김없이.'],
    ko: ['지평선을 넘었습니다.'],
    surge: ['팽창이 가속되고 있습니다.'],
    comeback: ['별은 무너지면서 가장 밝습니다.'],
    hurt: ['예상 범위 안입니다…'],
    trait: [
      '중력은 협상 대상이 아닙니다',
      '천천히 내려가겠습니다',
    ],
  },
};
