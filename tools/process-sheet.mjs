#!/usr/bin/env node
/**
 * 스프라이트 시트 전처리 도구
 *
 * AI로 생성한 시안 이미지(불투명 배경 + 라벨 텍스트 + 불규칙 격자)를
 * Phaser가 바로 쓸 수 있는 균일 격자 스프라이트 시트로 변환한다.
 *
 *   1. 테두리에서 flood fill → 배경 체크무늬만 제거
 *      배경 판정은 "무채색 + 검출된 체크무늬 톤에 가까운 밝기"다.
 *      밝기 조건이 없으면 캐릭터의 검은 외곽선을 뚫고 흘러들어가
 *      검은 옷이 통째로 사라진다.
 *   2. 연결 요소로 스프라이트 검출 (격자 위치를 가정하지 않음)
 *   3. 라벨 텍스트 제거 — 작고 채도가 0에 가까운 덩어리
 *      (손·로고·이펙트는 유채색이라 보존된다)
 *   4. 발끝을 아래에 맞추고 가로 중앙 정렬해 균일 격자로 재배치
 *   5. 프레임 높이를 MAX_FRAME_H(기본 256)로 축소해 용량 절감
 *
 * 사용법:
 *   node tools/process-sheet.mjs <입력.png> <출력.png>
 *   MAX_FRAME_H=320 node tools/process-sheet.mjs ...   (해상도 조정)
 *
 * 예:
 *   node tools/process-sheet.mjs art-source/stevejobs_sheet.png public/sprites/stevejobs.png
 *
 * 결과물: <출력.png> + <출력.json>(프레임 크기·개수)
 * 프레임 순서는 원본 시트를 위→아래, 왼→오른으로 읽은 순서다.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { PNG } from 'pngjs';

/* ------------------------------------------------------------------ */
/* 튜닝 파라미터                                                       */
/* ------------------------------------------------------------------ */

/** 배경으로 인정할 채널 간 최대 편차 (무채색 판정) */
const GRAY_TOLERANCE = 16;
/** 검출된 체크무늬 톤에서 허용할 밝기 오차 */
const TONE_TOLERANCE = 22;
/** 안티에일리어싱 잔여물을 흡수할 때의 최소 밝기 — 이보다 어두우면 캐릭터 외곽선으로 본다 */
const AA_MIN_LUM = 56;
/** 이 높이보다 낮고 아래쪽에 떨어져 있는 밴드는 라벨로 간주 */
const LABEL_MAX_HEIGHT = 110;
/** 프레임 주위 여백 */
const PADDING = 6;

/* ------------------------------------------------------------------ */

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error('사용법: node tools/process-sheet.mjs <입력.png> <출력.png>');
  process.exit(1);
}

const png = PNG.sync.read(readFileSync(inPath));
const { width: W, height: H, data } = png;
console.log(`입력: ${inPath} (${W}x${H})`);

const isGray = (i) => {
  const r = data[i], g = data[i + 1], b = data[i + 2];
  return Math.max(r, g, b) - Math.min(r, g, b) <= GRAY_TOLERANCE;
};
const lum = (i) => (data[i] + data[i + 1] + data[i + 2]) / 3;

/* --- 0. 체크무늬 두 톤 자동 검출 ------------------------------------ */

/*
 * 테두리 픽셀은 전부 배경이므로, 거기서 가장 흔한 무채색 밝기 두 개를 고른다.
 * (시트마다 체크무늬 색이 달라도 그대로 동작하게 하기 위함)
 */
const borderHist = new Map();
const noteBorder = (x, y) => {
  const i = (y * W + x) * 4;
  if (!isGray(i)) return;
  const l = Math.round(lum(i));
  borderHist.set(l, (borderHist.get(l) ?? 0) + 1);
};
for (let x = 0; x < W; x++) { noteBorder(x, 0); noteBorder(x, H - 1); }
for (let y = 0; y < H; y++) { noteBorder(0, y); noteBorder(W - 1, y); }

const sortedLums = [...borderHist.entries()].sort((a, b) => b[1] - a[1]);
const tones = [];
for (const [l] of sortedLums) {
  // 이미 잡은 톤과 충분히 떨어진 밝기만 새 톤으로 인정
  if (tones.every((t) => Math.abs(t - l) > TONE_TOLERANCE * 2)) tones.push(l);
  if (tones.length === 2) break;
}
console.log(`체크무늬 톤 검출: ${tones.join(', ')} (±${TONE_TOLERANCE})`);

