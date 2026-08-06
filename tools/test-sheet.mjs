#!/usr/bin/env node
/**
 * 스프라이트 시트 파이프라인 테스트.
 *
 *   npm run test:sheet
 *
 * ── 왜 이 테스트가 필요한가 ────────────────────────────────────────
 * 그림을 받아 오는 날 밤에 이 경로가 고장나 있으면 그 밤이 통째로 날아간다.
 * 묶음 7장 → 합치기 → 게임이 읽을 규격까지가 한 줄로 이어져야 하는데,
 * 중간에 프레임 순서가 한 칸이라도 밀리면 걷는 그림으로 주먹을 지른다.
 *
 * 그래서 사람이 눈으로 보고 판정할 수 없는 것 — **프레임 순서** — 를
 * 색으로 표시한 가짜 묶음을 만들어 끝까지 통과시키고,
 * 나온 시트의 각 칸에서 그 색을 되읽어 순서를 대조한다.
 *
 * 실제 생성 이미지를 흉내 낸다:
 *   - 마젠타 단색 배경 (투명을 못 만드는 생성기의 대안으로 안내한 형식)
 *   - 묶음마다 캐릭터 크기가 조금씩 다름 (실제로 그렇게 나온다)
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { PNG } from 'pngjs';
import {
  applyLayout,
  LAYOUT_V1,
  LAYOUT_V2,
  LAYOUT_V3,
  LAYOUT_V3_FX,
} from '../src/config/spriteSheets.ts';

const KEY = '__sheettest';
const BATCHES = 7;
const CELLS = 6;
const TOTAL = BATCHES * CELLS;

let failed = 0;
const fail = (msg) => {
  failed++;
  console.error(`  ✗ ${msg}`);
};
const pass = (msg) => console.log(`  ✓ ${msg}`);

/* ------------------------------------------------------------------ */
/* 1. 규격 자동 판별                                                    */
/* ------------------------------------------------------------------ */

console.log('규격 자동 판별');
{
  const cases = [
    [15, 'V1', LAYOUT_V1],
    [29, 'V1', LAYOUT_V1],
    [30, 'V2', LAYOUT_V2],
    [41, 'V2', LAYOUT_V2],
    [42, 'V3', LAYOUT_V3],
  ];

  for (const [count, want, poses] of cases) {
    const def = { key: 'x', displayHeight: 100, poses: {} };
    const got = applyLayout(def, count);
    if (got !== want) fail(`${count}프레임 → ${want} 이어야 하는데 ${got}`);
    else if (def.poses !== poses) fail(`${count}프레임의 poses 표가 ${want}가 아닙니다`);
  }

  /* 옛 시트 보정은 V1일 때만 얹혀야 한다 */
  const legacy = {
    key: 'x',
    displayHeight: 100,
    poses: {},
    v1: { explosionFrame: 8, poses: { skill: [7, 8] } },
  };

  applyLayout(legacy, 15);
  if (legacy.explosionFrame !== 8) fail('V1 보정 explosionFrame 이 적용되지 않았습니다');
  if (JSON.stringify(legacy.poses.skill) !== '[7,8]') fail('V1 보정 poses 가 적용되지 않았습니다');

  applyLayout(legacy, 42);
  if (legacy.explosionFrame !== LAYOUT_V3_FX.skill) {
    fail(
      `V3에서 explosionFrame 이 ${LAYOUT_V3_FX.skill} 이어야 하는데 ${legacy.explosionFrame}`,
    );
  }
  if (JSON.stringify(legacy.poses.skill) !== '[25,26]') {
    fail(`V3에서 옛 시트 보정이 남았습니다 (skill=${JSON.stringify(legacy.poses.skill)})`);
  }
  if (legacy.portraitFrame !== 41) fail('V3에서 portraitFrame 이 채워지지 않았습니다');

  if (!failed) pass('프레임 수 → V1/V2/V3, 옛 시트 보정은 V1에서만');
}

/* ------------------------------------------------------------------ */
/* 2. 묶음 → 시트 합치기                                                */
/* ------------------------------------------------------------------ */

/** 프레임 번호를 색으로 심는다 — 합친 뒤 되읽어 순서를 검증하기 위함 */
const colorOf = (i) => [40 + i * 5, 200, 60];

/**
 * 가짜 묶음 한 장.
 *
 * 마젠타 바탕에 세로로 긴 색 사각형 6개. 전처리기가 칸을 가르려면
 * 칸 사이가 배경으로 확실히 비어 있어야 하므로 간격을 넉넉히 둔다.
 */
