#!/usr/bin/env node
/**
 * 프롬프트 해석기 테스트.
 *
 * 프롬프트 기믹은 "내가 쓴 문장이 판을 바꾼다"가 전부인 기능이라,
 * 해석이 어긋나면 기능 자체가 무너진다. 브라우저 없이 로직만 떼어 검사한다.
 *
 *   npm run test:prompt
 *
 * Node의 타입 제거 실행(--experimental-strip-types)으로 .ts를 그대로 불러온다.
 * 별도 빌드 단계나 테스트 러너 의존성을 늘리지 않기 위함이다.
 */

import {
  interpretPrompt,
  readPrompt,
  GIMMICKS,
  AI_PROMPTS,
  PROMPT_EXAMPLES,
} from '../src/config/gimmicks.ts';

let failed = 0;
const fail = (msg) => {
  failed++;
  console.error(`  ✗ ${msg}`);
};

/* ------------------------------------------------------------------ */
/* 1. 키워드 해석 — 사람이 쓸 법한 문장이 의도한 기믹으로 가는가        */
/* ------------------------------------------------------------------ */

const CASES = [
  // 룰
  ['리듬으로 승부하자', 'rule_rhythm'],
  ['박자에 맞춰 싸워', 'rule_rhythm'],
  ['음악 틀어줘', 'rule_rhythm'],
  ['한 방이면 끝나게', 'rule_sudden'],
  ['즉사 모드로', 'rule_sudden'],
  ['조작을 뒤집어', 'rule_reverse'],
  ['거꾸로 만들어', 'rule_reverse'],
  ['전부 거대해져라', 'rule_giant'],
  ['시간을 늦춰라', 'rule_slow'],
  ['슬로우 모션', 'rule_slow'],

  // 맵
  ['여기를 달로 만들어줘', 'map_moon'],
  ['중력을 없애버려', 'map_moon'],
  ['바람이 불게 해줘', 'map_storm'],
  ['용암 지대로', 'map_lava'],
  ['불을 질러', 'map_lava'],
  ['발판을 다 부숴', 'map_narrow'],
  ['불을 꺼버려', 'map_blackout'],
  ['깜깜하게', 'map_blackout'],

  // 아이템
  ['아이템을 쏟아부어', 'item_rain'],
  ['폭탄을 뿌려라', 'item_bomb'],
  ['폭탄 투하', 'item_bomb'],
  ['회복 좀 시켜줘', 'item_heal'],
  ['무기를 달라', 'item_power'],

  // 영어도 받는다
  ['make it rhythm', 'rule_rhythm'],
  ['low gravity please', 'map_moon'],
  ['drop bombs', 'item_bomb'],
  ['slow motion', 'rule_slow'],
];

for (const [text, want] of CASES) {
  const got = interpretPrompt(text);
  if (got.id !== want) fail(`"${text}" → ${got.id} (기대 ${want})`);
}
if (!failed) console.log(`✓ 키워드 해석 ${CASES.length}건`);

/* ------------------------------------------------------------------ */
/* 2. 못 알아들어도 반드시 무언가 일어나고, 같은 말은 같은 결과         */
/* ------------------------------------------------------------------ */

const JUNK = ['asdfasdf', '', '???', '🙂🙂', '아무거나요', '   ', 'ㅁㄴㅇㄹ'];
let junkOk = true;

for (const t of JUNK) {
  const a = interpretPrompt(t);
  const b = interpretPrompt(t);

  if (!a || !a.id) {
    fail(`미인식 입력에 결과가 없다: ${JSON.stringify(t)}`);
    junkOk = false;
  } else if (a.id !== b.id) {
    // 같은 문장이 매번 다른 결과면 우연으로 읽혀 규칙이라는 느낌이 사라진다
    fail(`같은 입력이 다른 결과: ${JSON.stringify(t)} → ${a.id} / ${b.id}`);
    junkOk = false;
  }
}
if (junkOk) console.log(`✓ 미인식 입력 ${JUNK.length}건 — 항상 결과가 있고 결정적`);

/* ------------------------------------------------------------------ */
/* 3. 화면에 노출하는 문장들이 실제로 의도대로 해석되는가               */
/* ------------------------------------------------------------------ */

/*
 * 예시 칩과 AI 대사는 플레이어가 그대로 보게 되는 문장이다.
 * 이게 엉뚱한 기믹으로 가면 "설명과 다르게 동작하는 게임"이 된다.
 */
const SHOWN = [...PROMPT_EXAMPLES, ...AI_PROMPTS];
const shownResults = SHOWN.map((t) => ({ t, g: interpretPrompt(t) }));

for (const { t, g } of shownResults) {
  if (!g) fail(`노출 문장이 해석되지 않는다: "${t}"`);
}

/* 예시가 한 기믹에 몰려 있으면 무엇을 쓸 수 있는지 전달되지 않는다 */
const kinds = new Set(shownResults.map((r) => r.g.kind));
if (kinds.size < 3) {
  fail(`노출 문장이 ${[...kinds].join('/')} 갈래에만 몰려 있다 (셋 다 필요)`);
} else {
  console.log(`✓ 노출 문장 ${SHOWN.length}건 — 갈래 ${[...kinds].join(' / ')} 모두 도달`);
}

