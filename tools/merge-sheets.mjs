#!/usr/bin/env node
/**
 * 배치 이미지 여러 장을 시트 한 장으로 합친다.
 *
 * gen-prompts.mjs 는 54장을 9묶음으로 나눠 뽑게 한다. 그렇게 받은 가로 띠
 * 여러 장을 게임이 쓰는 균일 격자 시트 하나로 만드는 것이 이 도구다.
 *
 *   npm run sheet:merge -- elonmusk
 *   npm run sheet:merge -- elonmusk --cols 6
 *
 * 입력: art-source/<key>_b1.png … _b9.png
 * 출력: public/sprites/<key>.png + <key>.json
 *
 * ── 왜 process-sheet 를 그대로 쓰지 않는가 ────────────────────────
 * process-sheet 는 "한 이미지 → 한 시트"다. 여기서는 여러 이미지를 순서대로
 * 이어 붙여야 하고, 묶음마다 캐릭터 크기가 미묘하게 다르게 나온다.
 * 그래서 묶음별 전처리는 process-sheet 에 맡기고, 이 도구는
 * **크기 정규화 + 이어 붙이기**만 한다. 책임이 겹치지 않는다.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PNG } from 'pngjs';

/**
 * 묶음 총 개수.
 *
 * spriteSheets.ts 의 TOTAL_BATCHES · art-characters.mjs 의 BATCHES 와 같아야 한다.
 * 여기만 뒤처지면 새로 뽑은 8·9묶음이 조용히 무시된다 — 올렸는데 아무 일도
 * 안 일어나고, 이유는 화면 어디에도 안 나온다.
 */
const TOTAL_BATCHES = 9;

/** 최종 시트의 열 수 — 42장이면 7행 x 6열이 된다 */
const DEFAULT_COLS = 6;
/** 배치 최대 개수 (찾을 파일 범위) */
const MAX_BATCH = 12;
/** 전처리 중간 산출물을 두는 곳 */
const TMP = 'art-source/.merge';

/* ------------------------------------------------------------------ */

const args = process.argv.slice(2);
const key = args.find((a) => !a.startsWith('--'));
const colsArg = args.indexOf('--cols');
const COLS = colsArg >= 0 ? Number(args[colsArg + 1]) : DEFAULT_COLS;

/**
 * 묶음 한 장을 어떤 격자로 자를 것인가 (--grid 6x1, 끄려면 --no-grid).
 *
 * ── 왜 기본으로 격자를 쓰는가 ────────────────────────────────────
 * 자동 검출은 "덩어리를 찾아 칸으로 묶는" 방식이라 그림에 따라 무너진다.
 * 실제로 워런 버피 묶음에서 6칸짜리가 3개·22개·4개로 잡혔다 — 이펙트가
 * 옆 칸까지 번지면 두 칸이 한 덩어리가 되고, 반대로 지폐가 흩날리면
 * 한 칸이 여러 덩어리로 부서진다.
 *
 * 그런데 **묶음은 정의상 6칸 한 줄**이다. 프롬프트에 그렇게 적어서 시켰다.
 * 아는 것을 굳이 추측하게 두면 그림이 멀쩡한데도 포즈가 밀린다.
 */
const gridIdx = args.indexOf('--grid');
const GRID = args.includes('--no-grid') ? null : gridIdx >= 0 ? args[gridIdx + 1] : '6x1';

if (!key) {
  console.error(
    '사용법: node tools/merge-sheets.mjs <key> [--cols 6] [--grid 6x1] [--no-grid]\n' +
      '  예: node tools/merge-sheets.mjs elonmusk\n' +
      '  입력 파일: art-source/<key>_b1.png, _b2.png, …',
  );
  process.exit(1);
}

/* --- 1. 배치 파일 찾기 --------------------------------------------- */

const inputs = [];
for (let i = 1; i <= MAX_BATCH; i++) {
  const path = `art-source/${key}_b${i}.png`;
  if (existsSync(path)) inputs.push({ index: i, path });
}

if (!inputs.length) {
  console.error(
    `art-source/${key}_b1.png 같은 배치 파일을 찾지 못했습니다.\n` +
      `프롬프트로 뽑은 이미지를 그 이름으로 저장했는지 확인하세요.\n` +
      `(안내: art-source/prompts/<캐릭터>/00-README.md)`,
  );
  process.exit(1);
}

/*
 * 묶음이 빠져 있어도 합친다.
 *
 * 예전에는 빠진 번호가 있으면 거부했다. 순서가 밀려 엉뚱한 칸에 매핑되기
 * 때문인데, 이제는 **어느 묶음이 들어 있는지를 메타에 적어 보내므로**
 * 게임 쪽이 정확한 자리를 안다(spriteSheets.ts buildV3Layout).
 *
 * 캐릭터 스무 명 × 7묶음 = 140장을 다 뽑는 것은 현실적이지 않다.
 * 1(이동)·3(연속기)·7(피격·결과·초상) 세 묶음만 있어도 늘 화면에 보이는
 * 그림은 전부 채워지고, 나머지는 포즈 대체 사슬이 메운다. 60장으로
 * 스무 명을 채울 수 있는 길을 막아 둘 이유가 없다.
 */
