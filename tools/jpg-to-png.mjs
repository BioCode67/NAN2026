#!/usr/bin/env node
/**
 * 받은 JPG 묶음을 PNG 로 바꿔 둔다.
 *
 *   npm run art:jpg
 *
 * ── 왜 필요한가 ────────────────────────────────────────────────────
 * 그림 생성기에서 내려받으면 JPG 로 오는 경우가 있다. 그런데 시트 처리는
 * PNG 만 읽는다 — 그러면 "올렸는데 아무 일도 안 일어난다"가 되고, 왜 그런지
 * 알아내는 데 사람 시간이 든다. 받은 것을 그대로 받아 주는 편이 낫다.
 *
 * ── JPG 는 손해를 본다 (그래서 경고한다) ──────────────────────────
 * 배경을 마젠타 단색으로 시켜 두고 그 색을 잘라내는 방식인데, JPG 는 색을
 * 뭉개 저장하므로 **경계에 마젠타가 번진 띠가 남는다.** 잘라낸 뒤에도
 * 분홍 테두리가 붙어 나오는 이유가 이것이다. 지울 수는 있지만 원본이
 * PNG 였으면 애초에 생기지 않았을 일이라, 크기와 함께 알려 준다.
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'art-source';
/** 이보다 칸이 작으면 게임에서 확대되어 뭉개진다 (그려지는 키가 144px) */
const MIN_CELL = 260;

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('playwright 가 없습니다:\n  npm i -D playwright');
  process.exit(1);
}

const jpgs = readdirSync(DIR).filter((f) => /_b\d+\.jpe?g$/i.test(f));
if (!jpgs.length) {
  console.log('바꿀 JPG 가 없습니다.');
  process.exit(0);
}

console.log(`JPG → PNG — ${jpgs.length}장\n`);

const browser = await chromium.launch({
  ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
});
const page = await browser.newPage();

const warnings = [];

for (const name of jpgs) {
  const src = join(DIR, name);
  const out = src.replace(/\.jpe?g$/i, '.png');

  // 이미 바꿔 둔 것이 더 새것이면 건드리지 않는다
  if (existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs) {
    console.log(`  · ${name} — 이미 바꿔 두었습니다`);
    continue;
  }

  const dataUrl = `data:image/jpeg;base64,${readFileSync(src).toString('base64')}`;
  const { png, width, height } = await page.evaluate(async (url) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);
    return {
      png: canvas.toDataURL('image/png').split(',')[1],
      width: canvas.width,
      height: canvas.height,
    };
  }, dataUrl);

  writeFileSync(out, Buffer.from(png, 'base64'));
  const cell = Math.round(width / 6);
  console.log(`  ✓ ${name} → ${out.split('/').pop()}  (${width}x${height} · 칸당 ${cell}px)`);

  if (cell < MIN_CELL) {
    warnings.push(
      `${name}: 칸당 ${cell}px — 게임에서 그려지는 키가 144px 이라 여유가 거의 없습니다`,
    );
  }
}

await browser.close();

if (warnings.length) {
  console.log('\n알아 두실 것');
  for (const w of warnings) console.log(`  · ${w}`);
  console.log(
    '\n  JPG 는 색을 뭉개 저장해서 마젠타 배경이 경계에 번집니다.\n' +
      '  받을 때 PNG 로, 가로 3000px 이상으로 받으면 훨씬 깨끗합니다.',
  );
}
