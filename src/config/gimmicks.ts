import type { GimmickKind, GimmickSpec } from '../types';

/**
 * 프롬프트 기믹 카탈로그.
 *
 * 프롬프트 오브를 깨면 플레이어가 문장을 입력하고, 그 문장이 여기 있는 기믹
 * 하나로 해석되어 판이 통째로 바뀐다.
 *
 * ── 왜 LLM을 부르지 않는가 ────────────────────────────────────────
 * 대회 제출 요건상 심사자가 **키 없이** 실행할 수 있어야 한다.
 * 그래서 해석기는 로컬 키워드 매칭으로 동작하고, 결과는 항상 이 표 안의
 * 정해진 기믹이다. 외부 모델을 붙이더라도 "문장 → GimmickSpec" 이라는
 * 계약은 그대로이므로, 해석기만 갈아 끼우면 된다.
 *
 * 효과의 실제 구현은 GimmickSystem이 id로 분기해 수행한다.
 * 새 기믹을 넣을 때는 여기 항목 하나 + 거기 분기 하나면 끝난다.
 */
export const GIMMICKS: GimmickSpec[] = [
  /* ================================================================ */
  /* 아이템 — 즉시 발동. 판을 흔드는 물건이 쏟아진다                    */
  /* ================================================================ */
  {
    id: 'item_rain',
    kind: 'item',
    name: '아이템 폭우',
    desc: '아이템 여섯 개가 한꺼번에 쏟아진다',
    icon: '🎁',
    color: 0xfacc15,
    duration: 0,
    keywords: [
      // '뿌려'·'drop' 같은 범용어는 뺐다 — "폭탄을 뿌려"가 폭우로 새어 나간다
      '아이템', '폭우', '쏟아', '잔뜩', '많이', '드랍', '보급', '퍼부',
      'item', 'rain', 'supply', 'shower',
    ],
  },
  {
    id: 'item_bomb',
    kind: 'item',
    name: '폭탄 투하',
    desc: '건드리면 터지는 폭탄이 떨어진다',
    icon: '💣',
    color: 0xef4444,
    duration: 0,
    keywords: [
      '폭탄', '폭발', '터지', '터뜨', '지뢰', '다이너마이트', '펑',
      'bomb', 'explode', 'explosion', 'blast',
    ],
  },
  {
    id: 'item_heal',
    kind: 'item',
    name: '긴급 수혈',
    desc: '회복 아이템만 세 개 떨어진다',
    icon: '💊',
    color: 0x4ade80,
    duration: 0,
    keywords: [
      '회복', '치료', '힐', '수혈', '살려', '체력', '주가 올', '매수',
      'heal', 'health', 'recover', 'potion',
    ],
  },
  {
    id: 'item_power',
    kind: 'item',
    name: '무기고 개방',
    desc: '공격 강화 아이템만 세 개 떨어진다',
    icon: '⚔️',
    color: 0xfb923c,
    duration: 0,
    keywords: [
      '무기', '강화', '공격력', '파워', '세게', '버프', '레버리지',
      'weapon', 'power', 'buff', 'attack', 'strong',
    ],
  },

  /* ================================================================ */
  /* 맵 — 지형과 물리가 바뀐다                                          */
  /* ================================================================ */
  {
    id: 'map_moon',
    kind: 'map',
    name: '달 표면',
    desc: '중력이 절반으로 줄어 모두가 붕붕 뜬다',
    icon: '🌙',
    color: 0xc4b5fd,
    duration: 18000,
    keywords: [
      '달', '우주', '무중력', '저중력', '중력', '둥둥', '붕붕', '떠', '가볍',
      'moon', 'space', 'gravity', 'float', 'zero-g',
    ],
  },
  {
    id: 'map_storm',
    kind: 'map',
    name: '폭풍 경보',
    desc: '강풍이 한쪽으로 계속 밀어낸다',
    icon: '🌪️',
    color: 0x38bdf8,
    duration: 16000,
    keywords: [
      '바람', '폭풍', '태풍', '강풍', '날려', '휘몰', '허리케인',
      'wind', 'storm', 'typhoon', 'hurricane', 'gale',
    ],
  },
  {
    id: 'map_lava',
    kind: 'map',
    name: '용암 지대',
    desc: '지면이 불탄다. 바닥에 서 있으면 주가가 녹는다',
    icon: '🌋',
    color: 0xf97316,
    duration: 15000,
    keywords: [
      // '불' 한 글자는 "불을 꺼"까지 삼켜서 뺐다. 지르는 쪽만 잡는다
      '용암', '화산', '마그마', '뜨거', '불바다', '지옥', '화염', '질러', '불질',
      'lava', 'fire', 'volcano', 'magma', 'hot', 'burn',
    ],
  },
  {
    id: 'map_narrow',
    kind: 'map',
    name: '발판 붕괴',
    desc: '공중 발판이 전부 무너진다. 도망칠 곳이 없다',
    icon: '🕳️',
    color: 0x94a3b8,
    duration: 18000,
    keywords: [
      '붕괴', '무너', '좁', '발판', '없애', '떨어뜨', '지워', '파괴',
      'collapse', 'narrow', 'destroy', 'remove', 'platform',
    ],
  },
  {
    id: 'map_blackout',
    kind: 'map',
    name: '정전',
    desc: '불이 꺼진다. 자기 주변밖에 보이지 않는다',
    icon: '🔦',
    color: 0x1e293b,
    duration: 14000,
    keywords: [
      '어둠', '정전', '깜깜', '어둡', '암전', '블랙아웃', '꺼버', '꺼줘', '불꺼',
      'dark', 'blackout', 'night', 'lights out', 'shadow',
    ],
  },

  /* ================================================================ */
  /* 룰 — 승부 방식 자체가 바뀐다                                        */
  /* ================================================================ */
  {
    id: 'rule_rhythm',
    kind: 'rule',
    name: '리듬 배틀',
    desc: '비트에 맞춰 때리면 2배, 어긋나면 절반',
    icon: '🎵',
    color: 0xf472b6,
    duration: 20000,
    keywords: [
      '리듬', '박자', '비트', '음악', '노래', '댄스', '춤', '장단',
      'rhythm', 'beat', 'music', 'dance', 'song', 'tempo',
    ],
  },
  {
    id: 'rule_sudden',
    kind: 'rule',
    name: '서든데스',
    desc: '모든 피해가 3배. 한 대가 곧 승부다',
    icon: '💀',
    color: 0xdc2626,
    duration: 14000,
    keywords: [
      '즉사', '한방', '서든', '데스', '치명', '살벌', '극한', '3배', '세배',
      '끝내', '끝나', '한대',
      'sudden', 'death', 'instant', 'lethal', 'oneshot',
    ],
  },
  {
    id: 'rule_reverse',
    kind: 'rule',
    name: '조작 반전',
    desc: '좌우 이동이 뒤집힌다',
    icon: '🔄',
    color: 0xa78bfa,
    duration: 14000,
    keywords: [
      '반전', '거꾸로', '뒤집', '반대', '헷갈', '혼란', '역방향',
      'reverse', 'invert', 'flip', 'confuse', 'mirror',
    ],
  },
  {
    id: 'rule_giant',
    kind: 'rule',
    name: '거대화',
    desc: '전원이 1.6배로 커진다. 리치도 함께 커진다',
    icon: '🦖',
    color: 0x22c55e,
    duration: 16000,
    keywords: [
      '거대', '커', '크게', '巨', '자이언트', '대형', '뚱', '괴수',
      'giant', 'big', 'huge', 'large', 'grow', 'kaiju',
    ],
  },
  {
    id: 'rule_slow',
    kind: 'rule',
    name: '슬로우 모션',
    desc: '세상이 느려진다. 읽고 피할 수 있다',
    icon: '🐢',
    color: 0x60a5fa,
    duration: 12000,
    keywords: [
      '슬로우', '느리', '천천', '저속', '매트릭스', '시간',
      'slow', 'motion', 'matrix', 'time', 'bullet time',
    ],
  },
];