/** 배경 색인가 — 무채색이면서 검출된 두 톤 중 하나에 가까워야 한다 */
const isBgColor = (i) => {
  if (!isGray(i)) return false;
  const l = lum(i);
  return tones.some((t) => Math.abs(l - t) <= TONE_TOLERANCE);
};

/* --- 1. 테두리 flood fill로 배경 마스크 만들기 --------------------- */

const bg = new Uint8Array(W * H);
const stack = [];

// 네 변의 모든 픽셀을 시드로 넣는다
for (let x = 0; x < W; x++) {
  stack.push([x, 0], [x, H - 1]);
}
for (let y = 0; y < H; y++) {
  stack.push([0, y], [W - 1, y]);
}

while (stack.length) {
  const [x, y] = stack.pop();
  if (x < 0 || y < 0 || x >= W || y >= H) continue;
  const p = y * W + x;
  if (bg[p]) continue;

  const i = p * 4;
  /*
   * 여기서 "무채색이면 배경"으로만 판정하면 캐릭터의 검은 외곽선(밝기 4~36)과
   * 검은 터틀넥(밝기 47~49)까지 배경으로 흘러들어가 옷이 통째로 사라진다.
   * 반드시 검출된 체크무늬 톤에 가까운 밝기여야 한다.
   */
  if (!isBgColor(i)) continue;

  bg[p] = 1;
  stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
}

/*
 * 체크무늬와 캐릭터 경계의 안티에일리어싱 픽셀 정리.
 * 배경에 인접한 밝은 무채색만 흡수한다 —
 * AA_MIN_LUM 아래는 외곽선이므로 건드리지 않는다.
 */
for (let pass = 0; pass < 2; pass++) {
  const add = [];
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const p = y * W + x;
      if (bg[p]) continue;
      const i = p * 4;
      if (!isGray(i) || lum(i) < AA_MIN_LUM) continue;
      if (bg[p - 1] || bg[p + 1] || bg[p - W] || bg[p + W]) add.push(p);
    }
  }
  add.forEach((p) => (bg[p] = 1));
  if (!add.length) break;
}

/*
 * 캐릭터에 둘러싸여 flood fill이 닿지 못한 체크무늬 조각 제거.
 * (겨드랑이·팔과 몸통 사이 등에 갇힌 배경)
 * 체크무늬는 두 톤이 번갈아 나타나므로, 한 덩어리 안에 두 톤이 모두
 * 들어 있을 때만 배경으로 판정해 캐릭터의 단색 회색 영역을 지키게 한다.
 */
{
  const seen = new Uint8Array(W * H);
  let removed = 0;

  for (let s = 0; s < W * H; s++) {
    if (bg[s] || seen[s] || !isBgColor(s * 4)) continue;

    const region = [];
    const toneHit = [false, false];
    const q = [s];
    seen[s] = 1;

    while (q.length) {
      const p = q.pop();
      region.push(p);
      const l = lum(p * 4);
      tones.forEach((t, ti) => {
        if (Math.abs(l - t) <= TONE_TOLERANCE) toneHit[ti] = true;
      });

      const x = p % W;
      for (const [nx, np] of [
        [x - 1, p - 1],
        [x + 1, p + 1],
        [x, p - W],
        [x, p + W],
      ]) {
        if (nx < 0 || nx >= W || np < 0 || np >= W * H) continue;
        if (seen[np] || bg[np] || !isBgColor(np * 4)) continue;
        seen[np] = 1;
        q.push(np);
      }
    }

    // 두 톤이 모두 있고 충분히 큰 덩어리만 체크무늬로 인정
    if (region.length >= 200 && toneHit[0] && toneHit[1]) {
      region.forEach((p) => (bg[p] = 1));
      removed += region.length;
    }
  }
  if (removed) console.log(`갇힌 체크무늬 제거: ${removed}px`);
}

const bgCount = bg.reduce((a, v) => a + v, 0);
console.log(`배경 픽셀: ${((bgCount / (W * H)) * 100).toFixed(1)}%`);

/* --- 2. 연결 요소로 스프라이트 검출 --------------------------------- */

/*
 * 격자 위치를 가정하지 않는다.
 * 시트마다 열 수·간격·라벨 유무가 다르므로, 내용 덩어리를 직접 찾아
 * "작고 납작한 덩어리 = 라벨 텍스트"만 걸러내는 편이 안정적이다.
 */