/* ------------------------------------------------------------------ */
/* 4. 카탈로그 자체의 정합성                                            */
/* ------------------------------------------------------------------ */

const ids = new Set();
for (const g of GIMMICKS) {
  if (ids.has(g.id)) fail(`id 중복: ${g.id}`);
  ids.add(g.id);

  if (!g.keywords.length) fail(`${g.id}: 키워드가 없다 (영영 선택되지 않는다)`);

  /*
   * duration 0 은 "즉시 발동하고 끝"이라는 뜻이다.
   *
   * 예전에는 갈래(kind)로 판별했다 — item 만 즉발이고 나머지는 지속형이라고.
   * 자리 바꾸기·균등 분배처럼 **한 번에 끝나는 룰**이 생기면서 그 가정이
   * 깨졌다. 갈래는 "무엇을 바꾸는가"이지 "얼마나 가는가"가 아니다.
   *
   * 대신 지속형이라면 그 길이가 말이 되는지를 본다. 너무 짧으면 뜬 줄도
   * 모르고 지나가고, 너무 길면 그 판이 통째로 그 기믹의 판이 된다.
   */
  if (g.duration < 0) {
    fail(`${g.id}: duration 이 음수다`);
  } else if (g.duration > 0 && (g.duration < 6000 || g.duration > 30000)) {
    fail(`${g.id}: 지속 시간이 ${g.duration}ms — 6~30초 사이여야 한다`);
  }
}
if (!failed) console.log(`✓ 카탈로그 ${GIMMICKS.length}종 정합성`);

/* ------------------------------------------------------------------ */
/* 5. 한 문장에 두 가지가 들어 있으면 둘 다 읽는가                      */
/* ------------------------------------------------------------------ */

/*
 * "달에서 한방에 끝내자"는 장소와 규칙을 동시에 말한다. 하나만 골라 버리면
 * 플레이어가 쓴 말의 절반을 흘린 것이고, 그러면 다음부터는 짧게만 쓰게 된다 —
 * 길게 쓸 이유가 없어지므로. 이 게임의 축이 "문장으로 판을 바꾼다"이니
 * 문장이 길어질 이유를 없애면 안 된다.
 */

{
  const before = failed;

  const COMBOS = [
    '달에서 한방에 끝내자',
    '용암 위에서 조작을 뒤집어',
    '폭탄 뿌리고 저중력으로',
    // 같은 갈래(룰)라도 서로 간섭하지 않으면 함께 걸린다
    '전부 거대하게 만들고 느리게',
  ];

  for (const text of COMBOS) {
    const r = readPrompt(text);
    if (!r.secondary) {
      fail(`"${text}" — 두 가지를 말했는데 하나만 읽었다 (${r.primary.id})`);
      continue;
    }
    // 맵 두 개를 동시에 걸면 나중 것이 앞의 것을 덮어써 되돌리기가 꼬인다
    if (r.secondary.kind === 'map' && r.primary.kind === 'map') {
      fail(`"${text}" — 맵을 둘 걸었다 (${r.primary.id} + ${r.secondary.id})`);
    }
    if (r.secondary.id === r.primary.id) {
      fail(`"${text}" — 같은 기믹을 둘 걸었다 (${r.primary.id})`);
    }
  }

  /* 하나만 말한 문장에 억지로 둘째를 붙이면 안 된다 */
  const SINGLES = ['폭탄 떨어뜨려', '리듬 배틀'];
  for (const text of SINGLES) {
    const r = readPrompt(text);
    if (r.secondary) {
      fail(`"${text}" — 하나만 말했는데 ${r.secondary.id} 까지 걸렸다`);
    }
  }

  /* 확신도는 알아들었을 때 높고 못 알아들었을 때 낮아야 한다 */
  const known = readPrompt('달에서 한방에 끝내자');
  const unknown = readPrompt('asdfasdf');
  if (!(known.confidence > unknown.confidence + 0.3)) {
    fail(
      `확신도가 구별되지 않는다 (알아들음 ${known.confidence.toFixed(2)} / 모름 ${unknown.confidence.toFixed(2)})`,
    );
  }

  /* 화면에 그대로 뜨는 문장이므로 비어 있으면 안 된다 */
  for (const text of [...COMBOS, ...SINGLES, 'asdfasdf', '']) {
    const r = readPrompt(text);
    if (!r.reason || !r.reason.trim()) fail(`"${text}" — 해석 설명이 비어 있다`);
    if (r.confidence < 0 || r.confidence > 1) {
      fail(`"${text}" — 확신도가 0~1 밖이다 (${r.confidence})`);
    }
  }

  if (failed === before) {
    console.log(
      `✓ 복합 문장 ${COMBOS.length}건 — 갈래가 다른 둘을 함께 읽고, 단일 문장은 하나만`,
    );
  }
}

/* ------------------------------------------------------------------ */

if (failed) {
  console.error(`\n실패 — ${failed}건`);
  process.exit(1);
}
console.log('\n통과');
