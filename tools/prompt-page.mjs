#!/usr/bin/env node
/**
 * 붙여넣기용 프롬프트를 **한 장짜리 웹 문서**로 묶는다.
 *
 *   npm run art:md
 *
 * ── 왜 필요한가 ────────────────────────────────────────────────────
 * 프롬프트는 이미 캐릭터별 폴더에 .txt 로 있다. 그런데 스물한 개 폴더에
 * 백마흔 개 파일이라, 그림을 뽑으려면 **어디부터 열어야 하는지 찾는 일**이
 * 먼저 온다. 폴더를 뒤지는 것이 귀찮아서 작업이 멈춘다면 그건 도구의 잘못이다.
 *
 * 그래서 묶음(배치) 단위로 한 장씩 만든다. GitHub 웹에서 문서를 열면
 * 코드 블록마다 **복사 단추**가 붙으므로, 파일을 내려받거나 폴더를 들어갈
 * 필요 없이 위에서부터 복사 → 붙여넣기 → 다음, 으로 진행된다.
 * 휴대폰에서도 된다.
 *
 * ── 이미 끝난 사람은 빼고 보여준다 ──────────────────────────────────
 * 시트가 만들어진 캐릭터는 `public/sprites/<key>.json` 의 `batches` 에
 * 어떤 묶음이 들어 있는지가 적혀 있다. 그것을 읽어 끝난 칸은 목록에서
 * 빼고 진행표에만 남긴다. "남은 것만" 보이는 목록이라야 끝이 보인다.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { BATCHES, CHARACTERS } from './art-characters.mjs';

const SRC = 'art-source/prompts';
const OUT = 'art-source/prompts/복사용';

/**
 * 파일 이름 — 띄어쓰기와 가운뎃점을 뺀다.
 *
 * 주소창에서 %20 · %C2%B7 로 부풀어 링크가 읽히지 않고, 휴대폰에서 주소를
 * 손으로 넘길 때도 걸린다. 문서 안 제목은 원래 이름 그대로 둔다.
 */
const fileName = (batch) => `${batch.id}묶음-${batch.title.replace(/[\s·]/g, '')}.md`;

/* ------------------------------------------------------------------ */
/* 진행 상황 — 시트 JSON 이 유일한 근거                                */
/* ------------------------------------------------------------------ */

/**
 * 이 캐릭터가 끝낸 묶음 번호들.
 *
 * `batches` 가 없는 시트는 묶음을 나누기 전에 만든 옛 시트라 전부 끝난 것으로
 * 본다 — 실제로 15칸 시트 하나로 게임이 돌아가고 있다.
 */
function doneBatches(key) {
  const path = `public/sprites/${key}.json`;
  if (!existsSync(path)) return [];
  try {
    const meta = JSON.parse(readFileSync(path, 'utf8'));
    return Array.isArray(meta.batches) ? meta.batches : BATCHES.map((b) => b.id);
  } catch {
    return [];
  }
}

/** 프롬프트 전문 — gen-prompts 가 떨궈 둔 .txt 를 그대로 읽는다 */
function promptText(id, batch) {
  const path = `${SRC}/${id}/${batch.id}-${batch.title}.txt`;
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8').trimEnd();
}

/* ------------------------------------------------------------------ */
/* 문서 조립                                                           */
/* ------------------------------------------------------------------ */

const HOWTO = `**쓰는 법**

1. 아래 회색 상자 오른쪽 위의 복사 단추를 누른다
2. 그림 생성기(나노바나나 등)에 붙여넣고 돌린다
3. 마음에 들면 **PNG 로, 가로 3000px 이상** 내려받는다
4. 상자 위에 적힌 이름 그대로 \`art-source/\` 에 올린다 (이름을 바꾸지 않는다)

> 이름을 그대로 두는 것이 중요하다. \`머스크_b1.png\` 같은 이름이 곧
> "누구의 몇 번째 묶음인지"라서, 도구가 그것만 보고 알아서 잘라 붙인다.`;

