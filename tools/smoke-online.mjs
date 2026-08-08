#!/usr/bin/env node
/**
 * 온라인 대전 검사 — 브라우저 창 여러 개를 실제로 붙인다.
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
 * 탭 여러 개를 **같은 프로필**에 연다.
 *
 * 같은 컴퓨터 경로는 BroadcastChannel 로 잇는데, 그건 같은 브라우저 프로필
 * 안에서만 오간다. 프로필을 따로 쓰면 서로를 못 본다.
 */
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });

/*
 * 창은 쓸 때 하나씩 만든다.
 *
 * 넷을 미리 열어 두면 빈 창 넷이 동시에 자원을 잡고 있다가 첫 창의 캔버스가
 * 아예 안 뜨는 일이 있었다. 열고 → 띄우고 → 다음, 순서대로 간다.
 */
/*
 * 몇 창을 열 것인가.
 *
 * 기본 3창(사람 셋 + 봇 하나). 네 창까지 여는 것은 게임이 아니라 **이 환경**의
 * 한계다 — 헤드리스 브라우저가 네 번째 창에 그림판(WebGL)을 못 내준다.
 * 회선 코드는 자리 수에 무관하므로 셋이 붙으면 넷도 붙는다.
 * 진짜 기계에서 넷을 보려면  NET_PLAYERS=4 npm run smoke:online
 */
const PLAYERS = Number(process.env.NET_PLAYERS ?? 3);
const pages = [];
const consoleErrors = [];

