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
/** 검출된 배경 색에서 허용할 RGB 거리 */
const TONE_TOLERANCE = 38;
/** 안티에일리어싱 잔여물을 흡수할 때의 최소 밝기 — 이보다 어두우면 캐릭터 외곽선으로 본다 */
const AA_MIN_LUM = 56;
/** 이 높이보다 낮고 아래쪽에 떨어져 있는 밴드는 라벨로 간주 */
const LABEL_MAX_HEIGHT = 110;
/** 프레임 주위 여백 */
const PADDING = 6;
/** 격자 모드에서 "빈 칸"으로 볼 내용량 (px). 진짜 캐릭터는 수만 px이다 */
const EMPTY_CELL_AREA = 1500;

/* ------------------------------------------------------------------ */

const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith('--'));
const [inPath, outPath] = positional;

/**
 * 격자를 직접 알려주는 선택지 (--grid 5x3).
 *
 * 자동 검출은 "덩어리를 찾아 칸으로 묶는" 방식이라, 이펙트가 칸을 넘어가면
 * 옆 칸·아랫 칸과 한 덩어리가 되어 프레임이 뭉개진다. 초록 오라가 셀을
 * 가득 채운 스킬 칸에서 실제로 그렇게 된다.
 *
 * 그런데 우리가 뽑는 시안은 칸 수를 **이미 알고 있다** — 프롬프트에 6칸이라고
 * 적어서 시켰기 때문이다. 아는 것을 굳이 추측하지 않는 길을 열어 둔다.
 * 다시 뽑는 것보다 이 옵션 하나가 훨씬 싸다.
 */
const gridArg = argv[argv.indexOf('--grid') + 1];
const GRID = argv.includes('--grid') ? parseGrid(gridArg) : null;

/**
 * 칸 가장자리에서 라벨 자리로 보고 무시할 비율 (--label-band 0.12 또는 0.12,0.09).
 *
 * 앞 숫자는 칸 아래, 뒷 숫자는 칸 위다. 위쪽이 따로 필요한 이유:
 * 생성기가 라벨을 칸 **경계 바로 아래**에 찍는 일이 잦다. 그러면 그 글자는
 * 자기 칸이 아니라 아랫 칸의 맨 위에 놓이고, 아랫 칸 그림과 닿아 한 덩어리가
 * 되면 글자 걸러내기로도 못 떼어낸다(실제로 "Only)" 가 그렇게 남았다).
 */
const bandArg = argv[argv.indexOf('--label-band') + 1];
const [BAND_BOTTOM, BAND_TOP] = parseBand(bandArg);

function parseBand(text) {
  if (!argv.includes('--label-band')) return [0, 0];
  const parts = String(text ?? '').split(',').map(Number);
  if (parts.some((v) => !Number.isFinite(v) || v < 0 || v > 0.4)) {
    console.error('--label-band 는 0~0.4 사이의 숫자입니다. 예: 0.13 또는 0.13,0.09');
    process.exit(1);
  }
  return [parts[0], parts[1] ?? 0];
}

function parseGrid(text) {
  const m = /^(\d+)x(\d+)$/.exec(text ?? '');
  if (!m) {
    console.error('--grid 는 열x행 형식입니다. 예: --grid 6x1');
    process.exit(1);
  }
  return { cols: Number(m[1]), rows: Number(m[2]) };
}