/** 묶음 한 장 */
function buildBatchPage(batch, rows) {
  const todo = rows.filter((r) => !r.done);
  const done = rows.filter((r) => r.done);

  const body = todo
    .map((r, i) => {
      const text = promptText(r.id, batch);
      if (!text) return `## ${i + 1}. ${r.c.inGameName}\n\n_프롬프트 파일이 없습니다 — \`npm run prompts\` 를 먼저 돌려 주세요._`;
      return [
        `## ${i + 1}. ${r.c.inGameName}`,
        '',
        `받은 파일 이름 → **\`${r.c.key}_b${batch.id}.png\`**`,
        '',
        '```text',
        text,
        '```',
        '',
        '<sub>[▲ 맨 위로](#top)</sub>',
      ].join('\n');
    })
    .join('\n\n---\n\n');

  const doneLine = done.length
    ? `\n끝난 사람 (${done.length}명): ${done.map((r) => r.c.inGameName).join(' · ')}\n`
    : '';

  return `<a id="top"></a>

# ${batch.id}묶음 · ${batch.title}

${batch.keys.length}칸짜리 가로 띠. **남은 ${todo.length}명**의 프롬프트가 아래에 순서대로 있습니다.

> ${batch.note}
${doneLine}
${HOWTO}

---

${body || '_이 묶음은 모두 끝났습니다._'}
`;
}

/** 표지 — 진행표와 링크 */
function buildIndex(list) {
  const head = `| 캐릭터 | ${BATCHES.map((b) => b.id).join(' | ')} |`;
  const sep = `|---|${BATCHES.map(() => ':-:').join('|')}|`;
  const rows = list
    .map(({ c, done }) => {
      const cells = BATCHES.map((b) => (done.includes(b.id) ? '✅' : '·')).join(' | ');
      return `| ${c.inGameName} | ${cells} |`;
    })
    .join('\n');

  const total = list.length * BATCHES.length;
  const finished = list.reduce((n, r) => n + r.done.length, 0);

  const links = BATCHES.map((b) => {
    const left = list.filter((r) => !r.done.includes(b.id)).length;
    return `| [${b.id}. ${b.title}](${encodeURIComponent(fileName(b))}) | ${left}명 | ${b.note} |`;
  }).join('\n');

  return `# 프롬프트 — 복사해서 바로 쓰는 판

폴더를 뒤질 필요 없이, 아래 문서를 열고 위에서부터 복사만 하면 됩니다.
GitHub 웹에서 열면 회색 상자마다 복사 단추가 붙습니다. 휴대폰에서도 됩니다.

**진행: ${finished} / ${total}칸**

## 어느 순서로 뽑는 것이 좋은가

1묶음(이동)을 **모든 캐릭터에 대해 먼저** 끝내는 편이 낫습니다. 1묶음 결과가
그 캐릭터의 기준 그림이 되고, 2묶음부터는 그것을 참조 이미지로 함께 넣어야
같은 인물로 나옵니다. 그리고 게임에 넣었을 때 체감이 가장 크게 바뀌는 것이
1(이동) → 3(지상 연속기) → 7(피격·결과·초상) 순서입니다.

| 묶음 | 남은 사람 | 이 묶음의 요령 |
|---|---|---|
${links}

## 누가 어디까지 되어 있나

${head}
${sep}
${rows}

---

${HOWTO}

## 자주 나는 문제

| 증상 | 원인과 대처 |
|---|---|
| 올렸는데 아무 일도 안 일어난다 | 파일 이름이 \`<key>_b<번호>.png\` 인지 확인. JPG 로 받았다면 \`npm run art:jpg\` |
| 잘라낸 그림에 분홍 테두리가 남는다 | JPG 로 받은 경우입니다. PNG 로 다시 받는 것이 가장 깨끗합니다 |
| 게임에서 뭉개져 보인다 | 가로 3000px 이상으로 받아 주세요 (칸당 500px) |
| 칸 수가 다르게 나왔다 | 다시 돌립니다. 개수가 맞아야 자동으로 붙습니다 |

_이 문서는 \`npm run art:md\` 가 만듭니다. 손으로 고치지 마세요._
`;
}

/* ------------------------------------------------------------------ */

const list = Object.entries(CHARACTERS).map(([id, c]) => ({
  id,
  c,
  done: doneBatches(c.key),
}));

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

writeFileSync(`${OUT}/README.md`, buildIndex(list), 'utf8');

for (const batch of BATCHES) {
  const rows = list.map((r) => ({ ...r, done: r.done.includes(batch.id) }));
  const file = `${OUT}/${fileName(batch)}`;
  writeFileSync(file, buildBatchPage(batch, rows), 'utf8');
  const left = rows.filter((r) => !r.done).length;
  console.log(`  ${batch.id}. ${batch.title.padEnd(12)} 남은 ${String(left).padStart(2)}명 → ${file}`);
}

const total = list.length * BATCHES.length;
const finished = list.reduce((n, r) => n + r.done.length, 0);
console.log(`\n진행 ${finished}/${total}칸 — 표지: ${OUT}/README.md`);
