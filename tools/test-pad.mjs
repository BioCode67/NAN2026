#!/usr/bin/env node
/**
 * 게임패드 검사 — 패드 하나로 타이틀부터 전투까지 갈 수 있는가.
 *
 * ── 왜 따로 만드는가 ───────────────────────────────────────────────
 * 패드는 이 개발 환경에 꽂혀 있지 않다. 그래서 "패드를 받는다"는 코드는
 * 아무도 한 번도 눌러 보지 않은 채로 들어간다 — 눌러 보지 않은 입력 경로는
 * 없는 것과 같다. 소파에 넷이 앉는 것이 이 게임의 목표인데, 그 경로가
 * 조용히 죽어 있는 채로 제출되는 사고를 막을 방법은 이 검사뿐이다.
 *
 * 브라우저에 **가짜 패드를 심는다.** Phaser 의 패드 플러그인은 매 프레임
 * navigator.getGamepads() 를 다시 읽으므로(refreshPads), 그 함수만 갈아
 * 끼우면 게임 코드는 진짜 패드와 구별하지 못한다. 표준 배치(standard
 * mapping)의 버튼 17개 · 축 4개를 그대로 흉내 낸다.
 *
 * 사용법:
 *   npm run dev                   (다른 터미널에서 먼저 실행)
 *   npm run test:pad
 *   HEADED=1 npm run test:pad     (창을 띄워 눈으로 확인)
 *   PW_CHROMIUM=/path/to/chrome npm run test:pad
 */

const URL = process.env.SMOKE_URL ?? 'http://localhost:3000';
const HEADLESS = process.env.HEADED !== '1';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('playwright가 없습니다:\n  npm i -D playwright');
  process.exit(1);
}

try {
  const res = await fetch(URL, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(String(res.status));
} catch {
  console.error(`${URL} 에 접속할 수 없습니다. 먼저 "npm run dev" 를 실행하세요.`);
  process.exit(1);
}

const errors = [];
const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => errors.push(msg);

const browser = await chromium.launch({
  headless: HEADLESS,
  ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
});
const page = await (
  await browser.newContext({ viewport: { width: 1400, height: 900 } })
).newPage();

page.on('pageerror', (e) => bad(`[pageerror] ${e.message}`));

/* ------------------------------------------------------------------ */
/* 가짜 패드                                                            */
/* ------------------------------------------------------------------ */

/**
 * 표준 배치 버튼 번호 — 게임 코드가 쓰는 것만 이름을 붙인다.
 * https://w3c.github.io/gamepad/#remapping
 */
const BTN = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  L1: 4,
  R1: 5,
  L2: 6,
  R2: 7,
  SELECT: 8,
  START: 9,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15,
};

/*
 * navigator.getGamepads 를 갈아 끼운다.
 *
 * 페이지가 뜨기 전에 심어야 한다 — Phaser 가 부팅하며 한 번 읽고 시작하기
 * 때문이다. 상태는 window.__pads 에 두고 테스트가 바깥에서 흔든다.
 */
await page.addInitScript(() => {
  const make = (index) => ({
    index,
    id: `Fake Pad ${index} (STANDARD GAMEPAD Vendor: 0000 Product: 0000)`,
    connected: true,
    mapping: 'standard',
    timestamp: 0,
    // 표준 배치는 버튼 17개 · 축 4개다. 개수가 모자라면 Phaser 가
    // 없는 버튼을 더미로 채워, 눌러도 아무 일이 없는 채로 조용히 지나간다.
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    axes: [0, 0, 0, 0],
  });

  window.__pads = [make(0), make(1)];
  navigator.getGamepads = () => window.__pads;

  /** 버튼을 누르거나 뗀다 — 눌린 깊이(value)와 pressed 를 함께 맞춘다 */
  window.__padSet = (padIdx, btn, down) => {
    const b = window.__pads[padIdx].buttons[btn];
    b.pressed = !!down;
    b.value = down ? 1 : 0;
    window.__pads[padIdx].timestamp = performance.now();
  };
  /** 왼쪽 스틱을 기울인다 */
  window.__padStick = (padIdx, x, y) => {
    window.__pads[padIdx].axes[0] = x;
    window.__pads[padIdx].axes[1] = y;
    window.__pads[padIdx].timestamp = performance.now();
  };
  /** 모든 버튼을 뗀다 — 검사 사이에 눌림이 새지 않게 */
  window.__padRelease = (padIdx) => {
    for (const b of window.__pads[padIdx].buttons) {
      b.pressed = false;
      b.value = 0;
    }
    window.__padStick(padIdx, 0, 0);
  };
});