/** 갈래를 직접 지목하는 말 — "맵 바꿔줘" 처럼 종류만 말할 때 쓴다 */
const KIND_HINTS: Array<{ kind: GimmickKind; words: string[] }> = [
  { kind: 'item', words: ['아이템', '물건', '템', 'item'] },
  { kind: 'map', words: ['맵', '지형', '스테이지', '무대', 'map', 'stage', 'arena'] },
  { kind: 'rule', words: ['룰', '규칙', '승부', '방식', 'rule', 'mode'] },
];

/** 프롬프트가 비었을 때 대신 쓰는 문구 */
export const PROMPT_PLACEHOLDER = '예) 리듬으로 승부하자 / 달로 보내줘 / 폭탄 뿌려';

/**
 * 입력 예시.
 * 무엇을 쓸 수 있는지 보여주지 않으면 대부분 빈 채로 넘어간다.
 */
export const PROMPT_EXAMPLES: string[] = [
  '리듬으로 승부하자',
  '여기를 달로 만들어줘',
  '폭탄을 뿌려라',
  '전부 거대해져라',
  '불을 꺼버려',
  '한 방이면 끝나게',
];

/**
 * AI가 오브를 깼을 때 대신 외치는 프롬프트.
 *
 * 봇이 깼다고 기믹을 건너뛰면 네 번 중 세 번은 이 기능이 안 보인다.
 * 캐릭터가 말할 법한 문장으로 두면 패러디도 함께 산다.
 */