const missing = [];
for (let i = 1; i <= TOTAL_BATCHES; i++) {
  if (!inputs.some((f) => f.index === i)) missing.push(i);
}

console.log(`배치 ${inputs.length}개 발견: ${inputs.map((f) => `b${f.index}`).join(', ')}`);
if (missing.length) {
  console.log(`  (빠진 묶음: ${missing.map((i) => `b${i}`).join(', ')} — 해당 포즈는 대체 그림으로 나갑니다)`);
}

/* --- 2. 배치별 전처리 (배경 제거 + 균일 격자화) ---------------------- */

rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

const parts = [];
for (const f of inputs) {
  const out = `${TMP}/${key}_b${f.index}.png`;
  console.log(`\n[b${f.index}] 전처리…`);

  const r = spawnSync(
    process.execPath,
    [
      'tools/process-sheet.mjs',
      f.path,
      out,
      ...(GRID ? ['--grid', GRID] : []),
      /*
       * 가장자리 번짐 제거는 여기서만 켠다.
       *
       * 새 묶음은 "캐릭터에 배경색을 절대 쓰지 말 것"이라는 조건으로 뽑으므로,
       * 배경색 쪽으로 치우친 가장자리는 정의상 전부 번짐이다.
       * (먼저 만든 시트 다섯 장은 그 조건 없이 뽑아서 이 규칙이 안 맞는다)
       */
      '--defringe',
    ],
    { stdio: 'inherit' },
  );
  if (r.status !== 0) {
    console.error(`b${f.index} 전처리에 실패했습니다.`);
    process.exit(1);
  }

  const png = PNG.sync.read(readFileSync(out));
  const meta = JSON.parse(readFileSync(out.replace(/\.png$/, '.json'), 'utf8'));
  parts.push({ index: f.index, png, meta });
}

/* --- 3. 크기 정규화 기준 정하기 ------------------------------------- */

/*
 * 묶음마다 캐릭터가 조금씩 크게/작게 나온다. 그대로 이어 붙이면
 * 걷다가 갑자기 커지는 시트가 된다. 가장 큰 칸에 맞춰 전부 맞춘다.
 */
const cellW = Math.max(...parts.map((p) => p.meta.frameWidth));
const cellH = Math.max(...parts.map((p) => p.meta.frameHeight));
const totalFrames = parts.reduce((n, p) => n + p.meta.count, 0);
const rows = Math.ceil(totalFrames / COLS);

console.log(
  `\n정규화 기준: ${cellW}x${cellH}` +
    parts
      .map((p) =>
        p.meta.frameWidth !== cellW || p.meta.frameHeight !== cellH
          ? `\n  b${p.index}: ${p.meta.frameWidth}x${p.meta.frameHeight} → 조정`
          : '',
      )
      .join(''),
);

/* --- 4. 이어 붙이기 -------------------------------------------------- */

const out = new PNG({ width: cellW * COLS, height: cellH * rows, filterType: 4 });
out.data.fill(0);

/**
 * 원본 칸 하나를 목표 칸에 그린다.
 *
 * 발끝을 아래에 맞추고 가로 가운데 정렬한다 — process-sheet 가 이미 각 칸을
 * 그렇게 배치해 두었으므로, 여기서도 같은 기준을 지켜야 애니메이션 중에
 * 캐릭터가 위아래로 튀지 않는다.
 */
function blit(src, sw, sh, sx0, sy0, dx0, dy0) {
  const scale = Math.min(cellW / sw, cellH / sh);
  const dw = Math.round(sw * scale);
  const dh = Math.round(sh * scale);
  // 가로 가운데, 세로는 바닥 정렬
  const offX = Math.round((cellW - dw) / 2);
  const offY = cellH - dh;

  for (let y = 0; y < dh; y++) {
    // 최근접 이웃 — 도트 느낌을 뭉개지 않기 위해 보간하지 않는다
    const sy = sy0 + Math.min(sh - 1, Math.floor(y / scale));
    for (let x = 0; x < dw; x++) {
      const sx = sx0 + Math.min(sw - 1, Math.floor(x / scale));
      const si = (sy * src.width + sx) * 4;
      const di = ((dy0 + offY + y) * out.width + (dx0 + offX + x)) * 4;

      out.data[di] = src.data[si];
      out.data[di + 1] = src.data[si + 1];
      out.data[di + 2] = src.data[si + 2];
      out.data[di + 3] = src.data[si + 3];
    }
  }
}

