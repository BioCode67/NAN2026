/**
 * 로스터를 소스에서 읽는다.
 *
 * ── 왜 import 하지 않고 글자로 읽는가 ─────────────────────────────
 * 캐릭터 파일은 gameConfig 를 거쳐 phaser 까지 끌고 온다. 검사 하나 돌리자고
 * 게임 엔진을 통째로 불러올 이유가 없고, Node의 ESM은 확장자 없는 경로를
 * 풀지도 못한다(번들러만 푼다).
 *
 * 여기서 확인하려는 것은 "빠진 것 · 겹친 것 · 어긋난 것"이다. 값의 계산이
 * 아니라 표의 정합성이므로, 정해진 모양의 설정 파일을 글자로 읽는 것으로 충분하다.
 */

import { readFileSync, readdirSync } from 'node:fs';

const DIR = 'src/config/characters';

/** 커맨드 슬롯 14개 — 하나라도 빠지면 그 캐릭터는 그 기술을 못 쓴다 */
export const MOVE_SLOTS = [
  'light',
  'light2',
  'light3',
  'heavy',
  'heavy2',
  'dashAttack',
  'lightUp',
  'lightDown',
  'heavyUp',
  'heavyDown',
  'airLight',
  'airHeavy',
  'airDive',
  'skill',
];

/** 대사 갈래 — 비어 있으면 그 상황에서 캐릭터가 말을 안 한다 */
export const QUOTE_KINDS = ['intro', 'skill', 'ko', 'surge', 'comeback', 'hurt'];

const first = (re, text) => re.exec(text)?.[1] ?? null;

/** 캐릭터 파일 하나를 읽어 검사에 필요한 것만 뽑는다 */
function parseCharacter(file) {
  const src = readFileSync(`${DIR}/${file}`, 'utf8');

  const moves = {};
  /*
   * moveSet({ light: { name: '잽', … }, … }) 안에서 슬롯별 이름을 뽑는다.
   * 슬롯 이름을 앞에 고정해 두므로, 같은 파일 안의 다른 name 필드
   * (패시브·고유 메커니즘)와 섞이지 않는다.
   */
  for (const slot of MOVE_SLOTS) {
    const re = new RegExp(`\\b${slot}:\\s*\\{[^}]*?name:\\s*'([^']*)'`, 's');
    const m = re.exec(src);
    if (m) moves[slot] = m[1];
  }

  const quotes = {};
  const qBlock = /quotes:\s*\{([\s\S]*?)\n\s{2}\},/.exec(src)?.[1] ?? '';
  for (const kind of QUOTE_KINDS) {
    const m = new RegExp(`${kind}:\\s*\\[([^\\]]*)\\]`, 's').exec(qBlock);
    quotes[kind] = m ? m[1].trim().length > 0 : false;
  }

  return {
    file,
    /** 아직 채우지 않은 자리 — 뼈대만 만들어 두고 잊은 캐릭터를 잡는다 */
    todos: (src.match(/TODO/g) ?? []).length,
    id: first(/\bid:\s*'([^']+)'/, src),
    name: first(/\bname:\s*'([^']+)'/, src),
    realName: first(/realName:\s*'([^']+)'/, src),
    signature: first(/signature:\s*\{\s*\n\s*id:\s*'([^']+)'/, src),
    passive: first(/passive:\s*\{\s*\n\s*type:\s*'([^']+)'/, src),
    moves,
    quotes,
  };
}

/** src/config/characters/ 안의 캐릭터 전부 */
export function readRoster() {
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.ts') && f !== 'index.ts')
    .sort()
    .map(parseCharacter);
}

/** index.ts 의 ROSTER 배열에 실린 순서 */
export function readRosterOrder() {
  const src = readFileSync(`${DIR}/index.ts`, 'utf8');
  const body = /const ROSTER:[^=]*=\s*\[([^\]]*)\]/.exec(src)?.[1] ?? '';
  return body
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** types/index.ts 의 CharacterId 유니온 */
export function readCharacterIds() {
  const src = readFileSync('src/types/index.ts', 'utf8');
  const body = /export type CharacterId =([^;]*);/.exec(src)?.[1] ?? '';
  return [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/** 그림 프롬프트 표(tools/art-characters.mjs)에 실린 id */
export function readArtIds() {
  const src = readFileSync('tools/art-characters.mjs', 'utf8');
  const body = src.slice(src.indexOf('export const CHARACTERS'));
  return [...body.matchAll(/^  ([a-z][a-zA-Z0-9]*):\s*\{/gm)].map((m) => m[1]);
}
