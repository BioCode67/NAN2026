#!/usr/bin/env node
/**
 * 캐릭터 뼈대를 만든다.
 *
 *   npm run char:new -- crypto "코인 형님" "Crypto Bro" shares
 *                       └id     └게임 내 이름  └실존 인물   └고유 메커니즘(선택)
 *
 * ── 왜 필요한가 ────────────────────────────────────────────────────
 * 캐릭터 하나를 넣으려면 네 군데를 손대야 한다.
 *   1. src/config/characters/<id>.ts   (본체)
 *   2. src/types/index.ts              (CharacterId 유니온)
 *   3. src/config/characters/index.ts  (import + ROSTER)
 *   4. tools/art-characters.mjs        (그림 프롬프트 표)
 * 다섯 명일 때는 손으로 해도 됐다. 스무 명이면 예순 번을 손으로 하게 되고,
 * 그중 한 번은 반드시 빠뜨린다. 빠뜨리면 타입 검사는 통과하고 게임에서 터진다.
 *
 * 이 도구는 네 군데를 한 번에 채우고, 사람이 할 일만 TODO로 남긴다.
 * 남는 일은 "이 인물이라면 어떻게 싸울까" — 그것만 사람 몫이다.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const [id, name, realName, mech = 'shares'] = process.argv.slice(2);

if (!id || !name || !realName) {
  console.error(
    '사용법: npm run char:new -- <id> "<게임 내 이름>" "<실존 인물>" [고유메커니즘]\n' +
      '  예:   npm run char:new -- crypto "코인 형님" "Crypto Bro" balloon\n\n' +
      '고유 메커니즘 (src/config/aiPersona.ts 에 있는 것 중 하나):\n' +
      '  shares        때릴수록 쌓였다가 스킬로 터진다\n' +
      '  oneMoreThing  스킬이 맞으면 곧바로 한 번 더\n' +
      '  booster       자원을 태워 공중에서도 대시\n' +
      '  fork          막아서 훔친 기술을 되돌려준다\n' +
      '  balloon       때려서 기동력을 벌고, 맞으면 잃는다',
  );
  process.exit(1);
}

if (!/^[a-z][a-z0-9]*$/.test(id)) {
  console.error('id 는 소문자와 숫자로만 (예: crypto, musk2)');
  process.exit(1);
}

const CHAR_FILE = `src/config/characters/${id}.ts`;
if (existsSync(CHAR_FILE)) {
  console.error(`${CHAR_FILE} 이 이미 있습니다.`);
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* 1. 본체                                                             */
/* ------------------------------------------------------------------ */

/**
 * 기술 뼈대.
 *
 * 수치는 MOVE_TEMPLATES 의 기본값을 쓰므로 여기서는 이름만 정하면 된다.
 * 이름을 TODO로 남기되 슬롯마다 다르게 둔다 — 같은 이름이 두 개면
 * npm run test:char 가 잡아내므로, 채우기 전에는 검사가 통과하지 않는다.
 * "일단 넣고 나중에" 를 막는 장치다.
 */
const MOVES = [
  ['light', '잽', '가볍게 툭 치는 견제. 연속기의 시작'],
  ['light2', '2타', '잽에서 이어지는 두 번째'],
  ['light3', '3타', '연속기 마무리. 크게 날린다'],
  ['heavy', '강공격', '묵직한 한 방'],
  ['heavy2', '강2타', '강공격에서 이어지는 마무리'],
  ['dashAttack', '돌진', '달리던 기세로 들이받는다'],
  ['lightUp', '상단 약', '위로 쳐올린다'],
  ['lightDown', '하단 약', '몸을 낮춰 발밑을 친다'],
  ['heavyUp', '상단 강', '함께 솟구치며 쳐올린다'],
  ['heavyDown', '하단 강', '내려찍는다. 지상 광역기'],
  ['airLight', '공중 약', '공중에서 가볍게'],
  ['airHeavy', '공중 강', '공중에서 묵직하게'],
  ['airDive', '급강하', '공중에서 앞아래로 처박는다'],
  ['skill', '스킬', '이 캐릭터를 상징하는 한 방'],
];

const moveLines = MOVES.map(
  ([slot, label, hint]) =>
    `      // TODO ${hint}\n      ${slot}: { name: 'TODO ${label}' },`,
).join('\n\n');