const padSet = (btn, down, pad = 0) =>
  page.evaluate(([p, b, d]) => window.__padSet(p, b, d), [pad, btn, down]);
const padStick = (x, y, pad = 0) =>
  page.evaluate(([p, sx, sy]) => window.__padStick(p, sx, sy), [pad, x, y]);
const padRelease = (pad = 0) => page.evaluate((p) => window.__padRelease(p), pad);

/**
 * 버튼을 눌렀다 뗀다.
 *
 * 게임은 매 프레임 앞 프레임과 비교해 "방금 눌림"을 가려낸다. 누른 채로
 * 프레임이 한 번은 돌아야 눌림이 잡히므로, 누르고 나서 기다렸다가 뗀다.
 * 헤드리스는 4~6 FPS 라 넉넉히 준다.
 */
const tap = async (btn, ms = 320, pad = 0) => {
  await padSet(btn, true, pad);
  await page.waitForTimeout(ms);
  await padSet(btn, false, pad);
  await page.waitForTimeout(ms);
};

/* ------------------------------------------------------------------ */

const sceneAlive = (key) =>
  page.evaluate((k) => !!window.game?.scene?.isActive(k), key).catch(() => false);

const waitScene = async (key, tries = 40) => {
  for (let i = 0; i < tries; i++) {
    if (await sceneAlive(key)) return true;
    await page.waitForTimeout(250);
  }
  return false;
};