let frame = 0;
for (const p of parts) {
  const { frameWidth: fw, frameHeight: fh, columns } = p.meta;

  for (let i = 0; i < p.meta.count; i++) {
    const sx = (i % columns) * fw;
    const sy = Math.floor(i / columns) * fh;

    const dx = (frame % COLS) * cellW;
    const dy = Math.floor(frame / COLS) * cellH;

    blit(p.png, fw, fh, sx, sy, dx, dy);
    frame++;
  }
}

/* --- 5. 저장 --------------------------------------------------------- */

const outPng = `public/sprites/${key}.png`;
mkdirSync(dirname(outPng), { recursive: true });
writeFileSync(outPng, PNG.sync.write(out));

const meta = {
  frameWidth: cellW,
  frameHeight: cellH,
  columns: COLS,
  rows,
  count: totalFrames,
  /*
   * 어느 묶음이 들어 있는지. 게임이 배치표를 만들 때 쓴다 —
   * 프레임 수만으로는 "1·3·7 묶음 18칸"과 "옛 V1 15칸"을 구별할 수 없다.
   */
  batches: parts.map((p) => p.index),
  /*
   * 묶음마다 몇 칸이 들어왔는지.
   *
   * 6칸이 아니면 그 묶음부터 포즈가 한 칸씩 밀린다 — 걷기 자리에 대기
   * 그림이 오고 마지막 포즈는 빈다. 합친 시트만 놓고 보면 어느 묶음이
   * 모자랐는지 알 길이 없으므로, 아는 사람이 여기 적어 둔다(art-check 가 읽는다).
   */
  batchCounts: Object.fromEntries(parts.map((p) => [p.index, p.meta.count])),
};
writeFileSync(outPng.replace(/\.png$/, '.json'), JSON.stringify(meta, null, 2));

rmSync(TMP, { recursive: true, force: true });

console.log(
  `\n완료: ${outPng}\n` +
    `프레임 ${totalFrames}개, 격자 ${COLS}x${rows}, 칸 크기 ${cellW}x${cellH}\n`,
);

/*
 * 낡은 webp 를 곧바로 갈아 끼운다.
 *
 * 게임은 가벼운 webp 를 먼저 집는다(artAssets.ts resolveArtPath).
 * 새 시트를 만들어 놓고 webp 를 그대로 두면 화면은 **옛 그림 그대로**다.
 * 파일은 분명히 새것인데 게임만 안 바뀌니, 원인을 코드에서 찾게 된다.
 *
 * 여기서 자동으로 하는 이유: 잊어버릴 수 있는 단계이고, 잊었을 때의 증상이
 * 원인과 전혀 닮지 않았다. 사람이 판단할 것도 없다 — 늘 갱신하는 것이 맞다.
 */
if (existsSync(`public/sprites/${key}.webp`)) {
  console.log('낡은 webp 를 갱신합니다…');
  const r = spawnSync(process.execPath, ['tools/optimize-art.mjs'], {
    stdio: 'inherit',
  });
  if (r.status !== 0) {
    console.log(
      `\n주의: webp 갱신에 실패했습니다. 직접 돌려 주세요 — npm run art:opt\n` +
        `      그대로 두면 게임이 옛 그림을 계속 씁니다.`,
    );
  }
}

const perBatch = parts.filter((p) => p.meta.count !== 6);
if (perBatch.length) {
  console.log(
    `\n주의: 칸이 6개가 아닌 묶음이 있습니다 — ` +
      perBatch.map((p) => `b${p.index}(${p.meta.count}칸)`).join(', ') +
      `\n묶음당 6칸이어야 포즈가 제자리에 들어갑니다. 해당 묶음만 다시 뽑으세요.`,
  );
}

if (totalFrames === 42) {
  /*
   * 규격은 게임이 프레임 수를 보고 스스로 정한다(spriteSheets.ts applyLayout).
   * 이미 등록된 키라면 새로고침만으로 V3 배치로 갈아 끼워진다.
   */
  console.log(
    `V3(42프레임) 규격입니다. 새로고침하면 바로 적용됩니다.\n` +
      `처음 넣는 캐릭터라면 src/config/spriteSheets.ts 의 SPRITE_SHEETS 에\n` +
      `한 줄만 추가하세요 (규격은 자동 판별되므로 poses를 적을 필요가 없습니다):\n\n` +
      `  <id>: { key: '${key}', displayHeight: 116, frameRate: 10, poses: LAYOUT_V1 },\n`,
  );
} else {
  console.log(
    `묶음 ${parts.map((p) => p.index).join('·')} 로 ${totalFrames}칸 시트를 만들었습니다.\n` +
      `빠진 묶음의 포즈는 대체 그림으로 나갑니다 — 나중에 그 묶음만 뽑아\n` +
      `다시 합치면 게임 쪽은 손댈 것 없이 자동으로 늘어납니다.`,
  );
}