if (!inPath || !outPath) {
  console.error(
    '사용법: node tools/process-sheet.mjs <입력.png> <출력.png> [--grid 5x3] [--label-band 0.12]',
  );
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

/* --- 0. 배경 색 자동 검출 -------------------------------------------- */

/*
 * 세 종류의 입력을 모두 받는다.
 *   A. 진짜 투명 PNG      → 알파 0을 배경으로 (가장 깨끗함)
 *   B. 단색 배경 (마젠타 등) → 그 색 하나를 배경으로
 *   C. 체크무늬가 칠해진 시안 → 두 톤을 배경으로
 *
 * 테두리 픽셀은 어떤 경우든 배경이므로 거기서 색을 뽑는다.
 * 비교는 RGB 거리로 한다 — 밝기만 보면 채도 있는 단색 배경을 놓친다.
 */

/** 입력에 의미 있는 알파가 있는가 */
let hasAlpha = false;
for (let i = 3; i < data.length; i += 4) {
  if (data[i] < 250) { hasAlpha = true; break; }
}

const tones = [];
/** 배경이 유채색인가 — 캐릭터 색과 겹칠 위험이 없다는 뜻 */
let chromaticBg = false;
/** 배경의 색조 벡터 (밝기를 뺀 색깔). 경계 잔여물을 지울 때 쓴다 */
let bgHue = null;

if (hasAlpha) {
  console.log('배경: 알파 채널 사용 (투명 PNG)');
} else {
  const borderHist = new Map();
  const noteBorder = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    // 8단위로 양자화해 압축 노이즈를 뭉갠다
    const k = `${data[i] >> 3},${data[i + 1] >> 3},${data[i + 2] >> 3}`;
    borderHist.set(k, (borderHist.get(k) ?? 0) + 1);
  };

  /*
   * 테두리를 여러 깊이에서 훑는다.
   * 맨 바깥 한 줄만 보면, 시트에 격자선이나 액자 테두리가 그려져 있을 때
   * 그 선 색을 배경으로 착각한다 (실제로 그런 시트가 있었다).
   * 안쪽 깊이까지 함께 세면 진짜 배경색이 최다 색으로 올라온다.
   */
  for (const inset of [0, 3, 8, 16]) {
    for (let x = inset; x < W - inset; x++) {
      noteBorder(x, inset);
      noteBorder(x, H - 1 - inset);
    }
    for (let y = inset; y < H - inset; y++) {
      noteBorder(inset, y);
      noteBorder(W - 1 - inset, y);
    }
  }

  const dist = (a, b) =>
    Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  const sorted = [...borderHist.entries()].sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((s, [, n]) => s + n, 0);

  /*
   * 톤을 몇 개까지 받을지는 배경이 유채색인지에 달렸다.
   *
   * 마젠타처럼 채도 높은 배경은 캐릭터 색과 절대 겹치지 않으므로,
   * 색조가 여러 단계로 깔려 있어도 전부 배경으로 받아도 안전하다.
   * (셀 경계마다 살짝 다른 마젠타가 깔린 시트가 실제로 있었고,
   *  2톤으로 자르면 그 색조가 벽이 되어 flood fill이 막혔다)
   *
   * 반대로 회색 체크무늬 배경은 캐릭터의 검은 옷·회색 안경과 가깝다.
   * 톤을 늘리면 캐릭터가 배경으로 먹혀 산산조각 난다 — 반드시 2개로 묶는다.
   */
  const dominant = sorted[0]
    ? sorted[0][0].split(',').map((v) => (Number(v) << 3) + 4)
    : [0, 0, 0];
  const chromatic = Math.max(...dominant) - Math.min(...dominant) > 40;
  chromaticBg = chromatic;
  const maxTones = chromatic ? 4 : 2;
  const minGap = TONE_TOLERANCE * (chromatic ? 1.2 : 2);

  /** 밝기를 무시한 색조 벡터 — 같은 색의 진하기 차이를 같게 본다 */
  const hueVec = (c) => {
    const m = Math.max(...c, 1);
    return c.map((v) => v / m);
  };
  const domHue = hueVec(dominant);
  bgHue = domHue;

  for (const [k, n] of sorted) {
    const rgb = k.split(',').map((v) => (Number(v) << 3) + 4);
    // 이미 잡은 톤과 충분히 떨어진 색만 새 배경 톤으로 인정
    if (tones.some((t) => dist(t, rgb) <= minGap)) continue;
    // 테두리에서 비중이 너무 작은 색은 배경으로 보지 않는다
    if (n / total < (chromatic ? 0.015 : 0.05)) break;

    /*
     * 유채색 배경에서 두 번째 톤부터는 "같은 색의 다른 진하기"만 받는다.
     * 이 조건이 없으면 테두리 안쪽을 훑다가 만난 라벨의 흰 글자·검은 외곽선이
     * 배경 톤으로 등록되어, 캐릭터의 검은 선과 흰 부분이 통째로 지워진다.
     */
    if (chromatic && tones.length > 0) {
      const h = hueVec(rgb);
      const hueDist = Math.hypot(
        h[0] - domHue[0],
        h[1] - domHue[1],
        h[2] - domHue[2],
      );
      if (hueDist > 0.35) continue;
    }

    tones.push(rgb);
    if (tones.length === maxTones) break;
  }

  if (!tones.length) {
    console.error('배경 색을 찾지 못했습니다. 테두리가 배경인지 확인하세요.');
    process.exit(1);
  }
  console.log(
    `배경 색 검출: ${tones.map((t) => `rgb(${t.join(',')})`).join(' + ')} (±${TONE_TOLERANCE})`,
  );
}

