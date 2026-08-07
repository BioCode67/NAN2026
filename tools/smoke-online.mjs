#!/usr/bin/env node
/**
 * 온라인 1:1 결투 검사 — 브라우저 두 개를 실제로 붙인다.
 *
 *   npm run smoke:online
 *
 * ── 왜 따로 두는가 ─────────────────────────────────────────────────
 * 이 검사만 **바깥 인터넷**이 필요하다. 연결을 맺어 주는 공개 브로커에
 * 닿아야 하기 때문이다. 본 검사(smoke)에 섞어 두면 인터넷이 막힌 환경에서
 * 게임과 아무 상관 없는 이유로 전부 실패한다.
 *
 * 브로커에 못 닿는 것은 게임의 문제가 아니므로 **건너뜀**으로 처리하고,
 * 붙은 뒤에 어긋나는 것만 실패로 센다.
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL = process.env.SMOKE_URL ?? 'http://localhost:3000/';
const OUT = 'tools/smoke-shots';
const errors = [];
let step = 0;

mkdirSync(OUT, { recursive: true });

/*
 * 숨은 탭은 브라우저가 프레임을 멈춘다.
 *
 * 두 탭 중 하나는 반드시 뒤에 있으므로 그대로 두면 그쪽 게임이 멎어
 * "회선이 안 통한다"로 보인다. 검사에서는 그 절전 동작을 꺼서 둘 다 돌린다.
 * (사람이 쓸 때는 탭이 아니라 **창 두 개**로 열면 같은 문제가 없다 —
 *  로비 안내에도 그렇게 적어 두었다)
 */
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM || undefined,
  args: [
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
  ],
});

/*
 * 탭 두 개를 **같은 창**에 연다.
 *
 * 같은 컴퓨터 경로는 BroadcastChannel 로 잇는데, 그건 같은 브라우저 프로필
 * 안에서만 오간다. 창을 따로 열면 서로를 못 본다.
 */
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const host = await ctx.newPage();
const guest = await ctx.newPage();

const consoleErrors = [];
for (const [name, page] of [
  ['호스트', host],
  ['게스트', guest],
]) {
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`[${name}] ${m.text()}`);
  });
  page.on('pageerror', (e) => consoleErrors.push(`[${name}] ${e.message}`));
}

