#!/usr/bin/env node
/**
 * 그림 최적화 — 생성기가 뱉은 PNG를 웹에 올릴 수 있는 무게로 줄인다.
 *
 * 생성형 이미지는 무손실 PNG로 온다. 배경 한 장이 6MB고 다섯 장이면 30MB다.
 * 심사자는 이 게임을 **브라우저에서 바로** 열어 보므로, 그 30MB가 곧
 * "안 켜지는 게임"이 된다. 해상도는 그대로 두고 포맷만 WebP로 바꾸면
 * 눈에 보이는 손실 없이 5~10배가 준다.
 *
 * 원본 PNG는 지우지 않는다. 다시 뽑을 때 비교할 것이 있어야 하고,
 * 게임은 webp가 있으면 그쪽을, 없으면 png를 쓴다(artAssets.ts).
 *
 * 사용법:
 *   npm run art:opt              # 아직 안 줄인 것만
 *   npm run art:opt -- --force   # 전부 다시
 *   npm run art:opt -- --report  # 무엇이 얼마나 무거운지만 보고 끝
 *   npm run art:opt -- --quality 0.9 --max-width 2560
 *
 * 인코딩은 크로미움 캔버스로 한다. sharp 같은 네이티브 의존성을 새로 깔지
 * 않으려는 것 — playwright는 스모크 테스트 때문에 어차피 들어와 있다.
 */

import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { globSync } from 'node:fs';

/* ------------------------------------------------------------------ */
/* 대상                                                                */
/* ------------------------------------------------------------------ */

/**
 * 무엇을 줄일 것인가.
 *
 * maxWidth 를 두지 않은 것은 해상도를 건드리지 않는다는 뜻이다.
 * 배경은 화면이 큰 모니터에서 2배로 확대돼 깔리므로 원본 해상도가 필요하고,
 * 스프라이트 시트는 프레임 크기가 sprites/*.json 에 적혀 있어
 * 줄이면 그 값과 어긋난다.
 */
const TARGETS = [
  { glob: 'public/bg/*.png', quality: 0.85 },
  { glob: 'public/ui/*.png', quality: 0.9 },
  { glob: 'public/sprites/*.png', quality: 0.92 },
];

/* ------------------------------------------------------------------ */

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const opt = (f, d) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : d;
};

const FORCE = has('--force');
const REPORT_ONLY = has('--report');
const QUALITY = opt('--quality', null);
const MAX_WIDTH = opt('--max-width', null);

const mb = (n) => `${(n / 1048576).toFixed(2)}MB`;
const kb = (n) => `${(n / 1024).toFixed(0)}KB`;

/** 대상 파일을 모은다 */
function collect() {
  const out = [];
  for (const t of TARGETS) {
    for (const src of globSync(t.glob).sort()) {
      out.push({
        src,
        out: src.replace(/\.png$/i, '.webp'),
        quality: QUALITY ?? t.quality,
        maxWidth: MAX_WIDTH ?? t.maxWidth ?? null,
      });
    }
  }
  return out;
}

const files = collect();

if (files.length === 0) {
  console.log('줄일 그림이 없습니다.');
  process.exit(0);
}

/* --report — 현황만 보여주고 끝 */
if (REPORT_ONLY) {
  let totalPng = 0;
  let totalWebp = 0;
  console.log('\n원본(PNG)          최적화(WebP)      파일');
  console.log('─'.repeat(64));
  for (const f of files) {
    const pngSize = statSync(f.src).size;
    const webpSize = existsSync(f.out) ? statSync(f.out).size : 0;
    totalPng += pngSize;
    totalWebp += webpSize || pngSize;
    console.log(
      `${kb(pngSize).padStart(9)}   ${(webpSize ? kb(webpSize) : '—').padStart(14)}      ${f.src}`,
    );
  }
  console.log('─'.repeat(64));
  console.log(`${mb(totalPng).padStart(9)}   ${mb(totalWebp).padStart(14)}      합계 (실제 배포되는 쪽은 오른쪽)\n`);
  process.exit(0);
}

const todo = FORCE
  ? files
  : files.filter(
      (f) => !existsSync(f.out) || statSync(f.src).mtimeMs > statSync(f.out).mtimeMs,
    );

if (todo.length === 0) {
  console.log(`이미 전부 최적화돼 있습니다 (${files.length}장). 다시 하려면 --force`);
  process.exit(0);
}

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error(
    'playwright가 없습니다:\n  npm i -D playwright && npx playwright install chromium',
  );
  process.exit(1);
}

const browser = await chromium.launch({
  ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
});
const page = await browser.newPage();
await page.goto('about:blank');

console.log(`\n그림 최적화 — ${todo.length}장\n`);

let before = 0;
let after = 0;

for (const f of todo) {
  const raw = readFileSync(f.src);
  const dataUrl = `data:image/png;base64,${raw.toString('base64')}`;

  const encoded = await page.evaluate(
    async ({ dataUrl, quality, maxWidth }) => {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();

      const scale = maxWidth && img.width > maxWidth ? maxWidth / img.width : 1;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);

      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = scale !== 1;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      return {
        url: canvas.toDataURL('image/webp', quality),
        w: canvas.width,
        h: canvas.height,
      };
    },
    { dataUrl, quality: f.quality, maxWidth: f.maxWidth },
  );

  if (!encoded.url.startsWith('data:image/webp')) {
    console.error(`  ✗ ${basename(f.src)} — WebP 인코딩을 지원하지 않는 브라우저입니다`);
    continue;
  }

  const buf = Buffer.from(encoded.url.split(',')[1], 'base64');
  writeFileSync(f.out, buf);

  const src = raw.length;
  before += src;
  after += buf.length;

  const pct = Math.round((1 - buf.length / src) * 100);
  console.log(
    `  ✓ ${basename(f.src).padEnd(24)} ${kb(src).padStart(8)} → ${kb(buf.length).padStart(8)}  (-${pct}%)  ${encoded.w}x${encoded.h}`,
  );
}

await browser.close();

console.log(
  `\n합계 ${mb(before)} → ${mb(after)}  (-${Math.round((1 - after / before) * 100)}%)`,
);
console.log('원본 PNG는 그대로 뒀습니다. 게임은 webp가 있으면 그쪽을 씁니다.\n');