/** 배경 픽셀인가 */
const isBgColor = (i) => {
  if (hasAlpha) return data[i + 3] < 24;
  const r = data[i], g = data[i + 1], b = data[i + 2];
  return tones.some(
    (t) => Math.hypot(r - t[0], g - t[1], b - t[2]) <= TONE_TOLERANCE,
  );
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
 * 배경과 캐릭터 경계의 안티에일리어싱 픽셀 정리.
 * 투명 PNG 입력은 경계가 이미 깨끗하므로 건너뛴다.
 *
 * 배경에 인접하면서 배경 색에 "거의" 가까운 픽셀만 흡수한다.
 * 회색 체크무늬의 경우 AA_MIN_LUM 아래는 캐릭터 외곽선이므로 남긴다.
 */
if (!hasAlpha) {
  const nearBg = (i) => {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    return tones.some(
      (t) => Math.hypot(r - t[0], g - t[1], b - t[2]) <= TONE_TOLERANCE * 1.8,
    );
  };

  /*
   * 유채색 배경에서는 **밝기를 뺀 색조**로도 본다.
   *
   * 마젠타 배경과 캐릭터의 검은 외곽선이 섞인 경계 픽셀은 어두운 마젠타
   * (예: rgb(128,2,128))가 된다. RGB 거리로는 순마젠타에서 175나 떨어져 있어
   * 절대 안 지워지고, 결과물에 분홍 테두리로 남는다.
   * 색조만 보면 어두워도 마젠타는 마젠타다.
   *
   * 배경에 **닿아 있는** 픽셀만 흡수하므로, 그림 안쪽의 분홍색은 안전하다.
   */
  const hueNearBg = (i) => {
    if (!chromaticBg || !bgHue) return false;
    const c = [data[i], data[i + 1], data[i + 2]];
    const m = Math.max(c[0], c[1], c[2]);
    // 거의 검정인 픽셀은 색조를 논할 수 없다 — 캐릭터 외곽선으로 남긴다
    if (m < 40) return false;
    const h = c.map((v) => v / m);
    return Math.hypot(h[0] - bgHue[0], h[1] - bgHue[1], h[2] - bgHue[2]) < 0.22;
  };

  // 색조로 지울 때는 여러 겹이 쌓여 있어 패스를 넉넉히 돈다
  const passes = chromaticBg ? 6 : 2;
  let absorbed = 0;

  for (let pass = 0; pass < passes; pass++) {
    const add = [];
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const p = y * W + x;
        if (bg[p]) continue;
        const i = p * 4;
        if (!nearBg(i) && !hueNearBg(i)) continue;
        if (isGray(i) && lum(i) < AA_MIN_LUM) continue;
        if (bg[p - 1] || bg[p + 1] || bg[p - W] || bg[p + W]) add.push(p);
      }
    }
    add.forEach((p) => (bg[p] = 1));
    absorbed += add.length;
    if (!add.length) break;
  }
  if (absorbed) console.log(`경계 잔여물 흡수: ${absorbed}px`);
}

