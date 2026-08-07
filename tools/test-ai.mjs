#!/usr/bin/env node
/**
 * 봇 성격 테스트.
 *
 *   npm run test:ai
 *
 * ── 왜 브라우저 없이 재는가 ────────────────────────────────────────
 * "게이츠 봇이 지분을 모았다 쓰는가"는 화면으로 확인하기 고약하다.
 * 스킬 한 번 보려고 한 판을 지켜봐야 하고, 조건이 미묘하게 어긋나도
 * "가끔 안 쓰는 것 같다" 정도로만 보여 그냥 넘어가게 된다.
 *
 * 판단만 순수 함수로 떼어 뒀으므로(shouldCastSkill) 여기서 직접 물어본다.
 */

import { readRoster } from './roster-source.mjs';
import {
  AI_PERSONAS,
  personaFor,
  shouldCastSkill,
} from '../src/config/aiPersona.ts';

/*
 * 캐릭터 표는 소스에서 글자로 읽는다.
 *
 * 캐릭터 파일은 gameConfig 를 거쳐 phaser 까지 끌고 온다. 검사 하나 돌리자고
 * 게임 엔진을 부를 이유가 없다. 필요한 것은 "어떤 고유 메커니즘이
 * 쓰이고 있는가" 하나뿐이다.
 */
const SIGNATURE_IDS = [...new Set(readRoster().map((c) => c.signature))];

let failed = 0;
const fail = (msg) => {
  failed++;
  console.error(`  ✗ ${msg}`);
};
const pass = (msg) => console.log(`  ✓ ${msg}`);

/** 기본 상태 — 사거리 안, 쿨다운 완료, 아무것도 안 쌓임 */
const base = {
  ready: true,
  stacks: 0,
  windowOpen: false,
  readyForMs: 0,
  inRange: true,
};
const at = (over) => ({ ...base, ...over });

/* ------------------------------------------------------------------ */
/* 1. 모든 캐릭터에 성격이 붙어 있는가                                  */
/* ------------------------------------------------------------------ */

console.log('성격표 정합성');
{
  if (SIGNATURE_IDS.length === 0) {
    fail('characters.ts 에서 고유 메커니즘을 하나도 읽지 못했습니다');
  }
  for (const sig of SIGNATURE_IDS) {
    if (!AI_PERSONAS[sig]) fail(`${sig} 의 봇 성격이 없습니다`);
  }
  // 반대 방향도 본다 — 쓰이지 않는 성격이 남아 있으면 표가 낡은 것이다
  for (const sig of Object.keys(AI_PERSONAS)) {
    if (!SIGNATURE_IDS.includes(sig)) fail(`${sig} 성격은 쓰는 캐릭터가 없습니다`);
  }
  if (!failed) pass(`캐릭터 ${SIGNATURE_IDS.length}명 모두 성격이 있음`);
}

/* ------------------------------------------------------------------ */
/* 2. 캐릭터별 스킬 판단                                                */
/* ------------------------------------------------------------------ */

console.log('\n스킬을 언제 쓰는가');

const check = (sig, state, want, why) => {
  const got = shouldCastSkill(personaFor(sig), state);
  if (got !== want) fail(`${sig}: ${why} — ${want ? '써야' : '아껴야'} 하는데 ${got}`);
};

/* 게이츠 — 지분을 모았다 터뜨린다 */
check('shares', at({ stacks: 0 }), false, '지분 0으로 바로 지름');
check('shares', at({ stacks: 3 }), false, '지분 3이면 아직 부족');
check('shares', at({ stacks: 4 }), true, '지분 4면 지른다');
check('shares', at({ stacks: 5 }), true, '지분 5면 당연히');
check('shares', at({ stacks: 0, readyForMs: 6000 }), true, '오래 못 모았으면 그냥');
check('shares', at({ stacks: 5, ready: false }), false, '쿨다운 중이면 못 쓴다');

/* 잡스 — 후속 입력 창이 열리면 쿨다운을 무시한다 */
check('oneMoreThing', at({}), true, '준비됐으면 바로');
check('oneMoreThing', at({ ready: false }), false, '쿨다운 중이면 못 쓴다');
check(
  'oneMoreThing',
  at({ ready: false, windowOpen: true }),
  true,
  '창이 열렸으면 쿨다운을 무시한다',
);

/* 리누스 — 훔친 기술이 있어야 쓴다 */
check('fork', at({ stacks: 0 }), false, '훔친 게 없으면 아낀다');
check('fork', at({ stacks: 1 }), true, '훔쳤으면 되돌려준다');
check('fork', at({ stacks: 0, readyForMs: 7000 }), true, '못 훔쳤어도 언젠간 쓴다');

/* 머스크 · 펩 — 조건 없이 준비되는 대로 */
check('booster', at({}), true, '준비됐으면 바로');
check('balloon', at({}), true, '준비됐으면 바로');

/* 사거리 밖에서는 누구도 쓰지 않는다 */
for (const sig of Object.keys(AI_PERSONAS)) {
  check(
    sig,
    at({ inRange: false, stacks: 5, windowOpen: true, readyForMs: 99999 }),
    false,
    '사거리 밖',
  );
}

if (!failed) pass('다섯 캐릭터가 서로 다른 조건으로 스킬을 쓴다');

/* ------------------------------------------------------------------ */
/* 3. 성격이 실제로 서로 다른가                                         */
/* ------------------------------------------------------------------ */

console.log('\n성격이 갈리는가');
{
  /*
   * 값이 전부 같으면 표만 만들고 아무것도 안 한 것이다.
   * 캐릭터를 구분 짓는 축마다 최소 두 종류 이상의 값이 나와야 한다.
   */
  const axes = ['skillMinStacks', 'guardChance', 'useAirDash', 'useFollowUp'];
  for (const axis of axes) {
    const values = new Set(Object.values(AI_PERSONAS).map((p) => p[axis]));
    if (values.size < 2) fail(`${axis} 가 모든 캐릭터에서 같습니다 — 성격이 아니다`);
  }

  // 막아서 훔치는 캐릭터가 가장 자주 막아야 한다
  const guard = Object.entries(AI_PERSONAS).sort(
    (a, b) => b[1].guardChance - a[1].guardChance,
  );
  if (guard[0][0] !== 'fork') {
    fail(`가장 자주 막는 것이 fork 여야 하는데 ${guard[0][0]}`);
  }

  // 공중 대시는 부스터만
  const dashers = Object.entries(AI_PERSONAS).filter(([, p]) => p.useAirDash);
  if (dashers.length !== 1 || dashers[0][0] !== 'booster') {
    fail(`공중 대시는 booster 만 써야 합니다 (${dashers.map((d) => d[0]).join(', ')})`);
  }

  if (!failed) pass('스킬 조건 · 방어 · 공중 대시 · 후속 입력이 모두 갈린다');
}

console.log(failed ? `\n실패 ${failed}건` : '\n통과');
process.exit(failed ? 1 : 0);