writeFileSync(
  CHAR_FILE,
  `import { moveSet } from '../gameConfig';
import type { CharacterConfig } from '../../types';

/** ${name} — TODO 한 줄 소개 */
export const ${id}: CharacterConfig = {
  id: '${id}',
  name: '${name}',
  realName: '${realName}',
  tagline: 'TODO 이 인물을 한 줄로 요약하는 대사',
  colors: { body: 0x4b5563, head: 0xf1c9a5, accent: 0x9ca3af },
  stats: { speed: 250, jump: -700, doubleJump: -620, weight: 1 },

  /* 시트가 없을 때 쓰는 도형 아트 */
  art: {
    hair: 'short',
    hairColor: 0x3b2f2f,
    glasses: 'none',
    glassesColor: 0x000000,
    beard: false,
    beardColor: 0x000000,
    mouth: 'smile',
    eyes: 'dot',
  },

  passive: {
    type: 'absorb_flat',
    name: 'TODO 패시브 이름',
    desc: 'TODO 무엇이 늘 유리한가',
    absorbRatio: 1.2,
  },

  /*
   * 고유 메커니즘 — 조작 방식 자체가 달라지는 부분.
   * id 는 이미 구현된 것 중에서 고른다(BaseCharacter가 이 값으로 분기한다).
   * 이름·설명·숫자만 이 인물답게 갈아 끼우면 된다.
   */
  signature: {
    id: '${mech}',
    name: 'TODO 고유 메커니즘 이름',
    desc: 'TODO 무엇이 쌓이고 무엇으로 터지는가',
    how: 'TODO 어떻게 쓰는 캐릭터인가',
    max: 3,
    icon: '⭐',
    color: 0x9ca3af,
  },

  /*
   * 기술 이름이 이 게임의 정체성이다.
   * 수치보다 먼저 정할 것 — "${realName} 라면 이 상황에서 뭘 할까".
   */
  moves: moveSet({
${moveLines}
  }),

  quotes: {
    intro: ['TODO 등장'],
    skill: ['TODO 스킬 시전'],
    ko: ['TODO 상대를 쓰러뜨렸을 때'],
    surge: ['TODO 주가가 치솟을 때'],
    comeback: ['TODO 위기에서 반격할 때'],
    hurt: ['TODO 맞았을 때'],
  },
};
`,
  'utf8',
);

/* ------------------------------------------------------------------ */
/* 2~4. 명단 세 곳에 끼워 넣기                                          */
/* ------------------------------------------------------------------ */

const patch = (file, find, replace, label) => {
  const src = readFileSync(file, 'utf8');
  if (!src.includes(find)) {
    console.error(`  ! ${file} 에서 끼울 자리를 못 찾았습니다 — 손으로 넣어 주세요 (${label})`);
    return false;
  }
  writeFileSync(file, src.replace(find, replace), 'utf8');
  return true;
};

/* CharacterId 유니온 */
{
  const src = readFileSync('src/types/index.ts', 'utf8');
  const line = /export type CharacterId =[^;]*;/.exec(src)?.[0];
  if (line && !line.includes(`'${id}'`)) {
    writeFileSync(
      'src/types/index.ts',
      src.replace(line, line.replace(/;$/, ` | '${id}';`)),
      'utf8',
    );
  }
}

/* ROSTER */
patch(
  'src/config/characters/index.ts',
  "import type { CharacterConfig, CharacterId } from '../../types';",
  `import type { CharacterConfig, CharacterId } from '../../types';\nimport { ${id} } from './${id}';`,
  'import',
);
{
  const f = 'src/config/characters/index.ts';
  const src = readFileSync(f, 'utf8');
  const m = /const ROSTER: CharacterConfig\[\] = \[([^\]]*)\];/.exec(src);
  if (m) {
    const list = m[1].trim().replace(/,$/, '');
    writeFileSync(
      f,
      src.replace(m[0], `const ROSTER: CharacterConfig[] = [${list}, ${id}];`),
      'utf8',
    );
  }
}

/* 그림 프롬프트 표 */
patch(
  'tools/art-characters.mjs',
  'export const CHARACTERS = {',
  `export const CHARACTERS = {
  ${id}: {
    key: '${id}',
    name: '${realName}',
    inGameName: '${name}',
    look: 'TODO 옷·머리·안경 등 첫눈에 알아볼 특징',
    weapon: 'TODO 손에 든 것 — 이 인물을 상징하는 물건',
    wild: 'TODO 과장 포인트. 우스꽝스러울수록 좋다',
    /** 이 캐릭터의 이펙트 색·모티브 — FX 프레임에 쓴다 */
    fxTheme: 'TODO 이펙트 색과 모티브',

    frames: {},
  },
`,
  '그림표',
);

/* ------------------------------------------------------------------ */

console.log(`${name} 뼈대를 만들었습니다.

  ${CHAR_FILE}                     본체 (TODO를 채우세요)
  src/types/index.ts                 CharacterId 에 '${id}' 추가됨
  src/config/characters/index.ts     ROSTER 에 추가됨
  tools/art-characters.mjs           그림표에 추가됨 (frames 는 비어 있습니다)

다음:
  1. ${CHAR_FILE} 의 TODO 를 채운다 — 기술 이름이 이 게임의 정체성이다
  2. tools/art-characters.mjs 의 ${id}.frames 를 채운다 (gates 를 본뜨면 된다)
  3. npm run test:char     빠진 것이 있으면 여기서 잡힌다
  4. npm run prompts       그림 프롬프트 7묶음이 생긴다
`);