export const AI_PROMPTS: string[] = [
  '중력을 없애버려',
  '리듬에 맞춰 싸우자',
  '아이템을 쏟아부어',
  '전부 거대하게',
  '불을 질러',
  '시간을 늦춰라',
  '조작을 뒤집어',
  '발판을 다 부숴',
  '폭탄을 투하한다',
  '한 대에 끝내자',
];

/** 문자열을 안정적인 정수로 — 같은 문장이면 늘 같은 결과가 나오게 한다 */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/**
 * 프롬프트를 기믹 하나로 해석한다.
 *
 * 1) 키워드가 가장 많이 맞는 기믹을 고른다
 * 2) 갈래만 말했으면(“맵 바꿔”) 그 갈래 안에서 고른다
 * 3) 아무것도 안 걸리면 문장 해시로 고른다
 *
 * 3번이 중요하다. 못 알아들었다고 아무 일도 안 일어나면 플레이어는
 * "고장났나?" 라고 생각한다. 무엇을 쓰든 판은 반드시 바뀌어야 하고,
 * 같은 문장은 늘 같은 결과여야 우연이 아니라 규칙으로 느껴진다.
 */
export function interpretPrompt(raw: string): GimmickSpec {
  const text = raw.toLowerCase().replace(/\s+/g, ' ').trim();

  /*
   * 띄어쓰기를 뗀 판본도 함께 본다.
   * "한 방"과 "한방"은 같은 말인데 부분 문자열로는 다르다.
   * 한국어 입력에서 이 차이로 못 알아듣는 일이 실제로 잦다.
   */
  const compact = text.replace(/\s+/g, '');

  if (text.length > 0) {
    /*
     * 1) 키워드 매칭.
     *
     * 점수는 "몇 개가 맞았나"가 먼저고 길이는 동점을 가르는 용도다.
     * 길이를 먼저 보면 '뿌려'(2자)가 '폭탄'(2자)을 이기는 식으로,
     * 더 구체적인 말이 범용어에 밀린다.
     */
    let best: GimmickSpec | null = null;
    let bestScore = 0;

    for (const g of GIMMICKS) {
      let score = 0;
      for (const k of g.keywords) {
        const key = k.toLowerCase();
        if (text.includes(key) || compact.includes(key.replace(/\s+/g, ''))) {
          score += 1 + key.length / 100;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        best = g;
      }
    }
    if (best) return best;

    /* 2) 갈래만 지목한 경우 — 그 갈래 안에서 문장 해시로 고른다 */
    for (const hint of KIND_HINTS) {
      if (!hint.words.some((w) => text.includes(w))) continue;
      const pool = GIMMICKS.filter((g) => g.kind === hint.kind);
      return pool[hash(text) % pool.length]!;
    }
  }

  /* 3) 못 알아들었어도 반드시 무언가는 일어난다 */
  return GIMMICKS[hash(text || 'empty') % GIMMICKS.length]!;
}

/** id로 기믹을 찾는다 (테스트·디버그용) */
export function getGimmick(id: string): GimmickSpec | undefined {
  return GIMMICKS.find((g) => g.id === id);
}
