#!/usr/bin/env node
/**
 * 스모크 테스트 — 변경 후 게임이 실제로 돌아가는지 항상 같은 기준으로 확인한다.
 *
 * "선택 → 전투 진입 → 이동/점프/약공격/강공격/스킬/방어/대시 → 결과"
 * 경로를 자동으로 밟으며 각 단계 스크린샷을 남기고, 콘솔 오류가 하나라도
 * 있으면 실패로 끝난다.
 *
 * 사용법:
 *   npm run dev                   (다른 터미널에서 먼저 실행)
 *   npm run smoke                 (1번 캐릭터)
 *   npm run smoke -- 4            (5번 캐릭터 — 0부터 셈)
 *   HEADED=1 npm run smoke        (창을 띄워 눈으로 확인)
 *
 * 결과물: tools/smoke-shots/*.png
 *
 * 주의: 헤드리스는 소프트웨어 렌더러라 4~6 FPS로 느리다.
 *       성능을 볼 목적이면 HEADED=1 로 볼 것 (실측 60 FPS).
 */

import { mkdirSync, rmSync } from 'node:fs';

const URL = process.env.SMOKE_URL ?? 'http://localhost:3000';
const PICK = Number(process.argv[2] ?? 0);
// 자동화가 기본이므로 헤드리스. 눈으로 볼 때만 HEADED=1
const HEADLESS = process.env.HEADED !== '1';
const OUT = 'tools/smoke-shots';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error(
    'playwright가 없습니다:\n  npm i -D playwright && npx playwright install chromium',
  );
  process.exit(1);
}

// 서버가 떠 있는지 먼저 확인 — 없으면 원인 모를 타임아웃 대신 바로 알려준다
try {
  const res = await fetch(URL, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(String(res.status));
} catch {
  console.error(`${URL} 에 접속할 수 없습니다. 먼저 "npm run dev" 를 실행하세요.`);
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const errors = [];
const browser = await chromium.launch({ headless: HEADLESS });
const page = await (
  await browser.newContext({ viewport: { width: 1400, height: 900 } })
).newPage();

page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  // 파비콘 등 게임과 무관한 404는 무시
  if (/favicon|sourcemap/i.test(m.text())) return;
  errors.push(`[console] ${m.text()}`);
});

let step = 0;
const shot = async (name) => {
  const n = String(++step).padStart(2, '0');
  await page.screenshot({ path: `${OUT}/${n}-${name}.png` });
  console.log(`  ${n} ${name}`);
};
const hold = async (key, ms) => {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
};

console.log(`스모크 테스트 → ${URL} (캐릭터 #${PICK})`);

/*
 * 아래 시나리오 전체를 try로 감싼다.
 * 창을 실수로 닫는 등으로 브라우저가 죽어도 원인과 진행 단계를 알려주기 위함.
 */
try {
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('canvas', { timeout: 30000 });
await page.waitForTimeout(3000);
await shot('select');

for (let i = 0; i < PICK; i++) {
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(250);
}
await shot('picked');

await page.keyboard.press('Enter');
// 페이드아웃 + 전투 생성 + READY/FIGHT 연출
await page.waitForTimeout(3600);
await shot('battle-start');

console.log('이동 · 점프');
await hold('d', 500);
await shot('run');
await page.keyboard.press('Space');
await page.waitForTimeout(200);
await shot('jump');
await page.waitForTimeout(200);
await page.keyboard.press('Space');
await page.waitForTimeout(250);
await shot('double-jump');
await page.waitForTimeout(700);

console.log('약공격 · 강공격');
await hold('j', 120);
await shot('attack-light');
await page.waitForTimeout(500);
await hold('k', 260);
await shot('attack-heavy');
await page.waitForTimeout(700);

console.log('스킬');
await page.keyboard.press('l');
await page.waitForTimeout(340);
await shot('skill');
await page.waitForTimeout(400);
await shot('skill-after');

console.log('방어 · 대시');
await hold('s', 600);
await shot('guard');
await page.waitForTimeout(200);
await page.keyboard.press('d');
await page.waitForTimeout(80);
await page.keyboard.press('d');
await page.waitForTimeout(150);
await shot('dash');

console.log('전투 진행');
for (let i = 0; i < 20; i++) {
  await page.keyboard.press('j');
  await page.waitForTimeout(180);
  await page.keyboard.press('k');
  await page.waitForTimeout(300);
  if (i % 6 === 0) await page.keyboard.press('l');
}
await shot('mid-battle');
await page.waitForTimeout(2500);
await shot('final');
} catch (err) {
  errors.push(`[중단] ${step}단계 이후: ${err instanceof Error ? err.message : err}`);
}

await browser.close().catch(() => {});

console.log(`\n스크린샷: ${OUT}/`);
if (errors.length) {
  console.error(`\n실패 — 콘솔 오류 ${errors.length}건`);
  errors.slice(0, 10).forEach((e) => console.error('  ' + e));
  process.exit(1);
}
console.log('\n통과 — 콘솔 오류 없음');