const comp = new Int32Array(W * H).fill(-1);
const comps = [];

for (let sy = 0; sy < H; sy++) {
  for (let sx = 0; sx < W; sx++) {
    const start = sy * W + sx;
    if (bg[start] || comp[start] >= 0) continue;

    const id = comps.length;
    const box = { x0: sx, x1: sx, y0: sy, y1: sy, area: 0, colored: 0 };
    const q = [start];
    comp[start] = id;

    while (q.length) {
      const p = q.pop();
      const x = p % W;
      const y = (p - x) / W;
      box.area++;
      // 채도 있는 픽셀 비율 — 라벨 텍스트(흑백)와 손·로고(유채색)를 가른다
      if (!isGray(p * 4)) box.colored++;
      if (x < box.x0) box.x0 = x;
      if (x > box.x1) box.x1 = x;
      if (y < box.y0) box.y0 = y;
      if (y > box.y1) box.y1 = y;

      // 8방향 연결 — 얇은 대각선 픽셀이 끊기지 않게
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const np = ny * W + nx;
          if (bg[np] || comp[np] >= 0) continue;
          comp[np] = id;
          q.push(np);
        }
      }
    }
    comps.push(box);
  }
}

console.log(`연결 요소 ${comps.length}개`);

/*
 * 라벨 글자를 묶기 전에 걸러낸다.
 *
 * 글자는 흰 글자 + 검은 외곽선이라 채도가 거의 0이고 작다.
 * 반면 떨어져 나온 주먹(살색)·애플 로고(무지개)·이펙트는 유채색이므로 살아남는다.
 * 묶은 뒤에 지우려 하면 라벨이 캐릭터와 한 덩어리가 되어 분리할 수 없다.
 */
const LETTER_MAX_H = 100;
const LETTER_MAX_COLOR_RATIO = 0.12;

const alive = comps.filter((c) => {
  if (c.area < 150) return false;
  const h = c.y1 - c.y0 + 1;
  const colorRatio = c.colored / c.area;
  const isLetter = h <= LETTER_MAX_H && colorRatio < LETTER_MAX_COLOR_RATIO;
  return !isLetter;
});
console.log(`요소 ${comps.length}개 → 라벨 글자 제외 후 ${alive.length}개`);

/* 남은 것끼리 근접 병합 (캐릭터 + 이펙트) */
const MERGE_PAD = 26;

const clusters = alive.map((c) => ({ ...c }));
let merged = true;
while (merged) {
  merged = false;
  outer: for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      const a = clusters[i];
      const b = clusters[j];
      const overlap =
        a.x0 - MERGE_PAD <= b.x1 &&
        b.x0 - MERGE_PAD <= a.x1 &&
        a.y0 - MERGE_PAD <= b.y1 &&
        b.y0 - MERGE_PAD <= a.y1;
      if (!overlap) continue;
      a.x0 = Math.min(a.x0, b.x0);
      a.x1 = Math.max(a.x1, b.x1);
      a.y0 = Math.min(a.y0, b.y0);
      a.y1 = Math.max(a.y1, b.y1);
      a.area += b.area;
      clusters.splice(j, 1);
      merged = true;
      break outer;
    }
  }
}

/* 라벨 텍스트 제거 — 캐릭터에 비해 낮고 납작하다 */
const MIN_SPRITE_H = 120;
const labels = clusters.filter((c) => c.y1 - c.y0 + 1 < MIN_SPRITE_H);
const sprites = clusters.filter((c) => c.y1 - c.y0 + 1 >= MIN_SPRITE_H);
console.log(`덩어리 ${clusters.length}개 → 스프라이트 ${sprites.length}개, 라벨 ${labels.length}개 제외`);

/* 읽는 순서(위→아래, 왼→오른)로 정렬 */
const ROW_TOL = 160;
sprites.sort((a, b) => {
  const ay = (a.y0 + a.y1) / 2;
  const by = (b.y0 + b.y1) / 2;
  if (Math.abs(ay - by) > ROW_TOL) return ay - by;
  return a.x0 - b.x0;
});

const frames = sprites;

console.log(`검출된 프레임: ${frames.length}개`);
frames.forEach((f, i) =>
  console.log(`  [${i}] ${f.x1-f.x0+1}x${f.y1-f.y0+1} @(${f.x0},${f.y0})`),
);

