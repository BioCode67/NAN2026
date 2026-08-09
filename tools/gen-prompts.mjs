#!/usr/bin/env node
/**
 * 붙여넣기용 프롬프트 생성기.
 *
 * 나노바나나(또는 다른 이미지 생성기) 웹 화면에 **그대로 붙여넣을** 텍스트를
 * 캐릭터별·배치별로 만들어 파일로 떨군다. API 키가 필요 없다.
 *
 *   npm run prompts              # 캐릭터 5명 + 스테이지·UI 전부
 *   npm run prompts -- gates     # 한 명만
 *   npm run prompts -- scenes    # 스테이지·UI만
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
import { BG_RULES, STAGES, UI_ARTS, WORLD, WORLD_FLAVOR } from './art-scenes.mjs';

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
- 귀엽고 얌전한 캐리커처가 아니라, 시끄럽고 우스꽝스러운 게임 캐릭터
- **판에 나설 차림이어야 한다.** 스웨터·티셔츠·정장 같은 평상복을 그대로
  입히지 말 것 — 갑옷·망토·예복·전투복처럼 "싸우러 나온 사람"으로 보일 것.
  다만 그 인물을 알아보게 하는 것(머리 모양·안경·수염·종족·상징색)은
  반드시 남긴다. **사람을 바꾸는 게 아니라 옷만 갈아입힌다**`;

/** 전 배치에 똑같이 들어가는 규격 블록 */
function ruleBlock(count) {
  return `[필수 규칙]
- 배경: 순수 마젠타 #FF00FF 단색. 캐릭터에는 이 색을 절대 쓰지 말 것
- 글자 금지: 프레임 이름/번호/라벨/워터마크를 이미지에 넣지 말 것
- **정확히 ${count}칸**, 가로로 한 줄. ${count + 1}칸을 그리면 하나를 버려야 한다
- 칸 구분선이나 테두리를 그리지 말 것
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
/* 스테이지 · UI 프롬프트                                              */
/* ------------------------------------------------------------------ */

function buildStagePrompt(stage) {
  return `2D 대난투 게임의 스테이지 배경을 그려줘.
"${stage.name}" — ${stage.when}

${WORLD_FLAVOR}

[장면]
${stage.desc}

[색]
${stage.palette}

${BG_RULES}

[크기] ${WORLD.width}x${WORLD.height} 픽셀 (가로로 매우 긴 그림)
`;
}

function buildUiPrompt(art) {
  return `2D 대난투 게임의 ${art.name}을 그려줘.

${WORLD_FLAVOR}

[내용]
${art.desc}

[크기] ${art.size}

[필수 규칙]
${art.rules}
- 두껍고 진한 검은 외곽선, 채도 높은 색
- 사진 같은 사실주의 금지. 픽셀아트풍 또는 만화풍
`;
}

/** 스테이지·UI 전체 안내문 */
function buildSceneReadme() {
  const stageRows = STAGES.map(
    (st) => `| \`${st.id}-${st.name}.txt\` | \`public/bg/${st.key}.png\` | ${st.when} |`,
  ).join('\n');

  const uiRows = UI_ARTS.map(
    (a) => `| \`${a.id}-${a.name}.txt\` | \`public/ui/${a.key}.png\` | ${a.name} |`,
  ).join('\n');

  return `# 스테이지 · UI 프롬프트

캐릭터가 아닌 그림들이다. 캐릭터 시트와 달리 **한 장씩 독립**이라
아무 순서로 뽑아도 되고, 마음에 안 드는 것만 다시 돌리면 된다.

## 스테이지 배경

맵 기믹과 짝지어 두었다. "달로 보내줘"를 입력하면 물리만 바뀌는 게 아니라
배경까지 달 표면으로 갈린다 — 말과 그림이 따로 놀지 않게 하기 위해서다.

| 프롬프트 | 저장 위치 | 언제 보이나 |
|---|---|---|
${stageRows}

## UI

| 프롬프트 | 저장 위치 | 용도 |
|---|---|---|
${uiRows}

## 공통 주의

- 배경에는 **캐릭터를 그리지 말 것.** 캐릭터는 게임이 위에 올린다
- 배경 가운데와 아래는 비워 둘 것 — 전투가 벌어지는 자리다
- 전체적으로 어둡게. 밝은 캐릭터가 위에 올라가야 대비로 살아난다
- 아이콘·오브는 **투명 배경**이 필요하다. 안 되면 순수 마젠타(#FF00FF)로

## 받은 뒤

**전처리가 필요 없다.** 위 표의 경로에 그대로 저장하고 새로고침하면 끝이다.
캐릭터 시트와 달리 스테이지·UI 그림은 게임이 직접 읽는다.

- 크기는 아무래도 좋다. 배경은 비율을 지킨 채 화면을 덮도록 맞춰지고,
  로고는 화면을 넘으면 줄어든다
- 아이콘·오브처럼 여러 칸이 든 띠는 게임이 **가로로 똑같이 나눠** 쓴다
  (6칸 / 4칸). 그래서 해상도가 얼마든 상관없다
- 마젠타(#FF00FF) 배경으로 왔으면 게임이 **자동으로 지운다.**
  손으로 누끼를 딸 필요 없다

한 장도 없어도 게임은 그대로 돈다 — 없는 그림 자리는 코드로 그린 화면이
대신한다. 그러니 마음에 드는 것부터 한 장씩 넣어 가며 확인하면 된다.

\`\`\`bash
mkdir -p public/bg public/ui   # 처음 한 번만
npm run dev                    # 그림을 넣고 새로고침
\`\`\`

## 손으로 안 하고 한 번에

여는 것부터 옮기는 것까지가 한 장에 여섯 단계다. API 키가 있으면 넘길 수 있다.

\`\`\`bash
cp .env.example .env.local       # GEMINI_API_KEY 를 채운다
npm run art                      # 이 폴더의 프롬프트로 11장을 만들어 제자리에 저장
npm run art -- exchange --force  # 마음에 안 드는 한 장만 다시
\`\`\`

키를 안 쓰겠다면(생성은 웹이 공짜다), 나머지를 전부 넘길 수 있다.

\`\`\`bash
npm run art:in                   # 순서대로 하나씩
\`\`\`

**Ctrl+V → 받기.** 그게 전부다.
프롬프트가 클립보드에 들어와 있고, 받은 그림은 알아서 제자리로 간다.
다음 프롬프트도 알아서 클립보드에 채워진다 — 이 폴더를 열 일이 없다.
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
// 'scenes' 는 캐릭터가 아니라 스테이지·UI 묶음을 가리키는 이름이다
const targets = (ids.length ? ids : Object.keys(CHARACTERS)).filter(
  (t) => t !== 'scenes',
);

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

/* --- 스테이지 · UI ------------------------------------------------- */

if (!ids.length || ids.includes('scenes')) {
  if (printOnly) {
    for (const st of STAGES) {
      console.log(`\n${'='.repeat(64)}\n스테이지 — ${st.name}\n${'='.repeat(64)}`);
      console.log(buildStagePrompt(st));
    }
    for (const a of UI_ARTS) {
      console.log(`\n${'='.repeat(64)}\nUI — ${a.name}\n${'='.repeat(64)}`);
      console.log(buildUiPrompt(a));
    }
  } else {
    const dir = `${OUT_ROOT}/scenes`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/00-README.md`, buildSceneReadme(), 'utf8');

    for (const st of STAGES) {
      writeFileSync(`${dir}/${st.id}-${st.name}.txt`, buildStagePrompt(st), 'utf8');
      written++;
    }
    for (const a of UI_ARTS) {
      writeFileSync(`${dir}/${a.id}-${a.name}.txt`, buildUiPrompt(a), 'utf8');
      written++;
    }
    console.log(
      `스테이지·UI      → ${dir}/ (${STAGES.length + UI_ARTS.length}장)`,
    );
  }
}