function makeBatch(batchIndex, figureH) {
  const cellW = 300;
  const figW = 120;
  const W = cellW * CELLS;
  const H = figureH + 120;
  const png = new PNG({ width: W, height: H });

  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = 255;
    png.data[i + 1] = 0;
    png.data[i + 2] = 255;
    png.data[i + 3] = 255;
  }

  for (let c = 0; c < CELLS; c++) {
    const [r, g, b] = colorOf(batchIndex * CELLS + c);
    const x0 = c * cellW + (cellW - figW) / 2;
    const y0 = 60;

    for (let y = y0; y < y0 + figureH; y++) {
      for (let x = x0; x < x0 + figW; x++) {
        const i = (y * W + x) * 4;
        png.data[i] = r;
        png.data[i + 1] = g;
        png.data[i + 2] = b;
        png.data[i + 3] = 255;
      }
    }
  }
  return png;
}

console.log('\n묶음 7장 → 시트 1장');

mkdirSync('art-source', { recursive: true });
const inputs = [];
for (let b = 0; b < BATCHES; b++) {
  // 묶음마다 크기를 다르게 — 실제 생성 결과가 그렇다. 정규화가 되는지 본다
  const h = 260 + (b % 3) * 40;
  const path = `art-source/${KEY}_b${b + 1}.png`;
  writeFileSync(path, PNG.sync.write(makeBatch(b, h)));
  inputs.push(path);
}

const outPng = `public/sprites/${KEY}.png`;
const outJson = `public/sprites/${KEY}.json`;

const cleanup = () => {
  inputs.forEach((p) => rmSync(p, { force: true }));
  rmSync(outPng, { force: true });
  rmSync(outJson, { force: true });
  rmSync('art-source/.merge', { recursive: true, force: true });
};

const run = spawnSync(process.execPath, ['tools/merge-sheets.mjs', KEY], {
  encoding: 'utf8',
});

if (run.status !== 0) {
  fail(`merge-sheets 실행 실패 (코드 ${run.status})`);
  console.error(run.stdout);
  console.error(run.stderr);
  cleanup();
  process.exit(1);
}

/* --- 결과 검사 ----------------------------------------------------- */

if (!existsSync(outPng) || !existsSync(outJson)) {
  fail('시트 또는 메타 파일이 생성되지 않았습니다');
  cleanup();
  process.exit(1);
}

const meta = JSON.parse(readFileSync(outJson, 'utf8'));
if (meta.count !== TOTAL) fail(`프레임 ${TOTAL}개여야 하는데 ${meta.count}개`);
if (meta.columns !== CELLS) fail(`열이 ${CELLS}개여야 하는데 ${meta.columns}개`);
if (meta.rows !== BATCHES) fail(`행이 ${BATCHES}개여야 하는데 ${meta.rows}개`);
else pass(`격자 ${meta.columns}x${meta.rows}, 프레임 ${meta.count}개`);

/* 칸마다 가장 많이 쓰인 색을 뽑아 프레임 번호를 되읽는다 */
const sheet = PNG.sync.read(readFileSync(outPng));
const { frameWidth: fw, frameHeight: fh } = meta;

const readCell = (n) => {
  const cx = (n % CELLS) * fw;
  const cy = Math.floor(n / CELLS) * fh;
  const hist = new Map();

  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      const i = ((cy + y) * sheet.width + (cx + x)) * 4;
      if (sheet.data[i + 3] < 200) continue;
      const k = `${sheet.data[i]},${sheet.data[i + 1]},${sheet.data[i + 2]}`;
      hist.set(k, (hist.get(k) ?? 0) + 1);
    }
  }

  const top = [...hist.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!top) return { empty: true };

  const [r, g, b] = top[0].split(',').map(Number);
  return { r, g, b, count: top[1] };
};

const wrong = [];
const empty = [];

for (let n = 0; n < TOTAL; n++) {
  const cell = readCell(n);
  if (cell.empty) {
    empty.push(n);
    continue;
  }

  // 마젠타가 남아 있으면 배경 제거가 실패한 것이다
  if (cell.r > 180 && cell.b > 180 && cell.g < 90) {
    wrong.push(`[${n}] 배경(마젠타)이 남아 있습니다`);
    continue;
  }

  const idx = Math.round((cell.r - 40) / 5);
  if (idx !== n) wrong.push(`[${n}] 칸에 ${idx}번 프레임이 들어 있습니다`);
}

if (empty.length) fail(`빈 칸: ${empty.join(', ')}`);
if (wrong.length) wrong.slice(0, 8).forEach(fail);
if (!empty.length && !wrong.length) {
  pass(`42칸 모두 순서대로 (묶음별 크기 차이는 ${fw}x${fh} 로 정규화)`);
}

/* --- 합친 시트를 게임이 어떤 규격으로 읽는가 ------------------------ */

{
  const def = { key: KEY, displayHeight: 116, poses: {} };
  const version = applyLayout(def, meta.count);
  if (version !== 'V3') fail(`합친 42프레임 시트가 V3로 읽히지 않습니다 (${version})`);
  else pass('합친 시트 → V3 규격으로 자동 인식');
}

cleanup();

console.log(failed ? `\n실패 ${failed}건` : '\n통과');
process.exit(failed ? 1 : 0);