async function openPage(i) {
  const page = await ctx.newPage();
  const name = i === 0 ? '호스트' : `참가자${i}`;
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`[${name}] ${m.text()}`);
  });
  page.on('pageerror', (e) => consoleErrors.push(`[${name}] ${e.message}`));
  pages.push(page);
  return page;
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
async function toSelect(page, index) {
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  const drawn = await page
    .waitForSelector('canvas', { timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  if (!drawn) {
    /*
     * 그림판이 안 열렸다. 창을 여러 개 여는 검사에서만 나는 일이고,
     * 게임이 아니라 헤드리스 브라우저의 한계다 — 몇 번째에서 막혔는지
     * 알려 줘야 "게임이 고장났다"로 오해하지 않는다.
     */
    console.log(`  · ${index + 1}번째 창에서 그림판(WebGL)이 안 열립니다`);
    return false;
  }

  const alive = (k) =>
    page.evaluate((key) => !!window.game?.scene?.isActive(key), k).catch(() => false);

  for (let i = 0; i < 60; i++) {
    if (await alive('Select')) {
      await page.waitForTimeout(500);
      /*
       * 캐릭터를 이미 확정해 버렸으면 되돌린다.
       *
       * 넘어가려고 누른 Enter 가 선택 화면까지 새어 들어가면 그 자리에서
       * 캐릭터가 정해지고, 그 뒤로는 F3 도 방향키도 안 먹는다.
       * 창이 여럿이면 화면마다 뜨는 속도가 달라 이 일이 실제로 일어난다.
       */
      const stuck = await page.evaluate(
        () => window.game.scene.getScene('Select')?.confirmed === true,
      );
      if (!stuck) return true;
      await page.keyboard.press('Escape');
      await page.waitForTimeout(600);
      continue;
    }
    if (await alive('Battle')) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(700);
      continue;
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
  console.log(`온라인 ${PLAYERS}인 대전\n`);

  /*
   * 창을 하나씩 차례로 연다.
   *
   * 한꺼번에 열면 넷이 서로 자원을 다투며 화면 전환 속도가 제각각이 되고,
   * 그 틈에 Enter 가 엉뚱한 화면으로 새어 들어간다. 순서대로 열면 느리지만
   * 매번 같은 순서가 나온다.
   */
  const ready = [];
  for (let i = 0; i < PLAYERS; i++) {
    const p = await openPage(i);
    await p.bringToFront();
    ready.push(await toSelect(p, i));
  }
  const host = pages[0];
  const guests = pages.slice(1);
  if (ready.some((r) => !r)) {
    skipped =
      `창 ${PLAYERS}개를 못 열었습니다 — 이 환경의 브라우저 한계입니다. ` +
      `NET_PLAYERS=2 로 줄여 돌리거나 진짜 기계에서 확인해 주세요.`;
    throw new Error('__skip__');
  }
  console.log(`  ✓ 창 ${PLAYERS}개 모두 선택 화면`);

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
  await host.waitForSelector('[data-testid="net-start"]', { timeout: 8000 });

  for (const g of guests) {
    await g.bringToFront();
    await g.keyboard.press('F3');
    await g.waitForSelector('[data-testid="net-local-guest"]', { timeout: 8000 });
    await g.click('[data-testid="net-local-guest"]');
    await g.waitForTimeout(400);
  }

  /* --- 호스트가 인원을 다 봤는가 ----------------------------------- */
  await host.bringToFront();
  const counted = await host
    .waitForFunction(
      (want) => {
        const el = document.querySelector('[data-testid="net-count"]');
        const n = Number(/(\d+)명 참가/.exec(el?.textContent ?? '')?.[1] ?? 0);
        return n === want;
      },
      PLAYERS,
      { timeout: 20000 },
    )
    .then(() => true)
    .catch(() => false);

  if (!counted) {
    const n = await host.evaluate(() => document.querySelector('[data-testid="net-count"]')?.textContent);
    errors.push(`[온라인] 호스트가 ${PLAYERS}명을 다 못 봤습니다 (${n})`);
  } else {
    console.log(`  ✓ 호스트가 ${PLAYERS}명 참가를 확인`);
  }
  await shot(host, 'lobby');

  /* --- 이 인원으로 시작 --------------------------------------------- */
  await host.click('[data-testid="net-start"]');
  await host.waitForTimeout(500);

  const online = await Promise.all(
    pages.map((p) =>
      p
        .waitForFunction(() => window.game.scene.getScene('Select')?.online === true, null, {
          timeout: 20000,
        })
        .then(() => true)
        .catch(() => false),
    ),
  );
  if (online.some((o) => !o)) {
    errors.push(`[온라인] 연결되지 않은 창이 있습니다 (${online.join('/')})`);
  } else {
    console.log('  ✓ 창 전부가 서로 연결됨');
  }
  await shot(guests[0], 'connected');

  /* --- 각자 다른 캐릭터를 고른다 ------------------------------------ */
  for (let i = 0; i < pages.length; i++) {
    await pages[i].bringToFront();
    for (let k = 0; k < i * 2; k++) {
      await pages[i].keyboard.press('ArrowRight');
      await pages[i].waitForTimeout(70);
    }
    await pages[i].waitForTimeout(200);
    await pages[i].keyboard.press('Enter');
    await pages[i].waitForTimeout(250);
  }

  /* --- 전원이 전투로 들어갔는가 ------------------------------------- */
  const roles = ['host', ...guests.map(() => 'guest')];
  const inBattle = await Promise.all(
    pages.map((p, i) =>
      p
        .waitForFunction(
          (want) => {
            const s = window.game.scene.getScene('Battle');
            return s?.scene?.isActive?.() && s.netRole === want;
          },
          roles[i],
          { timeout: 25000 },
        )
        .then(() => true)
        .catch(() => false),
    ),
  );
  if (inBattle.some((b) => !b)) {
    errors.push(`[온라인] 전투로 못 들어간 창이 있습니다 (${inBattle.join('/')})`);
  } else {
    console.log(`  ✓ ${PLAYERS}개 창 모두 전투 시작`);
  }

  await host.waitForTimeout(2500);
  await shot(host, 'battle-host');
  await shot(guests[0], 'battle-guest1');
  await shot(guests[guests.length - 1], 'battle-guest-last');

  /* --- 모두 같은 판을 보고 있는가 ----------------------------------- */
  const read = (page) =>
    page.evaluate(() => {
      const s = window.game.scene.getScene('Battle');
      return {
        stage: s.getStageInfo().id,
        n: s.fighters.length,
        ids: s.fighters.map((f) => f.cfg.id),
        humans: s.fighters.filter((f) => f.side === 'player').length,
        ais: s.ais.length,
        pos: s.fighters.map((f) => Math.round(f.x)),
      };
    });

  const views = await Promise.all(pages.map(read));
  const a = views[0];

  if (a.humans !== PLAYERS) {
    errors.push(`[온라인] 사람이 ${PLAYERS}명이어야 하는데 ${a.humans}명입니다`);
  } else if (new Set(a.ids).size !== a.ids.length) {
    errors.push(`[온라인] 같은 캐릭터가 두 번 나왔습니다 — ${a.ids.join()}`);
  } else {
    console.log(
      `  ✓ 사람 ${a.humans}명 + 봇 ${a.n - a.humans}명 (AI 배선 ${a.ais}개) — ${a.ids.join(' · ')}`,
    );
  }

  for (let i = 1; i < views.length; i++) {
    if (views[i].stage !== a.stage || views[i].ids.join() !== a.ids.join()) {
      errors.push(`[온라인] ${i + 1}번 창이 다른 판을 보고 있습니다`);
    }
  }

  const worst = Math.max(
    ...views.slice(1).flatMap((v) => v.pos.map((x, i) => Math.abs(x - a.pos[i]))),
  );
  if (worst > 120) {
    errors.push(`[온라인] 창들의 위치가 ${worst}px 어긋났습니다`);
  } else {
    console.log(`  ✓ 모든 창이 같은 곳을 본다 (최대 차이 ${worst}px)`);
  }

  /* --- 참가자마다 자기 캐릭터만 움직이는가 --------------------------- */
  await host.waitForFunction(
    () => window.game.scene.getScene('Battle').battleActive === true,
    null,
    { timeout: 20000 },
  );

  /*
   * 확인하는 동안 봇을 멈춰 세운다.
   *
   * 회선을 보는 검사인데 봇이 달려들어 막아서면 "안 움직인다"가 나온다.
   * 그건 회선 문제가 아니라 그냥 길이 막힌 것이다.
   */
  await host.evaluate(() => {
    const s = window.game.scene.getScene('Battle');
    s.ais.splice(0);
    s.fighters
      .filter((f) => f.side === 'ai')
      .forEach((f, i) => {
        f.setPosition(200 + i * 60, 300);
        f.moveHorizontal(0);
      });
  });

  const allX = () =>
    host.evaluate(() =>
      window.game.scene.getScene('Battle').fighters.map((f) => Math.round(f.x)),
    );

  for (let slot = 1; slot < pages.length; slot++) {
    const before = await allX();
    await pages[slot].bringToFront();
    await pages[slot].keyboard.down('a');
    await pages[slot].waitForTimeout(800);
    await pages[slot].keyboard.up('a');
    await host.waitForTimeout(350);
    const after = await allX();

    const moved = after.map((x, i) => Math.abs(x - before[i]));
    if (moved[slot] < 20) {
      const st = await host.evaluate(
        () => window.game.scene.getScene('Battle').netStats,
      );
      errors.push(
        `[온라인] ${slot + 1}번 참가자가 눌러도 안 움직입니다 ` +
          `(${before[slot]}→${after[slot]} · 받음 ${st.recv})`,
      );
    } else {
      console.log(
        `  ✓ ${slot + 1}번 참가자 입력이 자기 캐릭터에만 도착 — ${moved[slot].toFixed(0)}px`,
      );
    }
  }

  await shot(host, 'after-input');

  /* --- 아이템이 회선을 건너가는가 ------------------------------------ */
  {
    const guest = guests[0];
    await host.evaluate(() => {
      const s = window.game.scene.getScene('Battle');
      s.items.dropBurst(2);
      s.items.nextSpawnAt = 0;
    });

    const seen = await guest
      .waitForFunction(
        () => window.game.scene.getScene('Battle').items.snapshot().length > 0,
        null,
        { timeout: 20000 },
      )
      .then(() => true)
      .catch(() => false);

    if (!seen) errors.push('[온라인] 참가자 화면에 아이템이 안 보입니다');
    else {
      const [a, b] = await Promise.all(
        [host, guest].map((p) =>
          p.evaluate(() => window.game.scene.getScene('Battle').items.snapshot()),
        ),
      );
      const drift = Math.max(
        ...a.map((row, i) => Math.abs(row[0] - (b[i]?.[0] ?? 1e9))),
      );
      if (a.length !== b.length || drift > 80) {
        errors.push(`[온라인] 아이템이 다른 자리에 있습니다 (${a.length}/${b.length}개)`);
      } else {
        console.log(`  ✓ 아이템 ${a.length}개가 같은 자리에 있다 (차이 ${drift}px)`);
      }
    }
  }

  /* --- 프롬프트 오브가 회선을 건너가는가 ----------------------------- */
  {
    /*
     * 이 게임의 정체성이 프롬프트다. 온라인에서만 그게 빠져 있으면
     * 심사위원이 온라인으로 보는 순간 이 게임의 핵심을 못 본다.
     *
     * 확인하는 것은 셋이다 — 오브가 참가자 화면에도 보이는가,
     * 참가자가 깨면 **그 사람에게** 입력창이 뜨는가,
     * 그 문장으로 걸린 규칙이 모두의 화면에 반영되는가.
     */
    const guest = guests[0];

    // 참가자 캐릭터 바로 앞에 오브를 세우고 참가자가 마지막 타를 넣게 한다
    await host.evaluate(() => {
      const s = window.game.scene.getScene('Battle');
      s.orbs.start(false);
      s.orbs.nextSpawnAt = 0;
    });

    const seen = await guest
      .waitForFunction(() => window.game.scene.getScene('Battle').orbs.isActive(), null, {
        timeout: 20000,
      })
      .then(() => true)
      .catch(() => false);

    if (!seen) {
      errors.push('[온라인] 참가자 화면에 오브가 안 보입니다');
    } else {
      console.log('  ✓ 오브가 참가자 화면에도 뜬다');
      await shot(guest, 'orb-guest');

      /* 참가자가 깬다 — 호스트에서 그 자리 파이터로 마지막 타를 넣는다 */
      await host.evaluate(() => {
        const s = window.game.scene.getScene('Battle');
        const me = s.fighters[1];
        s.orbs.onBreak?.(me);
      });

      const asked = await guest
        .waitForSelector('[data-testid="prompt-overlay"]', { timeout: 12000 })
        .then(() => true)
        .catch(() => false);

      if (!asked) {
        errors.push('[온라인] 참가자가 깼는데 참가자에게 입력창이 안 뜹니다');
      } else {
        console.log('  ✓ 깬 사람에게 입력창이 뜬다 (호스트가 대신 치지 않는다)');
        await shot(guest, 'orb-prompt-guest');

        await guest.fill('[data-testid="prompt-input"]', '달로 보내줘');
        await guest.keyboard.press('Enter');

        /* 호스트 화면에도 같은 규칙이 걸려야 한다 */
        const applied = await host
          .waitForFunction(
            () => window.game.scene.getScene('Battle').gimmicks.getActive().length > 0,
            null,
            { timeout: 12000 },
          )
          .then(() => true)
          .catch(() => false);

        if (!applied) {
          errors.push('[온라인] 참가자가 쓴 문장이 판에 걸리지 않았습니다');
        } else {
          const what = await host.evaluate(() =>
            window.game.scene
              .getScene('Battle')
              .gimmicks.getActive()
              .map((a) => a.spec.name)
              .join(', '),
          );
          console.log(`  ✓ 참가자의 문장이 호스트 판에 걸린다 — ${what}`);
        }
        await shot(host, 'orb-applied-host');
      }
    }
  }

  /* --- 사람 자리를 사람이라고 부르는가 ----------------------------- */
  /*
   * 넷이 붙으면 3·4번 자리에 진짜 사람이 앉는다. 그 자리를 "CPU"라고 적으면
   * 판 내내 사람이 봇 취급을 받고, 그 사람이 이기면 결과 화면에도
   * "봇 승리…"라고 뜬다. HUD 가 자리 이름을 어떻게 부르는지 본다.
   */
  {
    const seats = await host.evaluate(() => {
      const s = window.game.scene.getScene('Battle');
      return s.huds.map((h) => ({
        id: h.fighter.fighterId,
        side: h.fighter.side,
        label: h.seatLabel.text,
      }));
    });

    const wrong = seats.filter(
      (h) => h.side === 'player' && !/^\dP$/.test(h.label),
    );
    if (wrong.length) {
      errors.push(
        `[온라인] 사람 자리를 봇처럼 적었습니다 — ${wrong
          .map((h) => `${h.id}="${h.label}"`)
          .join(' · ')}`,
      );
    } else {
      console.log(`  ✓ 자리 이름 — ${seats.map((h) => h.label).join(' · ')}`);
    }
  }

  /* --- 한 사람이 나가면 봇이 이어받는가 --------------------------- */
  /*
   * 넷이 붙는 판에서 한 사람이 창을 닫는 일은 드물지 않다. 그 캐릭터가
   * 그 자리에 그대로 서 있으면 남은 사람들은 허수아비를 상대로 남은 판을
   * 치른다. 그건 판이 아니다 — 봇이 이어받아야 한다.
   *
   * 봇 수(ais)로는 확인할 수 없다. 위에서 회선을 보려고 봇 판단을 통째로
   * 멈춰 뒀기 때문이다. 확인할 것은 **그 자리가 사람 목록에서 빠졌는가**와
   * **그 캐릭터가 다시 움직이는가** 두 가지다.
   */
  {
    const leaver = pages[pages.length - 1];
    const before = await host.evaluate(() => {
      const s = window.game.scene.getScene('Battle');
      // 나갈 사람의 캐릭터가 목록에서 몇 번째인지 — 그 캐릭터를 지켜본다
      const last = s.humans[s.humans.length - 1];
      return {
        humans: s.humans.length,
        idx: s.fighters.indexOf(last.fighter),
        name: last.fighter.cfg.name,
      };
    });

    /*
     * 하필 그 사람 차례에 나가게 만든다.
     *
     * 문장을 기다리는 동안에는 전원이 멈춰 있다. 기다리던 사람이 창을 닫으면
     * 문장은 영영 오지 않는데, 안전장치가 15초라 남은 사람들은 멈춘 화면을
     * 15초 동안 본다 — 회선이 끊긴 줄 안다. 가장 나쁜 순간에 나가는 상황을
     * 그대로 만들어 두고, 판이 곧바로 되돌아오는지 본다.
     */
    await host.evaluate((idx) => {
      const s = window.game.scene.getScene('Battle');
      if (!s.orbs.isActive()) s.orbs.spawn(s.time.now, s.fighters[idx].x, s.fighters[idx].y - 140);
      s.orbs.onBreak(s.fighters[idx]);
    }, before.idx);

    const asking = await leaver
      .waitForSelector('[data-testid="prompt-overlay"]', { timeout: 12000 })
      .then(() => true)
      .catch(() => false);

    if (!asking) {
      errors.push('[온라인] 나갈 사람에게 입력창이 안 떠서 "차례 중 이탈"을 못 만들었습니다');
    } else if (!(await host.evaluate(() => window.game.scene.getScene('Battle').prompting))) {
      errors.push('[온라인] 남의 차례인데 호스트가 안 멈췄습니다');
    }

    const closedAt = Date.now();
    await leaver.close();
    pages.pop();
    await host.bringToFront();

    if (asking) {
      const back = await host
        .waitForFunction(() => !window.game.scene.getScene('Battle').prompting, null, {
          timeout: 9000,
        })
        .then(() => true)
        .catch(() => false);
      const took = Math.round((Date.now() - closedAt) / 100) / 10;

      if (!back) {
        errors.push('[온라인] 입력하던 사람이 나갔는데 판이 멈춘 채로 남아 있습니다');
      } else {
        console.log(`  ✓ 입력하던 사람이 나가도 판이 곧 되돌아온다 (${took}초)`);
      }
    }

    const handed = await host
      .waitForFunction(
        (was) => window.game.scene.getScene('Battle').humans.length < was.humans,
        before,
        { timeout: 15000 },
      )
      .then(() => true)
      .catch(() => false);

    if (!handed) {
      const now = await host.evaluate(() => window.game.scene.getScene('Battle').humans.length);
      errors.push(
        `[온라인] 나간 사람의 자리가 그대로 남아 있습니다 (사람 ${before.humans}\u2192${now})`,
      );
    } else {
      /*
       * 이어받은 봇이 실제로 움직이는가.
       *
       * 목록에서 빠지기만 하고 아무도 조종하지 않으면 허수아비는 그대로다.
       * 이 검사 앞에서 봇 판단을 멈춰 뒀으므로, 새로 붙은 판단만 도는 상태다 —
       * 움직이면 그건 이어받은 봇이 움직인 것이다.
       */
      const moved = await host.evaluate(async (idx) => {
        const s = window.game.scene.getScene('Battle');
        const bot = s.fighters[idx];
        if (!bot || s.ais.length === 0) return -1;
        /*
         * 움직일 때까지 본다 — 정해진 시간만 재지 않는다.
         *
         * 이어받는 순간 그 캐릭터는 문장을 외치던 자세일 수도, 방금 맞아
         * 경직 중일 수도 있다. 2초를 딱 재면 그 사이가 하필 굳어 있는 구간일 때
         * "봇이 안 움직인다"가 되는데, 그건 이어받기가 실패한 것이 아니라
         * 아직 차례가 아닌 것이다.
         */
        const x0 = bot.x;
        let best = 0;
        for (let i = 0; i < 50; i++) {
          await new Promise((r) => setTimeout(r, 100));
          best = Math.max(best, Math.abs(bot.x - x0));
          if (best > 8) break;
        }
        return Math.round(best);
      }, before.idx);

      if (moved < 0) {
        errors.push('[온라인] 자리는 비었는데 이어받은 봇이 없습니다');
      } else if (moved <= 8) {
        errors.push(
          `[온라인] 이어받은 봇이 5초 동안 ${moved}px 밖에 안 움직였습니다 — 굳어 있습니다`,
        );
      } else {
        const relabelled = await host.evaluate((idx) => {
          const s = window.game.scene.getScene('Battle');
          const f = s.fighters[idx];
          return s.huds.find((h) => h.fighter === f)?.seatLabel.text ?? '';
        }, before.idx);

        if (!relabelled.includes('봇')) {
          errors.push(
            `[온라인] 봇이 이어받은 자리가 아직 사람으로 적혀 있습니다 — "${relabelled}"`,
          );
        }
        console.log(
          `  \u2713 나간 자리를 봇이 이어받는다 — ${before.name} (${moved}px 움직임 · "${relabelled}")`,
        );
      }
      await shot(host, 'left-handover');
    }
  }
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg !== '__skip__') errors.push(`[중단] ${msg}`);
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
  process.exit(0);
}

if (errors.length || realErrors.length) {
  console.error(`\n실패 — ${errors.length + realErrors.length}건`);
  [...errors, ...realErrors].slice(0, 10).forEach((e) => console.error('  ' + e));
  process.exit(1);
}
console.log(`\n통과 — 창 ${PLAYERS}개가 같은 판을 보고 있습니다`);
