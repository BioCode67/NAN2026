#!/usr/bin/env node
/**
 * 배치 이미지 여러 장을 시트 한 장으로 합친다.
 *
 * gen-prompts.mjs 는 42장을 7묶음으로 나눠 뽑게 한다. 그렇게 받은 가로 띠
 * 여러 장을 게임이 쓰는 균일 격자 시트 하나로 만드는 것이 이 도구다.
 *
 *   npm run sheet:merge -- elonmusk
 *   npm run sheet:merge -- elonmusk --cols 6
 *
 * 입력: art-source/<key>_b1.png … _b7.png
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

if (!key) {
  console.error(
    '사용법: node tools/merge-sheets.mjs <key> [--cols 6]\n' +
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

// 번호가 비어 있으면 프레임 순서가 통째로 밀린다 — 조용히 넘어가면 안 된다
const missing = [];
for (let i = 1; i <= inputs[inputs.length - 1].index; i++) {
  if (!inputs.some((f) => f.index === i)) missing.push(i);
}
if (missing.length) {
  console.error(
    `배치 ${missing.join(', ')} 번이 빠져 있습니다.\n` +
      `순서가 밀려 엉뚱한 프레임에 매핑되므로 먼저 채워 주세요.`,
  );
  process.exit(1);
}

console.log(`배치 ${inputs.length}개 발견: ${inputs.map((f) => `b${f.index}`).join(', ')}`);

/* --- 2. 배치별 전처리 (배경 제거 + 균일 격자화) ---------------------- */

rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

const parts = [];
for (const f of inputs) {
  const out = `${TMP}/${key}_b${f.index}.png`;
  console.log(`\n[b${f.index}] 전처리…`);

  const r = spawnSync(process.execPath, ['tools/process-sheet.mjs', f.path, out], {
    stdio: 'inherit',
  });
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
};
writeFileSync(outPng.replace(/\.png$/, '.json'), JSON.stringify(meta, null, 2));

rmSync(TMP, { recursive: true, force: true });

console.log(
  `\n완료: ${outPng}\n` +
    `프레임 ${totalFrames}개, 격자 ${COLS}x${rows}, 칸 크기 ${cellW}x${cellH}\n`,
);

if (totalFrames === 42) {
  console.log(
    `다음 단계: src/config/spriteSheets.ts 에 등록하세요.\n\n` +
      `  <id>: { key: '${key}', displayHeight: 116, frameRate: 10,\n` +
      `          explosionFrame: LAYOUT_V3_FX.skill,\n` +
      `          promptFrame: LAYOUT_V3_FX.prompt,\n` +
      `          portraitFrame: LAYOUT_V3_FX.portrait,\n` +
      `          poses: LAYOUT_V3 },\n`,
  );
} else {
  console.log(
    `주의: 42개가 아니라 ${totalFrames}개입니다.\n` +
      `묶음별 칸 수가 6개씩 맞는지 확인하세요 — 개수가 어긋나면 포즈 매핑이 밀립니다.`,
  );
}