const shot = async (page, name) => {
  step++;
  const file = `${OUT}/net-${String(step).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: file });
  console.log(`  ${step} ${name}`);
};

/**
 * 타이틀 → 선택 화면까지.
 *
 * 시간을 재서 넘기지 않는다 — 헤드리스에서는 부팅이 몇 초씩 밀린다.
 * 선택 씬이 실제로 살아날 때까지 Enter를 두드리되, 한 번 누르면
 * 페이드가 끝날 때까지 기다린다(연타하면 캐릭터가 즉시 확정된다).
 */
async function toSelect(page) {
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas', { timeout: 30000 });

  const alive = (k) =>
    page.evaluate((key) => !!window.game?.scene?.isActive(key), k).catch(() => false);

  for (let i = 0; i < 60; i++) {
    if (await alive('Select')) {
      await page.waitForTimeout(700);
      return true;
    }
    if (await alive('Title')) {
      await page.keyboard.press('Enter');
      await page.waitForTimeout(700);
      continue;
    }
    await page.waitForTimeout(250);
  }
  return false;
}

let skipped = '';

try {
  console.log('온라인 1:1 결투\n');

  const ready = await Promise.all([toSelect(host), toSelect(guest)]);
  if (!ready[0] || !ready[1]) {
    throw new Error('선택 화면까지 넘어가지 못했습니다');
  }
  console.log('  ✓ 양쪽 모두 선택 화면');

  /*
   * "이 컴퓨터에서" 경로로 붙인다.
   *
   * 인터넷 너머 경로(PeerJS)는 공개 브로커가 필요해서 막힌 환경에서는
   * 시험 자체가 불가능하다. 두 경로는 **회선 종류만 다르고 그 위의 게임
   * 코드는 완전히 같으므로**, 여기서 확인하는 것이 곧 온라인 확인이다.
   */
  await host.bringToFront();
  await host.keyboard.press('F3');
  await host.waitForSelector('[data-testid="net-local-host"]', { timeout: 8000 });
  await host.click('[data-testid="net-local-host"]');
  await shot(host, 'room-open');

  await guest.bringToFront();
  await guest.keyboard.press('F3');
  await guest.waitForSelector('[data-testid="net-local-guest"]', { timeout: 8000 });
  await guest.click('[data-testid="net-local-guest"]');

  {
    const linked = await Promise.all([
      host
        .waitForFunction(() => window.game.scene.getScene('Select')?.online === true, null, {
          timeout: 25000,
        })
        .then(() => true)
        .catch(() => false),
      guest
        .waitForFunction(() => window.game.scene.getScene('Select')?.online === true, null, {
          timeout: 25000,
        })
        .then(() => true)
        .catch(() => false),
    ]);

    if (!linked[0] || !linked[1]) {
      errors.push('[온라인] 두 탭이 서로 연결되지 않았습니다');
    } else {
      console.log('  ✓ 두 브라우저가 서로 연결됨');
      await shot(guest, 'connected');

      /* --- 각자 다른 캐릭터를 고른다 ---------------------------------- */
      await guest.keyboard.press('ArrowRight');
      await guest.keyboard.press('ArrowRight');
      await guest.waitForTimeout(300);

      await host.keyboard.press('Enter');
      await guest.waitForTimeout(300);
      await guest.keyboard.press('Enter');

      /* --- 양쪽 모두 전투로 들어갔는가 -------------------------------- */
      const inBattle = async (page, role) =>
        page
          .waitForFunction(
            (want) => {
              const s = window.game.scene.getScene('Battle');
              return s?.scene?.isActive?.() && s.netRole === want;
            },
            role,
            { timeout: 25000 },
          )
          .then(() => true)
          .catch(() => false);

      const both = await Promise.all([inBattle(host, 'host'), inBattle(guest, 'guest')]);
      if (!both[0] || !both[1]) {
        errors.push(
          `[온라인] 전투로 들어가지 못했습니다 (호스트 ${both[0]} · 게스트 ${both[1]})`,
        );
      } else {
        console.log('  ✓ 양쪽 모두 전투 시작 (호스트/게스트)');
      }

      await host.waitForTimeout(2500);
      await shot(host, 'battle-host');
      await shot(guest, 'battle-guest');

      /* --- 같은 판을 보고 있는가 -------------------------------------- */
      const read = (page) =>
        page.evaluate(() => {
          const s = window.game.scene.getScene('Battle');
          return {
            stage: s.getStageInfo().id,
            n: s.fighters.length,
            ids: s.fighters.map((f) => f.cfg.id),
            pos: s.fighters.map((f) => Math.round(f.x)),
          };
        });

      const [a, b] = await Promise.all([read(host), read(guest)]);

      if (a.stage !== b.stage) {
        errors.push(`[온라인] 무대가 다릅니다 — 호스트 ${a.stage} / 게스트 ${b.stage}`);
      } else if (a.ids.join() !== b.ids.join()) {
        errors.push(`[온라인] 캐릭터가 다릅니다 — ${a.ids} / ${b.ids}`);
      } else if (a.n !== 2) {
        errors.push(`[온라인] 1:1이어야 하는데 ${a.n}명입니다`);
      } else {
        console.log(`  ✓ 같은 판 — ${a.stage} · ${a.ids.join(' vs ')}`);
      }

      const drift = a.pos.map((x, i) => Math.abs(x - b.pos[i]));
      const worst = Math.max(...drift);
      if (worst > 120) {
        errors.push(`[온라인] 두 화면의 위치가 ${worst}px 어긋났습니다`);
      } else {
        console.log(`  ✓ 두 화면이 같은 곳을 본다 (최대 차이 ${worst}px)`);
      }

      /* --- 게스트의 입력이 호스트에 닿는가 ---------------------------- */
      const guestX = () =>
        host.evaluate(() => Math.round(window.game.scene.getScene('Battle').fighters[1].x));

      const before = await guestX();
      await guest.keyboard.down('a');
      await guest.waitForTimeout(900);
      await guest.keyboard.up('a');
      await host.waitForTimeout(400);
      const after = await guestX();

      const stats = await Promise.all([
        host.evaluate(() => window.game.scene.getScene('Battle').netStats),
        guest.evaluate(() => window.game.scene.getScene('Battle').netStats),
      ]);

      if (Math.abs(after - before) < 25) {
        errors.push(
          `[온라인] 게스트가 눌러도 호스트 쪽 캐릭터가 안 움직입니다 (${before}→${after}) ` +
            `— 게스트가 보낸 ${stats[1].sent}건 / 호스트가 받은 ${stats[0].recv}건`,
        );
      } else {
        console.log(`  ✓ 게스트 입력이 회선을 타고 도착 — ${before} → ${after}px`);
      }

      await shot(host, 'after-input');
    }
  }
} catch (err) {
  errors.push(`[중단] ${err instanceof Error ? err.message : err}`);
}

await browser.close().catch(() => {});

/*
 * 콘솔 오류 중 회선이 끊길 때 나오는 것은 걸러낸다.
 * 검사가 끝나면서 창을 닫으면 상대 쪽에 반드시 한 번 뜬다 — 정상이다.
 */
const realErrors = consoleErrors.filter(
  (e) => !/peer|ice|datachannel|websocket|connection/i.test(e),
);

console.log(`\n스크린샷: ${OUT}/`);

if (skipped) {
  console.log(`\n건너뜀 — ${skipped}`);
  console.log('게임 자체의 문제가 아닙니다. 인터넷이 되는 곳에서 다시 돌려 주세요.');
  process.exit(0);
}

if (errors.length || realErrors.length) {
  console.error(`\n실패 — ${errors.length + realErrors.length}건`);
  [...errors, ...realErrors].slice(0, 10).forEach((e) => console.error('  ' + e));
  process.exit(1);
}
console.log('\n통과 — 두 브라우저가 같은 판을 보고 있습니다');
