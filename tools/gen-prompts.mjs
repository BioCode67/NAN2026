#!/usr/bin/env node
/**
 * 붙여넣기용 프롬프트 생성기.
 *
 * 나노바나나(또는 다른 이미지 생성기) 웹 화면에 **그대로 붙여넣을** 텍스트를
 * 캐릭터별·배치별로 만들어 파일로 떨군다. API 키가 필요 없다.
 *
 *   npm run prompts              # 5명 전부
 *   npm run prompts -- gates     # 한 명만
 *   npm run prompts -- --print   # 파일 대신 화면에 출력
 *
 * 결과물: art-source/prompts/<key>/00-README.md
 *         art-source/prompts/<key>/1-이동.txt … 7-피격·결과·초상.txt
 *
 * ── 왜 42장을 한 번에 뽑지 않는가 ─────────────────────────────────
 * 한 장에 42칸을 그리라고 하면 뒤로 갈수록 얼굴이 뭉개지고 옷 색이 바뀐다.
 * 6장짜리 가로 띠로 끊으면 일관성이 유지되고, 마음에 안 드는 묶음만
 * 다시 돌릴 수 있다. 배치마다 캐릭터 설명 블록을 통째로 반복하는 것도
 * 같은 이유다 — 생성기는 앞 대화를 기억하지 못한다고 가정해야 안전하다.
 */

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import {
  BATCHES,
  CHARACTERS,
  FRAME_LABELS,
  TOTAL_FRAMES,
  describeFrame,
} from './art-characters.mjs';

const OUT_ROOT = 'art-source/prompts';

/* ------------------------------------------------------------------ */
/* 프롬프트 조립                                                       */
/* ------------------------------------------------------------------ */

/**
 * 받침 유무에 맞는 목적격 조사를 고른다.
 *
 * "일론 머스크을(를)" 같은 표기가 프롬프트에 그대로 들어가면
 * 생성기가 괄호를 글자로 그려 넣는 일이 실제로 있다.
 */
function objectParticle(word) {
  const last = word.trim().slice(-1);
  const code = last.charCodeAt(0);
  // 한글 음절 영역이 아니면 판단할 수 없으므로 '를'로 둔다
  if (code < 0xac00 || code > 0xd7a3) return '를';
  return (code - 0xac00) % 28 === 0 ? '를' : '을';
}

/** 전 배치에 똑같이 들어가는 캐릭터 블록 */
function characterBlock(c) {
  return `[캐릭터] ${c.name}${objectParticle(c.name)} 극단적으로 과장한 SD 도트 게임 캐릭터.
외형: ${c.look}
무기: ${c.weapon}
특징: ${c.wild}`;
}

/** 전 배치에 똑같이 들어가는 스타일 블록 */
const STYLE_BLOCK = `[아트 스타일 — 가장 중요]
- 2~2.5등신. 머리가 몸 전체만큼 크게. 실사 비율 절대 금지
- 표정을 극단적으로 과장할 것 (부릅뜬 눈, 드러낸 이빨, 광기)
- 굵고 진한 검은 외곽선. 어두운 배경에서 실루엣이 확실히 분리될 것
- 채도 높고 대비 강한 색
- 액션 프레임은 만화처럼 과장 (늘어난 팔다리, 스피드선, 임팩트)
- 귀엽고 얌전한 캐리커처가 아니라, 시끄럽고 우스꽝스러운 게임 캐릭터`;

/** 전 배치에 똑같이 들어가는 규격 블록 */
function ruleBlock(count) {
  return `[필수 규칙]
- 배경: 순수 마젠타 #FF00FF 단색. 캐릭터에는 이 색을 절대 쓰지 말 것
- 글자 금지: 프레임 이름/번호/라벨/워터마크를 이미지에 넣지 말 것
- 가로로 1행 ${count}칸. 칸 구분선이나 테두리를 그리지 말 것
- 칸 사이 간격은 캐릭터 폭의 20% 이상 확보
- ${count}장 모두 같은 캐릭터로 보일 것. 옷 색·머리 모양·무기 형태를 칸마다 바꾸지 말 것
- 모든 칸에서 캐릭터가 **오른쪽**을 향할 것
- 모든 칸의 크기·비율 동일, 발끝을 같은 높이에 맞출 것
- 이펙트가 옆 칸을 침범하지 않게 할 것
- 무기를 들지 않은 손은 비워둘 것 (아이템을 쥐는 모션에 쓴다)`;
}