/* --- 전체 계획서 ---------------------------------------------------- */

/**
 * 폴더가 스물한 개가 되면 "어디부터 손대야 하나"가 첫 번째 문제가 된다.
 * 캐릭터별 안내서는 그 캐릭터 안에서의 순서만 알려주므로,
 * 로스터 전체를 놓고 보는 순서표를 맨 위에 한 장 둔다.
 */
function buildPlan(list) {
  const rows = list
    .map(([id, c], i) => `| ${i + 1} | ${c.inGameName} | \`${id}\` | \`${c.key}\` |`)
    .join('\n');

  return `# 그림 작업 순서표

캐릭터 ${list.length}명 x ${BATCHES.length}묶음 = **${list.length * BATCHES.length}장**.
다 뽑는 것을 목표로 잡으면 끝나지 않는다. 아래 순서로 잘라 간다.

## 1단계 — 핵심 3묶음만 (한 명당 3장)

먼저 전원에게 **1 · 3 · 7 묶음**만 뽑는다.

| 묶음 | 내용 | 왜 먼저인가 |
|---|---|---|
| 1 | 이동 (대기·걷기·달리기·대시) | 캐릭터가 화면에 있는 시간의 대부분이다 |
| 3 | 지상 연속기 (J·J2·J3·K·K2·대시공격) | 가장 많이 누르는 버튼들이다 |
| 7 | 피격·결과·초상 | 초상은 HUD와 선택 화면에 늘 떠 있다 |

이 셋만 있으면 **18칸 시트**가 되고, 그대로 게임에 들어간다.
빠진 묶음의 포즈는 비슷한 그림으로 대체되므로 깨지지 않는다.

\`\`\`bash
# 1·3·7 만 저장한 뒤 그대로 합치면 된다
npm run sheet:merge -- <key>
\`\`\`

전원 1단계까지가 ${list.length * 3}장. 여기까지가 "스무 명이 다 그림으로 나오는" 상태다.

## 2단계 — 자주 고르는 대여섯 명에 4묶음을 더한다

**4(방향 커맨드·방어)** 를 먼저 얹는다. 이 묶음이 W+J / S+J / W+K / S+K —
상단기와 하단기의 그림이다. 이게 없으면 커맨드를 여섯 개 눌러도 나오는 그림이
둘뿐이라, "공격이 다 비슷하다"는 인상이 그대로 남는다.
게임 쪽에서 아무리 몸을 다르게 움직여도 원본 그림이 같으면 한계가 있다.

주력 대여섯 명에 **1·3·4·7** 네 묶음(한 명당 4장)이면
지상 커맨드 열 개가 전부 다른 그림으로 나간다.

## 3단계 — 나머지를 채운다

2(공중) → 5(스킬) → 6(아이템·도발) 순.
묶음 하나를 추가로 뽑아 같은 자리에 저장하고 다시 합치기만 하면,
게임 쪽은 손댈 것 없이 그 포즈가 자동으로 살아난다.

## 4단계 — 마음에 안 드는 묶음만 다시

묶음이 곧 시트의 한 줄이라, 다시 뽑은 묶음만 그 줄이 갈린다.
전체를 다시 뽑을 일은 없다.

---

## 캐릭터 목록

| # | 이름 | 폴더 | 저장 이름(key) |
|---|---|---|---|
${rows}

스테이지·UI 는 \`scenes/\` 에 따로 있다 (한 장씩 독립).

## 한 장을 뽑을 때마다

1. 해당 폴더의 \`1-이동.txt\` 부터 순서대로 붙여넣는다
2. **2번 묶음부터는 1번에서 나온 이미지를 참조로 함께 첨부한다**
   (안 하면 묶음마다 얼굴과 옷 색이 달라진다)
3. \`art-source/<key>_b<번호>.png\` 로 저장한다
4. \`npm run sheet:merge -- <key>\`
`;
}

if (!printOnly && !ids.length) {
  const list = Object.entries(CHARACTERS);
  writeFileSync(`${OUT_ROOT}/00-README.md`, buildPlan(list), 'utf8');
  console.log(`계획서           → ${OUT_ROOT}/00-README.md`);
}

if (!printOnly && written) {
  console.log(
    `\n프롬프트 ${written}개 생성.\n` +
      `  캐릭터: ${TOTAL_FRAMES}장 / ${BATCHES.length}묶음씩\n` +
      `  스테이지·UI: ${STAGES.length + UI_ARTS.length}장 (한 장씩 독립)\n` +
      `각 폴더의 00-README.md 에 순서와 저장 위치가 적혀 있습니다.`,
  );
}
