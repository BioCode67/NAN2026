#!/usr/bin/env node
/**
 * 로스터 정합성 검사.
 *
 *   npm run test:char
 *
 * ── 왜 필요한가 ────────────────────────────────────────────────────
 * 다섯 명일 때는 눈으로 셀 수 있었다. 스무 명이 되면 못 센다.
 * 캐릭터 하나를 넣으려면 네 군데를 손대야 하는데(파일 · CharacterId 유니온 ·
 * ROSTER 배열 · 그림 프롬프트 표), 그중 하나를 빠뜨려도 타입 검사는 통과한다.
 * 그러고는 게임을 켜야 알게 된다 — 선택 화면에 카드가 없거나, 있는데 고르면
 * 도형으로 나오거나, 봇이 성격 없이 돈다.
 *
 * 그런 종류의 사고를 1초 만에 잡는 것이 이 검사다.
 */

import {
  MOVE_SLOTS,
  QUOTE_KINDS,
  readArtIds,
  readCharacterIds,
  readRoster,
  readRosterOrder,
  readCharacterIds as _ids,
} from './roster-source.mjs';
import { readFileSync } from 'node:fs';

let failed = 0;
const fail = (msg) => {
  failed++;
  console.error(`  ✗ ${msg}`);
};
const pass = (msg) => console.log(`  ✓ ${msg}`);

const roster = readRoster();
const order = readRosterOrder();
const ids = readCharacterIds();
const artIds = readArtIds();

/* ------------------------------------------------------------------ */
/* 1. 네 곳의 명단이 서로 맞는가                                        */
/* ------------------------------------------------------------------ */

console.log('명단 정합성');
{
  const fileIds = roster.map((c) => c.id);

  for (const c of roster) {
    // 파일 이름과 안에 적힌 id가 다르면 import는 되는데 조회가 안 된다
    const expect = c.file.replace(/\.ts$/, '');
    if (c.id !== expect) fail(`${c.file} 안의 id가 '${c.id}' 입니다 (파일명과 달라요)`);
  }

  const missing = (a, b, label) => {
    for (const id of a) if (!b.includes(id)) fail(label(id));
  };

  missing(fileIds, ids, (id) => `${id}: src/types/index.ts 의 CharacterId 에 없습니다`);
  missing(fileIds, order, (id) => `${id}: characters/index.ts 의 ROSTER 에 없습니다`);
  missing(ids, fileIds, (id) => `${id}: CharacterId 에는 있는데 파일이 없습니다`);
  missing(order, fileIds, (id) => `${id}: ROSTER 에는 있는데 파일이 없습니다`);
  missing(fileIds, artIds, (id) => `${id}: tools/art-characters.mjs 에 없습니다 (그림 프롬프트를 못 만듭니다)`);

  if (!failed) pass(`캐릭터 ${roster.length}명 — 파일 · 타입 · 로스터 · 그림표가 모두 일치`);
}

/* ------------------------------------------------------------------ */
/* 2. 캐릭터마다 빠진 것이 없는가                                       */
/* ------------------------------------------------------------------ */

console.log('\n캐릭터별 구성');
{
  const before = failed;

  for (const c of roster) {
    const at = `${c.id}(${c.name ?? '이름 없음'})`;

    if (!c.name) fail(`${at}: name 이 없습니다`);
    if (!c.realName) fail(`${at}: realName 이 없습니다 — 누구의 패러디인지 안 보입니다`);
    if (!c.passive) fail(`${at}: passive.type 이 없습니다`);
    if (!c.signature) fail(`${at}: signature.id 가 없습니다`);

    for (const slot of MOVE_SLOTS) {
      if (!c.moves[slot]) fail(`${at}: 커맨드 '${slot}' 이(가) 없습니다`);
    }

    for (const kind of QUOTE_KINDS) {
      if (!c.quotes[kind]) fail(`${at}: 대사 '${kind}' 이(가) 비어 있습니다`);
    }

    /*
     * 뼈대만 만들어 두고 잊은 캐릭터를 잡는다.
     * 이름이 'TODO 잽' 이어도 형식은 멀쩡하므로 다른 검사에는 걸리지 않는다.
     * 그대로 두면 선택 화면에 "TODO 잽"이 뜬 채로 제출된다.
     */
    if (c.todos > 0) {
      fail(`${at}: 아직 안 채운 자리가 ${c.todos}군데 있습니다 (${c.file})`);
    }
  }

  if (failed === before) {
    pass(`${roster.length}명 모두 커맨드 ${MOVE_SLOTS.length}개 · 대사 ${QUOTE_KINDS.length}종류`);
  }
}

