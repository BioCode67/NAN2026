#!/usr/bin/env node
/**
 * 제출 문서 HTML → PDF.
 *
 * 대회 제출물 ③④는 PDF로 내야 한다. 브라우저에서 Ctrl+P 를 눌러 저장해도
 * 되지만, 그러면 고칠 때마다 사람이 같은 손동작을 반복하고 여백·배경
 * 설정을 매번 다시 맞춰야 한다. 문서를 고치는 일은 제출 직전까지 계속
 * 일어나므로 그 반복을 없앤다.
 *
 * 사용법:
 *   npm run docs            # docs/submission/*.html → 같은 이름의 .pdf
 *   npm run docs -- --open  # 만든 뒤 폴더를 연다
 *
 * 인쇄 서식은 HTML 쪽 CSS(@page)가 쥐고 있다 (preferCSSPageSize).
 * 여기서 여백을 또 정하면 두 곳이 어긋나 한쪽만 고치는 일이 생긴다.
 */

import { existsSync, mkdirSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { globSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SRC = 'docs/submission';
const args = process.argv.slice(2);

if (!existsSync(SRC)) {
  console.error(`${SRC} 폴더가 없습니다.`);
  process.exit(1);
}

/* 밑줄로 시작하는 것은 부분 파일(_style.css 등)이라 문서가 아니다 */
const pages = globSync(`${SRC}/*.html`)
  .filter((p) => !basename(p).startsWith('_'))
  .sort();

if (pages.length === 0) {
  console.error(`${SRC} 에 만들 문서가 없습니다.`);
  process.exit(1);
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

const outDir = resolve(SRC, 'pdf');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
});
const page = await browser.newPage();

console.log(`\n제출 문서 PDF — ${pages.length}건\n`);

for (const src of pages) {
  const name = basename(src).replace(/\.html$/i, '.pdf');
  const out = resolve(outDir, name);

  await page.goto(pathToFileURL(resolve(src)).href, { waitUntil: 'load' });

  /*
   * 웹폰트를 쓰지 않지만, 한글 시스템 폰트가 자리를 잡기 전에 찍으면
   * 줄바꿈이 밀린 채로 굳는다. 폰트 준비를 명시적으로 기다린다.
   */
  await page.evaluate(() => document.fonts.ready);

  await page.pdf({
    path: out,
    printBackground: true,
    // 여백·용지는 HTML의 @page 규칙을 따른다
    preferCSSPageSize: true,
  });

  console.log(`  ✓ ${name.padEnd(28)} ${(statSync(out).size / 1024).toFixed(0)}KB`);
}

await browser.close();

console.log(`\n${outDir}\n`);

if (args.includes('--open')) {
  const { spawn } = await import('node:child_process');
  const cmd =
    process.platform === 'win32'
      ? ['explorer', [outDir]]
      : process.platform === 'darwin'
        ? ['open', [outDir]]
        : ['xdg-open', [outDir]];
  spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore' }).unref();
}