if (!frames.length) {
  console.error('프레임을 찾지 못했습니다. 파라미터를 조정하세요.');
  process.exit(1);
}

/* --- 4. 균일 격자로 재배치 ----------------------------------------- */

const cellW = Math.max(...frames.map((f) => f.x1 - f.x0 + 1)) + PADDING * 2;
const cellH = Math.max(...frames.map((f) => f.y1 - f.y0 + 1)) + PADDING * 2;
const cols = Math.min(frames.length, 6);
const rows = Math.ceil(frames.length / cols);

const out = new PNG({ width: cellW * cols, height: cellH * rows });
out.data.fill(0);

frames.forEach((f, n) => {
  const fw = f.x1 - f.x0 + 1;
  const fh = f.y1 - f.y0 + 1;
  const cx = (n % cols) * cellW;
  const cy = Math.floor(n / cols) * cellH;

  // 가로 중앙 정렬, 발끝을 아래에 맞춤 (점프/공격 시 발 위치가 흔들리지 않게)
  const ox = cx + Math.floor((cellW - fw) / 2);
  const oy = cy + cellH - PADDING - fh;

  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      const src = (f.y0 + y) * W + (f.x0 + x);
      if (bg[src]) continue;
      const si = src * 4;
      const di = ((oy + y) * out.width + (ox + x)) * 4;
      out.data[di] = data[si];
      out.data[di + 1] = data[si + 1];
      out.data[di + 2] = data[si + 2];
      out.data[di + 3] = 255;
    }
  }
});

/* --- 5. 축소 -------------------------------------------------------- */

/*
 * 원본 프레임(400px 안팎)은 게임 표시 크기(~110px)보다 훨씬 크다.
 * 고해상도 화면을 감안해 프레임 높이를 MAX_FRAME_H로 맞추면
 * 화질 손실 없이 파일 크기가 크게 줄어든다.
 *
 * 알파 가중 박스 필터를 쓴다 — 투명 픽셀의 검은 RGB가 섞여
 * 가장자리에 검은 테가 생기는 것을 막기 위함.
 */
const MAX_FRAME_H = Number(process.env.MAX_FRAME_H ?? 256);
let final = out;
let outCellW = cellW;
let outCellH = cellH;

if (cellH > MAX_FRAME_H) {
  const k = MAX_FRAME_H / cellH;
  outCellW = Math.max(1, Math.round(cellW * k));
  outCellH = MAX_FRAME_H;

  const sw = outCellW * cols;
  const sh = outCellH * rows;
  const small = new PNG({ width: sw, height: sh });
  small.data.fill(0);

  const sx = out.width / sw;
  const sy = out.height / sh;

  for (let y = 0; y < sh; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.min(out.height, Math.max(y0 + 1, Math.ceil((y + 1) * sy)));
    for (let x = 0; x < sw; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.min(out.width, Math.max(x0 + 1, Math.ceil((x + 1) * sx)));

      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * out.width + xx) * 4;
          const al = out.data[i + 3] / 255;
          r += out.data[i] * al;
          g += out.data[i + 1] * al;
          b += out.data[i + 2] * al;
          a += al;
          n++;
        }
      }
      const di = (y * sw + x) * 4;
      if (a > 0) {
        small.data[di] = Math.round(r / a);
        small.data[di + 1] = Math.round(g / a);
        small.data[di + 2] = Math.round(b / a);
        small.data[di + 3] = Math.round((a / n) * 255);
      }
    }
  }

  final = small;
  console.log(`축소: ${cellW}x${cellH} → ${outCellW}x${outCellH}`);
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, PNG.sync.write(final, { deflateLevel: 9 }));

/*
 * 메타데이터를 PNG 옆에 함께 내보낸다.
 * 게임이 프레임 크기를 하드코딩하지 않고 읽어 쓰므로,
 * 다른 캐릭터 시트의 프레임 크기가 달라도 코드 수정이 필요 없다.
 */
const meta = {
  frameWidth: outCellW,
  frameHeight: outCellH,
  columns: cols,
  rows,
  count: frames.length,
  source: inPath.replace(/\\/g, '/'),
};
const metaPath = outPath.replace(/\.png$/i, '.json');
writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);

console.log(`\n출력: ${outPath}`);
console.log(`      ${metaPath}`);
console.log(`프레임 크기: ${outCellW}x${outCellH}, 격자 ${cols}x${rows}, 총 ${frames.length}개`);