console.log(`게임패드 검사 → ${URL}`);

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas', { timeout: 30000 });

  /* 패드가 실제로 잡혔는가 — 이것이 안 되면 아래는 전부 무의미하다 */
  await waitScene('Title');
  await page.waitForTimeout(500);
  /*
   * 패드 플러그인은 게임이 아니라 **씬**에 붙는다 (scene.input.gamepad).
   * game.input 에서 찾으면 언제나 없다 — 게임이 아니라 검사가 틀린 것이다.
   */
  const padCount = await page.evaluate(() => {
    const scene = window.game?.scene?.scenes?.find((s) => s.scene.isActive());
    return scene?.input?.gamepad?.getAll?.().length ?? -1;
  });
  if (padCount < 2) {
    bad(`[연결] 패드가 잡히지 않았습니다 (${padCount}개)`);
  } else {
    ok(`패드 ${padCount}개 인식`);
  }

  /* 1. 타이틀 — 아무 버튼으로나 넘어간다 */
  for (let i = 0; i < 8 && (await sceneAlive('Title')); i++) {
    await tap(BTN.A);
  }
  if (!(await waitScene('Select'))) {
    bad('[타이틀] 패드 A 로 선택 화면까지 넘어가지 못했습니다');
  } else {
    ok('타이틀 → 선택 (A)');
  }

  /*
   * 2. 선택 화면 — 십자키로 커서가 움직이는가.
   *
   * 커서 번호를 직접 읽는다. 스크린샷으로는 "빛나는 카드가 하나 있다"까지만
   * 알 수 있고 그게 옮겨간 것인지는 알 수 없다.
   */
  await page.waitForTimeout(700);
  const cursor = () =>
    page.evaluate(() => window.game?.scene?.getScene('Select')?.selectedIndex ?? -1);

  const before = await cursor();
  await tap(BTN.RIGHT);
  const afterDpad = await cursor();
  if (afterDpad === before) {
    bad(`[선택] 십자키 오른쪽으로 커서가 안 움직입니다 (${before} 그대로)`);
  } else {
    ok(`십자키 이동 ${before} → ${afterDpad}`);
  }

  /* 스틱으로도 움직여야 한다 — 십자키만 되는 패드는 반쪽이다 */
  await padStick(0.9, 0);
  await page.waitForTimeout(320);
  await padStick(0, 0);
  await page.waitForTimeout(320);
  const afterStick = await cursor();
  if (afterStick === afterDpad) {
    bad(`[선택] 스틱으로 커서가 안 움직입니다 (${afterDpad} 그대로)`);
  } else {
    ok(`스틱 이동 ${afterDpad} → ${afterStick}`);
  }

  /* Y — 상세 보기가 열리고 B 로 닫힌다 */
  const detailOpen = () =>
    page.evaluate(() => !!window.game?.scene?.getScene('Select')?.detail);
  await tap(BTN.Y);
  if (!(await detailOpen())) {
    bad('[선택] Y 로 상세 보기가 열리지 않습니다');
  } else {
    await tap(BTN.B);
    if (await detailOpen()) bad('[선택] B 로 상세 보기가 안 닫힙니다');
    else ok('Y 상세 열기 · B 닫기');
  }

  /*
   * 3. 확정 → 전투 진입. **스타트로** 확정한다.
   *
   * 여기서 A 가 아니라 스타트를 쓰는 이유가 있다. 화면을 넘긴 그 버튼은
   * 다음 화면이 처음 읽을 때도 아직 눌려 있는데, 스타트는 전투에서
   * 일시정지다 — 확정한 손가락이 떨어지기 전에 전투가 그것을 "방금 눌림"
   * 으로 읽으면 판이 시작하자마자 멈춘 채로 뜬다.
   *
   * 지금 이 검사는 고쳐 놓은 코드를 도로 빼도 통과한다. togglePause 가
   * 인트로 중에는 안 멈추기 때문인데, 그건 이것과 상관없는 이유로 있는
   * 자물쇠다. 그 자물쇠가 사라지는 날 이 검사가 먼저 울리라고 박아 둔다.
   */
  await padSet(BTN.START, true);
  await page.waitForTimeout(400);
  const enteredBattle = await waitScene('Battle', 20);
  // 손가락을 늦게 뗀다 — 전투가 첫 프레임을 읽는 동안 눌려 있어야 한다
  await page.waitForTimeout(300);
  await padSet(BTN.START, false);
  await page.waitForTimeout(300);

  if (!enteredBattle) {
    bad('[선택] 스타트로 전투에 들어가지 못했습니다');
    throw new Error('전투 진입 실패 — 이후 검사를 건너뜁니다');
  }
  ok('선택 → 전투 (스타트)');

  {
    const paused = await page.evaluate(
      () => window.game?.scene?.getScene('Battle')?.paused ?? null,
    );
    if (paused) bad('[전투] 확정한 스타트가 새어 들어와 일시정지된 채로 시작했습니다');
    else ok('넘어올 때 누른 버튼이 안 샌다');
  }

  /*
   * 전투가 실제로 시작될 때까지 기다린다.
   * 인트로 연출 동안에는 조작이 막혀 있어, 그때 누르면 "패드가 안 먹는다"로
   * 잘못 읽힌다.
   */
  const battleReady = async () => {
    for (let i = 0; i < 60; i++) {
      const live = await page.evaluate(
        () => window.game?.scene?.getScene('Battle')?.battleActive ?? false,
      );
      if (live) return true;
      await page.waitForTimeout(250);
    }
    return false;
  };
  if (!(await battleReady())) bad('[전투] 전투가 시작되지 않았습니다');

  /*
   * 봇을 세운다.
   *
   * 이 검사가 재는 것은 "패드의 이 버튼이 이 동작으로 이어지는가" 하나뿐인데,
   * 봇 셋이 실제로 달려드는 판에서 재면 그게 안 재진다 — 이동 거리는 맞아서
   * 밀린 만큼 섞이고, 강공격을 누르는 순간 떠 있으면 지상기가 아니라 공중기가
   * 나가고, 몇 초 더 지나면 아예 상장폐지돼 아무것도 못 누른다.
   * 실제로 그 셋이 전부 "패드가 안 먹는다"로 보였다.
   *
   * 봇의 판단만 끊는다. 입력 경로는 손대지 않으므로 재려는 것은 그대로 남는다.
   */
  await page.evaluate(() => {
    const scene = window.game?.scene?.getScene('Battle');
    if (!scene) return;
    scene.ais.length = 0;
    for (const f of scene.fighters) {
      if (f !== scene.player) f.body?.setVelocity(0, 0);
    }
    // 넉넉히 채워 둔다 — 검사 도중 주가가 0이 되면 그 뒤가 전부 무의미하다
    scene.stock.add(scene.player.fighterId, 200);
    /*
     * 무대 한가운데로 옮긴다.
     *
     * 봇을 세우고 나니 이동이 방해 없이 일정해져서, 시작 자리(왼쪽 끝
     * 근처)에서 왼쪽으로 0.9초를 걸으면 매번 발판 밖으로 나가 장외로 죽는다.
     * 주가를 아무리 채워도 소용없다 — 장외는 주가와 무관한 즉사다.
     * 재려는 것은 "패드로 걷는가"이지 "낭떠러지를 피하는가"가 아니다.
     */
    scene.player.x = 960;
    scene.player.y = 400;
    scene.player.body?.setVelocity(0, 0);
  });
  await page.waitForTimeout(700);

  const playerX = () =>
    page.evaluate(() => window.game?.scene?.getScene('Battle')?.player?.x ?? null);
  const playerY = () =>
    page.evaluate(() => window.game?.scene?.getScene('Battle')?.player?.y ?? null);

  /* 4. 이동 — 스틱을 기울이면 간다 */
  {
    const x0 = await playerX();
    await padStick(1, 0);
    await page.waitForTimeout(900);
    await padStick(0, 0);
    const x1 = await playerX();
    const moved = (x1 ?? 0) - (x0 ?? 0);
    if (moved < 20) bad(`[전투] 스틱으로 안 움직입니다 (${moved.toFixed(1)}px)`);
    else ok(`스틱 이동 ${moved.toFixed(0)}px`);
  }

  /* 십자키로도 가야 한다 */
  {
    const x0 = await playerX();
    await padSet(BTN.LEFT, true);
    await page.waitForTimeout(900);
    await padSet(BTN.LEFT, false);
    const x1 = await playerX();
    const moved = (x0 ?? 0) - (x1 ?? 0);
    if (moved < 20) bad(`[전투] 십자키로 안 움직입니다 (${moved.toFixed(1)}px)`);
    else ok(`십자키 이동 ${moved.toFixed(0)}px`);
  }

  /* 5. 점프 (A) — 발이 떨어지는가 */
  {
    const y0 = await playerY();
    await padSet(BTN.A, true);
    await page.waitForTimeout(260);
    await padSet(BTN.A, false);
    // 정점 근처를 잡으려 짧게 본다
    let peak = y0;
    for (let i = 0; i < 6; i++) {
      const y = await playerY();
      if (y !== null && y < peak) peak = y;
      await page.waitForTimeout(90);
    }
    const rise = (y0 ?? 0) - (peak ?? 0);
    if (rise < 20) bad(`[전투] A 로 점프하지 않습니다 (${rise.toFixed(1)}px)`);
    else ok(`점프 ${rise.toFixed(0)}px`);
    // 착지를 기다린다 — 공중에서 다음 검사를 시작하면 지상기가 안 나온다
    await page.waitForTimeout(1200);
  }

  /*
   * 6. 공격 — 눌린 버튼마다 실제로 다른 기술이 나가는가.
   *
   * 기술 이름을 기록해 대조한다. 화면만 봐서는 "X 를 눌렀는데 정말 약공격이
   * 나갔는지"를 단정할 수 없다.
   */
  await page.evaluate(() => {
    const p = window.game?.scene?.getScene('Battle')?.player;
    if (!p || p.__padRecorded) return;
    window.__moves = [];
    const orig = p.beginAttack.bind(p);
    p.beginAttack = (atk) => {
      window.__moves.push(atk.name);
      return orig(atk);
    };
    p.__padRecorded = true;
  });
  const takeMoves = async () => {
    const m = await page.evaluate(() => window.__moves ?? []);
    await page.evaluate(() => void (window.__moves = []));
    return m;
  };

  const expected = await page.evaluate(() => {
    const m = window.game?.scene?.getScene('Battle')?.player?.cfg?.moves;
    return m ? { light: m.light?.name, heavy: m.heavy?.name, skill: m.skill?.name } : null;
  });

  /*
   * 누르기 전에 **칠 수 있는 상태가 될 때까지** 기다린다.
   *
   * 이건 봇 셋이 실제로 달려드는 살아 있는 판이다. 가만히 선 채로 몇 초가
   * 지나면 맞아서 경직 중이거나 이미 상장폐지된 상태가 되는데, 그때 누르고
   * "기술이 안 나갔다"고 적으면 패드를 의심하게 된다 — 원인은 패드가 아니라
   * 검사가 못 칠 때 친 것이다. 상태를 먼저 확인하고, 못 치는 상태면
   * 그 이유를 그대로 적는다.
   */
  const actState = () =>
    page.evaluate(() => {
      const p = window.game?.scene?.getScene('Battle')?.player;
      if (!p) return null;
      return {
        canAct: p.canAct(),
        alive: p.alive,
        stunned: p.scene.time.now < p.stunUntil,
        attacking: p.attackPhase !== 'none',
        guarding: p.guarding,
        // 지상기를 기대하는데 떠 있으면 공중기가 나간다 — 같이 본다
        onGround: p.body.blocked.down || p.body.touching.down,
      };
    });
  const waitActionable = async (tries = 24) => {
    for (let i = 0; i < tries; i++) {
      const s = await actState();
      if (s?.canAct && s.onGround) return s;
      await page.waitForTimeout(250);
    }
    return await actState();
  };

  await takeMoves();
  for (const [label, btn, want] of [
    ['X 약공격', BTN.X, expected?.light],
    ['B 강공격', BTN.B, expected?.heavy],
    ['Y 스킬', BTN.Y, expected?.skill],
  ]) {
    const state = await waitActionable();
    if (!state?.canAct || !state.onGround) {
      bad(`[전투] ${label} — 칠 수 있는 상태가 안 됐습니다 ${JSON.stringify(state)}`);
      continue;
    }

    await tap(btn, 260);
    await page.waitForTimeout(500);
    const fired = await takeMoves();
    if (!fired.length) {
      bad(`[전투] ${label} — 아무 기술도 안 나갔습니다 (직전 상태 ${JSON.stringify(state)})`);
    } else if (want && !fired.includes(want)) {
      bad(`[전투] ${label} — "${want}" 가 아니라 ${JSON.stringify(fired)} 가 나갔습니다`);
    } else {
      ok(`${label} → ${fired[0]}`);
    }
    // 후딜과 연속기 유예가 지나가야 다음 버튼이 1타로 잡힌다
    await page.waitForTimeout(900);
  }

  /* 7. 스타트 — 일시정지가 걸리고 풀린다 */
  {
    const paused = () =>
      page.evaluate(() => window.game?.scene?.getScene('Battle')?.paused ?? null);
    await tap(BTN.START, 300);
    if ((await paused()) !== true) {
      bad('[전투] 스타트로 일시정지가 안 걸립니다');
    } else {
      await tap(BTN.START, 300);
      if ((await paused()) !== false) bad('[전투] 스타트로 일시정지가 안 풀립니다');
      else ok('스타트 일시정지 · 해제');
    }
  }

  /*
   * 8. 한 바퀴 더 — 두 번째 판에서도 안 새는가.
   *
   * ── 왜 왕복까지 도는가 ─────────────────────────────────────────
   * 첫 판만 보면 입력이 새는 자리를 아예 안 지난다. 씬 객체가 그때 막
   * 만들어져 "앞 프레임 기억"이 비어 있고, 비어 있으면 어차피 아무것도
   * 안 나오기 때문이다. 새는 자리는 **두 번째 판**이다 — 씬 객체는 판마다
   * 새로 만들어지지 않아 앞 판의 기억이 그대로 남아 있고, 거기에 새 판의
   * 첫 프레임이 얹힌다. 첫 판만 재는 검사는 통과해도 아무것도 안 지킨다.
   */
  await page.evaluate(() => window.game?.scene?.getScene('Battle')?.scene.start('Select'));
  if (!(await waitScene('Select'))) {
    bad('[왕복] 선택 화면으로 못 돌아왔습니다');
  } else {
    // 확정 잠금(480ms)이 풀린 뒤에 눌러야 한다
    await page.waitForTimeout(900);
    await padSet(BTN.START, true);
    await page.waitForTimeout(400);
    const back = await waitScene('Battle', 20);
    await page.waitForTimeout(300);
    await padSet(BTN.START, false);
    await page.waitForTimeout(300);

    if (!back) {
      bad('[왕복] 두 번째 판에 들어가지 못했습니다');
    } else {
      const paused = await page.evaluate(
        () => window.game?.scene?.getScene('Battle')?.paused ?? null,
      );
      if (paused) bad('[왕복] 두 번째 판이 일시정지된 채로 시작했습니다');
      else ok('두 번째 판에서도 안 샌다');
    }
  }

  await padRelease();
} catch (e) {
  bad(`[중단] ${e.message}`);
}

await browser.close();

console.log('');
if (errors.length) {
  console.log(`실패 — ${errors.length}건`);
  for (const e of errors) console.log(`  ${e}`);
  process.exit(1);
}
console.log('통과 — 패드 하나로 타이틀부터 전투까지 다녀왔다');