/** 배치 하나의 프롬프트 전문 */
function buildBatchPrompt(c, batch) {
  const frames = batch.keys
    .map((key, i) => `${i + 1}칸 ${FRAME_LABELS[key]}: ${describeFrame(c, key)}`)
    .join('\n');

  /*
   * 1번 배치는 기준이 된다.
   * 2번부터는 1번 결과 이미지를 참조로 함께 넣으라고 안내해야
   * 배치 사이에 캐릭터가 달라지지 않는다.
   */
  const reference =
    batch.id === 1
      ? `\n[중요] 이 묶음이 이 캐릭터의 **기준 그림**이 된다.
마음에 들 때까지 여기서 다시 돌린 뒤 다음 묶음으로 넘어갈 것.`
      : `\n[중요] 1번 묶음(이동)에서 뽑은 이미지를 **참조 이미지로 함께 첨부**할 것.
그 그림과 같은 인물·같은 화풍·같은 옷 색·같은 무기로 그려야 한다.`;

  const fx = batch.keys.some((k) => k.endsWith('Fx'))
    ? `\n[이펙트 칸 주의]
${batch.keys
  .filter((k) => k.endsWith('Fx'))
  .map((k) => `- ${FRAME_LABELS[k]} 칸에는 **캐릭터를 그리지 말 것.** 이펙트만 필요하다`)
  .join('\n')}
이 캐릭터의 이펙트 모티브: ${c.fxTheme}`
    : '';

  return `2D 대전 격투 게임용 스프라이트 시트를 만들어줘.
${c.inGameName}의 "${batch.title}" 묶음 ${batch.keys.length}칸이다.

${characterBlock(c)}

${STYLE_BLOCK}

${ruleBlock(batch.keys.length)}

[동작 방향 규칙 — 게임 조작과 직결된다]
- 위(UP) 계열은 시선·무기·팔이 명확히 위를 향할 것
- 아래(DOWN) 계열은 몸을 확실히 낮추고 무기가 지면 쪽을 향할 것
- 공중(AIR) 계열은 두 발이 지면에서 떨어져 있을 것
- 같은 버튼의 위/아래 동작이 서로 구분되게 자세를 확실히 다르게 그릴 것

[이 묶음의 요령]
${batch.note}
${fx}
[${batch.keys.length}칸, 왼쪽부터 이 순서로]
${frames}
${reference}
`;
}

/* ------------------------------------------------------------------ */
/* 캐릭터별 안내문                                                     */
/* ------------------------------------------------------------------ */

function buildReadme(id, c) {
  const list = BATCHES.map(
    (b) =>
      `| ${b.id} | \`${b.id}-${b.title}.txt\` | ${b.keys
        .map((k) => FRAME_LABELS[k])
        .join(', ')} |`,
  ).join('\n');

  return `# ${c.inGameName} — 스프라이트 프롬프트

총 **${TOTAL_FRAMES}장**을 ${BATCHES.length}개 묶음으로 나눠 뽑는다.

## 순서

1. \`1-이동.txt\` 를 붙여넣어 먼저 뽑는다. **이 결과가 기준 그림이 된다.**
   얼굴·옷·무기가 마음에 들 때까지 여기서 다시 돌린다.
2. 2번부터는 프롬프트를 붙여넣을 때 **1번에서 뽑은 이미지를 참조로 함께 첨부**한다.
   그래야 묶음 사이에 캐릭터가 달라지지 않는다.
3. 나온 이미지를 \`art-source/\` 에 아래 이름으로 저장한다.

\`\`\`
art-source/${c.key}_b1.png    (1번 묶음)
art-source/${c.key}_b2.png    (2번 묶음)
...
art-source/${c.key}_b${BATCHES.length}.png
\`\`\`

4. 전처리 + 합치기는 한 줄로 끝난다.

\`\`\`bash
npm run sheet:merge -- ${c.key}
\`\`\`

## 묶음 목록

| # | 파일 | 프레임 |
|---|---|---|
${list}

## 잘 안 나올 때

| 증상 | 대응 |
|---|---|
| 칸마다 얼굴이 다르다 | 1번 이미지를 참조로 첨부했는지 확인. 안 했으면 반드시 첨부 |
| 배경이 투명/체크무늬로 나온다 | 그래도 괜찮다. 전처리가 세 경우를 모두 처리한다 |
| 칸 구분선이 그려져 나온다 | "칸 구분선을 그리지 말 것"을 한 번 더 강조해 재생성 |
| 글자가 박혀 나온다 | 전처리가 대부분 지우지만, 심하면 재생성이 빠르다 |
| 왼쪽을 보고 있다 | 재생성. 방향이 섞이면 게임에서 좌우 반전이 어긋난다 |
| 칸 수가 다르다 | 재생성. 개수가 맞아야 자동 매핑이 된다 |
`;
}

/* ------------------------------------------------------------------ */

const args = process.argv.slice(2);
const printOnly = args.includes('--print');
const ids = args.filter((a) => !a.startsWith('--'));
const targets = ids.length ? ids : Object.keys(CHARACTERS);

if (!printOnly) rmSync(OUT_ROOT, { recursive: true, force: true });

let written = 0;
for (const id of targets) {
  const c = CHARACTERS[id];
  if (!c) {
    console.error(`알 수 없는 캐릭터: ${id}`);
    process.exitCode = 1;
    continue;
  }

  if (printOnly) {
    for (const batch of BATCHES) {
      console.log(`\n${'='.repeat(64)}`);
      console.log(`${c.inGameName} — ${batch.id}. ${batch.title}`);
      console.log('='.repeat(64));
      console.log(buildBatchPrompt(c, batch));
    }
    continue;
  }

  const dir = `${OUT_ROOT}/${id}`;
  mkdirSync(dir, { recursive: true });

  writeFileSync(`${dir}/00-README.md`, buildReadme(id, c), 'utf8');
  for (const batch of BATCHES) {
    writeFileSync(
      `${dir}/${batch.id}-${batch.title}.txt`,
      buildBatchPrompt(c, batch),
      'utf8',
    );
    written++;
  }
  console.log(`${c.inGameName.padEnd(12)} → ${dir}/ (${BATCHES.length}묶음)`);
}

if (!printOnly && written) {
  console.log(
    `\n프롬프트 ${written}개 생성. 캐릭터당 ${TOTAL_FRAMES}장 / ${BATCHES.length}묶음.\n` +
      `각 폴더의 00-README.md 에 순서가 적혀 있습니다.`,
  );
}