/* ------------------------------------------------------------------ */
/* 3. 기술 이름이 겹치지 않는가                                         */
/* ------------------------------------------------------------------ */

console.log('\n기술 이름');
{
  const before = failed;

  /*
   * 한 캐릭터 안에서 겹치면 복붙하다 이름 바꾸는 것을 잊은 것이다.
   * 화면에는 기술 이름이 뜨므로, 다른 버튼을 눌렀는데 같은 이름이 뜬다.
   */
  for (const c of roster) {
    const seen = new Map();
    for (const [slot, name] of Object.entries(c.moves)) {
      if (seen.has(name)) {
        fail(`${c.id}: '${name}' 이 ${seen.get(name)} 과 ${slot} 에 겹칩니다`);
      }
      seen.set(name, slot);
    }
  }

  /*
   * 캐릭터끼리 겹치는 것도 본다. 이 게임의 정체성이 패러디인데
   * 두 사람이 같은 이름의 기술을 쓰면 그 인물다움이 사라진다.
   */
  const owner = new Map();
  for (const c of roster) {
    for (const [slot, name] of Object.entries(c.moves)) {
      const prev = owner.get(name);
      if (prev && prev.id !== c.id) {
        fail(`'${name}' 을 ${prev.id}(${prev.slot}) 와 ${c.id}(${slot}) 가 같이 씁니다`);
      }
      owner.set(name, { id: c.id, slot });
    }
  }

  if (failed === before) pass(`${owner.size}개 기술 이름이 모두 다릅니다`);
}

/* ------------------------------------------------------------------ */
/* 4. 봇이 이 캐릭터를 쓸 줄 아는가                                     */
/* ------------------------------------------------------------------ */

console.log('\n봇 연결');
{
  const before = failed;
  const personaSrc = readFileSync('src/config/aiPersona.ts', 'utf8');
  const personaIds = [
    ...personaSrc
      .slice(personaSrc.indexOf('AI_PERSONAS'))
      .matchAll(/^  ([a-zA-Z][a-zA-Z0-9]*):\s*\{/gm),
  ].map((m) => m[1]);

  for (const c of roster) {
    if (c.signature && !personaIds.includes(c.signature)) {
      fail(
        `${c.id}: 고유 메커니즘 '${c.signature}' 에 봇 성격이 없습니다\n` +
          `      (src/config/aiPersona.ts 의 AI_PERSONAS 에 추가하세요)`,
      );
    }
  }

  /* 어떤 메커니즘을 몇 명이 쓰는지 — 스무 명이면 나눠 쓰는 것이 정상이다 */
  const byMech = new Map();
  for (const c of roster) {
    byMech.set(c.signature, [...(byMech.get(c.signature) ?? []), c.id]);
  }

  if (failed === before) {
    pass(
      `고유 메커니즘 ${byMech.size}종을 ${roster.length}명이 나눠 씁니다\n` +
        [...byMech]
          .map(([m, list]) => `      ${m}: ${list.join(', ')}`)
          .join('\n'),
    );
  }
}

console.log(failed ? `\n실패 ${failed}건` : '\n통과');
process.exit(failed ? 1 : 0);