/*
 * 칸 구분선(격자선) 제거.
 *
 * 시트에 따라 프레임 사이에 얇은 선이 그려져 있다. 이 선은 배경색이 아니라
 * 별도 색이라 flood fill이 지우지 못하고, 그대로 두면 선이 모든 칸을 잇는
 * 하나의 거대한 연결 요소가 되어 프레임을 전혀 나눌 수 없다.
 *
 * 격자선은 "이미지 폭(또는 높이) 전체를 가로지르는 얇은 띠"라는 점으로 찾는다.
 * 캐릭터는 그렇게 길고 얇게 뻗지 않으므로 오검출 위험이 낮다.
 */
{
  const MAX_LINE_THICK = 14;
  /** 격자선은 끝에서 끝까지 이어진다 — 거의 빈틈이 없어야 한다 */
  const FILL_RATIO = 0.97;
  /** 선이 이만큼은 있어야 "격자"로 인정한다 (한두 줄은 캐릭터 오검출) */
  const MIN_LINES = 3;
  let cleared = 0;

  /** 한 축에서 "끝까지 꽉 찬" 얇은 띠들을 찾아 배경으로 만든다 */
  const stripLines = (sizeA, sizeB, idx) => {
    const dense = [];
    for (let a = 0; a < sizeA; a++) {
      let n = 0;
      for (let b = 0; b < sizeB; b++) if (!bg[idx(a, b)]) n++;
      dense.push(n / sizeB >= FILL_RATIO);
    }

    // 얇은 띠만 후보로 모은다
    const bands = [];
    let run = -1;
    for (let a = 0; a <= sizeA; a++) {
      if (dense[a]) {
        if (run < 0) run = a;
      } else if (run >= 0) {
        if (a - run <= MAX_LINE_THICK) bands.push([run, a - 1]);
        run = -1;
      }
    }

    // 규칙적인 격자가 아니면 손대지 않는다
    if (bands.length < MIN_LINES) return;

    for (const [s, e] of bands) {
      for (let k = s; k <= e; k++) {
        for (let b = 0; b < sizeB; b++) {
          const p = idx(k, b);
          if (!bg[p]) {
            bg[p] = 1;
            cleared++;
          }
        }
      }
    }
  };

  stripLines(H, W, (y, x) => y * W + x);
  stripLines(W, H, (x, y) => y * W + x);
  if (cleared) console.log(`격자선 제거: ${cleared}px`);
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
    const toneHit = tones.map(() => false);
    const q = [s];
    seen[s] = 1;

    while (q.length) {
      const p = q.pop();
      region.push(p);
      const i = p * 4;
      tones.forEach((t, ti) => {
        const d = Math.hypot(data[i] - t[0], data[i + 1] - t[1], data[i + 2] - t[2]);
        if (d <= TONE_TOLERANCE) toneHit[ti] = true;
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

    /*
     * 회색 체크무늬라면 한 덩어리 안에 서로 다른 톤이 최소 둘은 섞여 있다.
     * 캐릭터의 단색 회색 영역은 한 톤만 맞으므로 이 조건에서 걸러진다.
     *
     * 유채색 배경(마젠타 등)은 캐릭터 색과 겹칠 일이 없으므로 조건이 필요 없다.
     * 오히려 조건을 걸면 이펙트에 둘러싸인 단색 마젠타가 그대로 남는다.
     */
    const hits = toneHit.filter(Boolean).length;
    let looksLikeBg = chromaticBg || tones.length < 2 || hits >= 2;
    let minArea = 200;

    /*
     * 격자를 지정했다면 더 과감하게 지운다.
     *
     * 체크무늬 시안에서는 한 칸짜리 회색 조각이 캐릭터에 갇혀 살아남는다.
     * 톤이 하나뿐이라 "배경"으로 인정받지 못하기 때문인데, 그 조각들이
     * 그대로 게임 화면에 회색 네모로 떠다닌다(실제로 그랬다).
     *
     * 자동 검출에서는 이 판정을 느슨하게 하면 캐릭터의 단색 회색 부분까지
     * 먹혀 프레임이 조각나므로 위험하다. 그런데 격자를 지정했다는 것은
     * 프레임이 어디인지 이미 안다는 뜻이라, 조각나도 잘라낼 자리는 변하지 않는다.
     */
    if (GRID) {
      looksLikeBg = true;
      minArea = 40;
    }

    if (region.length >= minArea && looksLikeBg) {
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
    const box = { x0: sx, x1: sx, y0: sy, y1: sy, area: 0, colored: 0, bw: 0 };
    const q = [start];
    comp[start] = id;

    while (q.length) {
      const p = q.pop();
      const x = p % W;
      const y = (p - x) / W;
      box.area++;
      // 채도 있는 픽셀 비율 — 라벨 텍스트(흑백)와 손·로고(유채색)를 가른다
      if (!isGray(p * 4)) box.colored++;

      /*
       * 아주 밝거나 아주 어두운 픽셀 비율. 라벨은 흰 글자 + 검은 외곽선이라
       * 이 비율이 매우 높다.
       *
       * 무채색일 때만 세면 안 된다 — 마젠타 배경 위의 흰 글자는 경계가
       * 분홍으로 번져 글자 면적의 상당 부분이 "유채색"이 되고, 그만큼
       * 비율이 떨어져 라벨 판정이 뒤집힌다. 실제로 그래서 라벨 한 조각이
       * 프레임에 남았다. 밝기만 보면 번져도 밝은 건 밝다.
       */
      const l = lum(p * 4);
      if (l > 200 || l < 60) box.bw++;
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
 * 격자 모드에서는 부스러기를 먼저 턴다.
 *
 * 체크무늬 시안에는 칸 경계의 얇은 선 조각이 여기저기 남는다. 크기가 작아
 * 라벨로도 스프라이트로도 분류되지 않는데, 경계상자를 잡을 때는 셈에 들어가
 * 빈 칸을 "내용이 있는 칸"으로 만들고 프레임 순서를 통째로 밀어버린다.
 * (실제로 잡스 시트에서 빈 칸 하나가 프레임 하나로 세어져 이후가 다 밀렸다)
 *
 * 자동 검출에서는 손대지 않는다 — 거기서는 작은 조각도 캐릭터의 일부일 수 있고,
 * 덩어리 묶기가 알아서 흡수한다.
 */
if (GRID) {
  const TINY_AREA = 100;
  let swept = 0;
  for (let p = 0; p < W * H; p++) {
    const c = comp[p];
    if (c >= 0 && comps[c].area < TINY_AREA && !bg[p]) {
      bg[p] = 1;
      swept++;
    }
  }
  if (swept) console.log(`부스러기 제거: ${swept}px`);
}

/*
 * 라벨 글자를 묶기 전에 걸러낸다.
 *
 * 글자는 흰 글자 + 검은 외곽선이라 채도가 거의 0이고 작다.
 * 반면 떨어져 나온 주먹(살색)·애플 로고(무지개)·이펙트는 유채색이므로 살아남는다.
 * 묶은 뒤에 지우려 하면 라벨이 캐릭터와 한 덩어리가 되어 분리할 수 없다.
 */
const LETTER_MAX_H = 100;
/** 라벨로 보려면 흑백 픽셀이 이 비율 이상이어야 한다 */
const LETTER_MIN_BW_RATIO = 0.5;

/*
 * "채도가 낮으면 라벨"로 판정하면 안 된다.
 * 흰 글자와 마젠타 배경 사이의 안티에일리어싱이 분홍색이라
 * 글자 면적의 상당 부분이 유채색으로 세어져 판정이 뒤집힌다.
 * 순백/순흑 비율로 보면 이 문제를 피할 수 있다 —
 * 캐릭터는 살색·옷색이 대부분이라 이 비율이 낮다.
 */
const isLetter = (c) =>
  c.y1 - c.y0 + 1 <= LETTER_MAX_H && c.bw / c.area >= LETTER_MIN_BW_RATIO;

const big = comps.filter((c) => c.area >= 150);
const letters = big.filter(isLetter);
const alive = big.filter((c) => !isLetter(c));

/*
 * 지울 글자는 더 작은 것까지 본다.
 *
 * 라벨은 글자마다 따로 떨어진 덩어리다. 스프라이트를 찾을 때 쓰는 문턱(150px)을
 * 그대로 적용하면 'l' 이나 ')' 같은 가는 글자가 그물을 빠져나가, 라벨 대부분이
 * 지워졌는데 몇 글자만 프레임에 남는다("Only)" 가 실제로 그렇게 남았다).
 *
 * 문턱을 낮춰도 그림이 지워지지는 않는다 — 순백/순흑 비율(bw)이 절반을 넘어야
 * 글자로 보는데, 캐릭터의 작은 조각은 대개 살색·옷색이라 이 조건에서 걸린다.
 */
const LETTER_MIN_AREA = 40;
const letterPixels = new Set(
  comps
    .map((c, i) => (c.area >= LETTER_MIN_AREA && isLetter(c) ? i : -1))
    .filter((i) => i >= 0),
);
console.log(`요소 ${comps.length}개 → 라벨 글자 제외 후 ${alive.length}개`);

/** 상자 목록을 여백 안에서 서로 겹치면 하나로 묶는다 */
function mergeBoxes(list, padX, padY, canMerge = () => true) {
  const out = list.map((c) => ({ ...c }));
  let merged = true;

  while (merged) {
    merged = false;
    outer: for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i];
        const b = out[j];
        const touch =
          a.x0 - padX <= b.x1 &&
          b.x0 - padX <= a.x1 &&
          a.y0 - padY <= b.y1 &&
          b.y0 - padY <= a.y1;
        if (!touch || !canMerge(a, b)) continue;

        a.x0 = Math.min(a.x0, b.x0);
        a.x1 = Math.max(a.x1, b.x1);
        a.y0 = Math.min(a.y0, b.y0);
        a.y1 = Math.max(a.y1, b.y1);
        a.area += b.area;
        out.splice(j, 1);
        merged = true;
        break outer;
      }
    }
  }
  return out;
}

/*
 * 배경만 있는 세로/가로 띠 = 격자 경계.
 *
 * 시트에 칸 구분선이 그려져 있거나 프레임 사이가 벌어져 있으면,
 * 그 자리는 거의 전부 배경이다. 이 띠를 넘는 병합을 막으면
 * 이펙트가 옆 칸으로 삐져나와도 프레임이 섞이지 않는다.
 */
function findSeparators(sizeA, sizeB, isBgAt) {
  const bands = [];
  let run = -1;

  for (let a = 0; a < sizeA; a++) {
    let bgCount = 0;
    for (let b = 0; b < sizeB; b++) if (isBgAt(a, b)) bgCount++;
    const clear = bgCount / sizeB >= 0.985;

    if (clear && run < 0) run = a;
    else if (!clear && run >= 0) {
      if (a - run >= 3) bands.push([run, a - 1]);
      run = -1;
    }
  }
  if (run >= 0 && sizeA - run >= 3) bands.push([run, sizeA - 1]);
  return bands;
}

const rowSeps = findSeparators(H, W, (y, x) => bg[y * W + x] === 1);

/*
 * 세로 경계는 행 밴드 안에서 따로 찾는다.
 *
 * 시트 전체 높이로 한 번에 찾으면, 어느 한 행에서 이펙트가 칸을 넘는 순간
 * 그 세로선이 통째로 무효가 되어 나머지 행까지 못 가른다.
 * 행마다 따로 보면 그 행에서 실제로 비어 있는 자리를 쓸 수 있다.
 */
const rowBands = [];
{
  let start = 0;
  for (const [s, e] of rowSeps) {
    if (s - start > 40) rowBands.push([start, s - 1]);
    start = e + 1;
  }
  if (H - start > 40) rowBands.push([start, H - 1]);
}

const bandCols = rowBands.map(([y0, y1]) =>
  findSeparators(W, y1 - y0 + 1, (x, k) => bg[(y0 + k) * W + x] === 1),
);
console.log(
  `격자 경계: 행 ${rowBands.length}개, 행별 세로 경계 ${bandCols.map((c) => c.length).join('/')}`,
);

/** 상자가 속한 행 밴드 (겹치는 면적이 가장 큰 것) */
const bandOf = (c) => {
  let best = -1;
  let bestOv = 0;
  rowBands.forEach(([y0, y1], i) => {
    const ov = Math.min(c.y1, y1) - Math.max(c.y0, y0);
    if (ov > bestOv) {
      bestOv = ov;
      best = i;
    }
  });
  return best;
};

/** 두 상자 사이에 격자 경계가 끼어 있으면 다른 프레임이다 */
function separated(a, b) {
  const ba = bandOf(a);
  const bb = bandOf(b);
  if (ba !== bb) return true;

  const gapX = a.x1 < b.x0 ? [a.x1, b.x0] : b.x1 < a.x0 ? [b.x1, a.x0] : null;
  if (!gapX) return false;

  const seps = bandCols[ba] ?? [];
  return seps.some((s) => s[0] > gapX[0] && s[1] < gapX[1]);
}

/*
 * 라벨을 격자 앵커로 쓴다.
 *
 * 근접 병합만으로는 이펙트가 큰 시트에서 무너진다 — 로켓 화염이나 폭발이
 * 옆 프레임까지 뻗으면 인접 프레임이 통째로 한 덩어리가 되어버린다.
 * 라벨이 있으면 프레임마다 정확히 하나씩, 아래에 붙어 있으므로
 * 그 x 중심이 곧 프레임의 열 위치다. 이걸 경계로 삼으면 화염이 아무리
 * 번져도 프레임이 섞이지 않는다.
 */
const words = mergeBoxes(letters, 46, 14).filter(
  (w) => w.x1 - w.x0 > 30, // 글자 하나짜리 노이즈 제외
);

let clusters;

if (words.length >= 4) {
  console.log(`라벨 ${words.length}개를 격자 앵커로 사용`);

  // 라벨을 y로 묶어 행을 만든다
  const rows = [];
  for (const w of words.slice().sort((a, b) => a.y0 - b.y0)) {
    const cy = (w.y0 + w.y1) / 2;
    const row = rows.find((r) => Math.abs(r.cy - cy) < 120);
    if (row) {
      row.items.push(w);
      row.cy = (row.cy * (row.items.length - 1) + cy) / row.items.length;
    } else {
      rows.push({ cy, items: [w] });
    }
  }
  rows.forEach((r) => r.items.sort((a, b) => a.x0 - b.x0));

  /** 이 요소가 속한 (행, 열) — 라벨은 스프라이트 아래에 있다 */
  const anchorOf = (c) => {
    const cx = (c.x0 + c.x1) / 2;
    // 요소의 아래쪽 끝보다 아래에 있는 가장 가까운 행
    let best = null;
    for (let ri = 0; ri < rows.length; ri++) {
      const d = rows[ri].cy - c.y1;
      if (d < -60) continue; // 이 행보다 훨씬 아래에 있는 요소
      if (!best || d < best.d) best = { ri, d };
    }
    const ri = best ? best.ri : rows.length - 1;

    // 그 행에서 x가 가장 가까운 라벨
    let ci = 0;
    let bd = Infinity;
    rows[ri].items.forEach((w, k) => {
      const d = Math.abs((w.x0 + w.x1) / 2 - cx);
      if (d < bd) {
        bd = d;
        ci = k;
      }
    });
    return `${ri}:${ci}`;
  };

  alive.forEach((c) => (c.anchor = anchorOf(c)));
  // 같은 칸에 배정됐고 격자 경계를 넘지 않는 것끼리만 병합한다
  clusters = mergeBoxes(
    alive,
    26,
    26,
    (a, b) => a.anchor === b.anchor && !separated(a, b),
  );
} else {
  // 라벨이 없는 시트 — 격자 경계만으로 가른다
  clusters = mergeBoxes(alive, 26, 26, (a, b) => !separated(a, b));
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

const frames = GRID ? sliceByGrid() : sprites;

/**
 * 격자를 알고 있을 때 — 칸마다 내용의 경계상자만 잡는다.
 *
 * 덩어리를 묶지 않으므로 이펙트가 옆 칸으로 번져도 프레임이 섞이지 않는다.
 * (번진 부분은 그 칸에서 잘려 나간다. 프레임이 통째로 뭉개지는 것보다 낫다)
 */
function sliceByGrid() {
  const cw = Math.floor(W / GRID.cols);
  const ch = Math.floor(H / GRID.rows);
  /*
   * 칸 경계에서 조금 안쪽부터 본다.
   *
   * 시안에 칸을 나누는 흰 선이 그려져 있으면 그 선이 배경이 아니라 내용으로
   * 잡혀, 모든 칸의 경계상자가 칸 전체가 되어버린다(= 아무것도 안 자른 것).
   * 격자를 지정했다는 것은 칸 경계를 안다는 뜻이니, 그 선폭만큼 물러선다.
   */
  const inset = Math.max(2, Math.round(Math.min(cw, ch) * 0.02));
  const out = [];

  for (let r = 0; r < GRID.rows; r++) {
    for (let c = 0; c < GRID.cols; c++) {
      const x0 = c * cw + inset;
      // 라벨 자리로 지정된 가장자리 띠는 아예 보지 않는다
      const y0 = r * ch + inset + Math.floor(ch * BAND_TOP);
      const xEnd = (c + 1) * cw - inset;
      const yEnd = (r + 1) * ch - inset - Math.floor(ch * BAND_BOTTOM);

      let bx0 = Infinity, bx1 = -1, by0 = Infinity, by1 = -1, area = 0;

      for (let y = y0; y < yEnd; y++) {
        for (let x = x0; x < xEnd; x++) {
          const p = y * W + x;
          if (bg[p]) continue;
          // 라벨로 판정된 덩어리는 프레임 내용이 아니다
          if (letterPixels.has(comp[p])) continue;

          area++;
          if (x < bx0) bx0 = x;
          if (x > bx1) bx1 = x;
          if (y < by0) by0 = y;
          if (y > by1) by1 = y;
        }
      }

      /*
       * 빈 칸은 건너뛴다.
       *
       * 기준을 낮게 잡으면 잔여물 몇 점이 프레임 하나로 세어져 이후 순서가
       * 전부 밀린다. 진짜 캐릭터는 수만 px이므로 문턱을 넉넉히 올려도 안전하다.
       */
      if (area < EMPTY_CELL_AREA) {
        console.log(`  [${r},${c}] 빈 칸 — 건너뜀 (내용 ${area}px)`);
        continue;
      }
      out.push({ x0: bx0, x1: bx1, y0: by0, y1: by1, area });
    }
  }
  return out;
}

console.log(
  GRID
    ? `격자 지정 ${GRID.cols}x${GRID.rows} → 프레임 ${frames.length}개`
    : `검출된 프레임: ${frames.length}개`,
);
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
const cols = GRID ? GRID.cols : Math.min(frames.length, 6);
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
      /*
       * 경계상자 안이라고 전부 복사하면 안 된다 —
       * 프레임 아래 라벨이 상자에 걸치면 글자가 그대로 딸려 들어간다.
       * 라벨로 판정된 연결 요소의 픽셀은 건너뛴다.
       */
      if (letterPixels.has(comp[src])) continue;
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
