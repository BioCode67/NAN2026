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

  /*
   * 9. 로컬 4인 대전 — 이 기계 앞에 넷이 앉는다.
   *
   * ── 왜 검사에 넣는가 ───────────────────────────────────────────
   * 한 판에 넷이 서는 게임인데 이 기계에서 사람은 오래 둘까지였다. 그 벽을
   * 없애는 것이 패드를 받은 이유이고, 그렇다면 **넷이 실제로 서는지**가
   * 이 기능의 전부다. 3·4번 자리는 패드로만 움직이므로 패드 없이는 아예
   * 확인할 수 없고 — 그래서 여기 있다.
   *
   * 셋 이상이 되면 1·2번은 키보드 전용이 되고 첫 패드가 3번 것이 된다.
   * 그 규칙이 어긋나면 패드 하나로 두 캐릭터가 함께 움직인다. 그것도 본다.
   */
  await page.evaluate(() => window.game?.scene?.getScene('Battle')?.scene.start('Select'));
  if (!(await waitScene('Select'))) {
    bad('[4인] 선택 화면으로 못 돌아왔습니다');
  } else {
    await page.waitForTimeout(900);

    // F2 를 세 번 — 1 → 2 → 3 → 4
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('F2');
      await page.waitForTimeout(250);
    }
    const seats = await page.evaluate(
      () => window.game?.scene?.getScene('Select')?.localSeats ?? 0,
    );
    if (seats !== 4) {
      bad(`[4인] F2 세 번에 4인이 안 됩니다 (${seats})`);
    } else {
      ok('F2 ×3 → 4인 대전');

      /*
       * 같은 캐릭터를 두 번 고르려 해 본다 — 막혀야 한다.
       *
       * 같은 캐릭터 둘이 판에 서면 이름표도 색도 모션도 같아, 넷이 뒤엉킨
       * 판에서 자기 캐릭터를 놓친다. 막혔는지는 **인원 수가 안 늘어난
       * 것**으로 확인한다 — 화면에는 흔들리는 카드 한 장이 전부라
       * 스크린샷으로는 "안 눌린 건지 막힌 건지"를 가릴 수 없다.
       */
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
      const afterFirst = await page.evaluate(
        () => window.game.scene.getScene('Select').localPicks.length,
      );
      await page.keyboard.press('Enter');
      await page.waitForTimeout(700);
      const afterDup = await page.evaluate(
        () => window.game.scene.getScene('Select').localPicks.length,
      );
      if (afterFirst !== 1) {
        bad(`[중복] 1P 선택이 안 됐습니다 (${afterFirst})`);
      } else if (afterDup !== 1) {
        bad(`[중복] 같은 캐릭터를 2P 도 골랐습니다 (${afterDup}명 확정)`);
      } else {
        ok('같은 캐릭터는 두 번 못 고른다');
      }

      // 나머지 셋은 서로 다른 캐릭터로 고른다
      for (let i = 1; i < 4; i++) {
        for (let k = 0; k < 3; k++) {
          await page.keyboard.press('ArrowRight');
          await page.waitForTimeout(140);
        }
        await page.keyboard.press('Enter');
        await page.waitForTimeout(500);
      }

      if (!(await waitScene('Battle', 40))) {
        bad('[4인] 넷을 고르고도 전투에 못 들어갔습니다');
      } else {
        await page.waitForTimeout(1200);
        const crew = await page.evaluate(() => {
          const s = window.game.scene.getScene('Battle');
          const humans = s.fighters.filter((f) => f.side === 'player');
          return {
            total: s.fighters.length,
            humans: humans.length,
            names: humans.map((f) => f.cfg.name),
            unique: new Set(humans.map((f) => f.cfg.id)).size,
            // 자리별 입력 장치 — 3·4번만 패드여야 한다
            pads: s.humans.map((h) => h.padIndex ?? null),
          };
        });

        if (crew.humans !== 4) {
          bad(`[4인] 사람이 넷이어야 하는데 ${crew.humans}명입니다`);
        } else if (crew.total !== 4) {
          bad(`[4인] 판에 넷이 서야 하는데 ${crew.total}명입니다 (봇이 안 빠졌다)`);
        } else if (crew.unique !== 4) {
          bad(`[4인] 같은 캐릭터가 겹쳤습니다 — ${crew.names.join(', ')}`);
        } else if (JSON.stringify(crew.pads) !== JSON.stringify([null, null, 0, 1])) {
          bad(`[4인] 자리별 패드 배정이 틀렸습니다 — ${JSON.stringify(crew.pads)}`);
        } else {
          ok(`넷이 판에 섰다 — ${crew.names.join(' · ')} (3P=패드0 · 4P=패드1)`);
        }

        /*
         * 첫 패드가 **3번만** 움직이는가.
         *
         * 배정이 어긋나면 패드 하나가 두 캐릭터를 함께 끌고 다니는데,
         * 화면으로는 "왜 쟤가 같이 움직이지" 정도로만 보여서 놓치기 쉽다.
         */
        if (crew.humans === 4) {
          const xs = () =>
            page.evaluate(() =>
              window.game.scene
                .getScene('Battle')
                .fighters.filter((f) => f.side === 'player')
                .map((f) => f.x),
            );
          // 봇이 없어도 서로 밀칠 수 있으니 멈춰 세우고 잰다
          await page.evaluate(() => {
            const s = window.game.scene.getScene('Battle');
            s.ais.length = 0;
            for (const f of s.fighters) f.body?.setVelocity(0, 0);
          });
          await page.waitForTimeout(300);

          const before = await xs();
          await padSet(BTN.RIGHT, true, 0);
          await page.waitForTimeout(800);
          await padSet(BTN.RIGHT, false, 0);
          const after = await xs();

          const moved = after.map((x, i) => Math.abs(x - before[i]));
          const others = [moved[0], moved[1], moved[3]];
          if (moved[2] < 20) {
            bad(`[4인] 첫 패드로 3P가 안 움직입니다 (${moved[2].toFixed(0)}px)`);
          } else if (others.some((m) => m > 12)) {
            bad(
              `[4인] 첫 패드가 3P 말고 다른 자리도 움직입니다 — ${moved
                .map((m) => m.toFixed(0))
                .join('/')}px`,
            );
          } else {
            ok(`첫 패드는 3P만 움직인다 (${moved[2].toFixed(0)}px)`);
          }
        }
      }
    }
  }

  /*
   * 10. 카메라 줌 — 뭉치면 파고들고, HUD 는 제자리에 남는가.
   *
   * ── 왜 HUD 까지 재는가 ─────────────────────────────────────────
   * 줌을 안 넣고 버틴 이유가 그것이었다. HUD 는 scrollFactor 0 이라 스크롤은
   * 안 따라가지만 **줌은 그대로 먹는다** — 카메라를 당기면 주가 막대와 조작
   * 안내가 같이 커져 화면 밖으로 밀려난다. 카메라를 하나 더 두는 대신
   * hudLayer 를 1/줌 으로 되돌려 두었는데, 그 상쇄가 실제로 맞는지는
   * 숫자로만 확인할 수 있다. 화면을 보면 "좀 커진 것 같기도" 하고 만다.
   */
  {
    const camState = () =>
      page.evaluate(() => {
        const s = window.game.scene.getScene('Battle');
        const cam = s.cameras.main;
        const hud = s.hudLayer;
        // HUD 자식 하나가 실제로 그려지는 화면 좌표 (상쇄가 맞으면 줌과 무관)
        const kid = hud.list.find((o) => typeof o.x === 'number');
        if (!kid) return { zoom: cam.zoom, hudScale: hud.scaleX, kidScreenX: null };

        /*
         * **화면** 좌표를 구해야 한다.
         *
         * 처음에는 월드 좌표(hud.x + kid.x·scale)를 비교했는데, 그건 상쇄가
         * 제대로 걸릴수록 오히려 달라지는 값이다 — 되돌리기의 원리 자체가
         * 월드 좌표를 옮겨서 화면 좌표를 붙잡아 두는 것이기 때문이다.
         * scrollFactor 0 인 것은 월드 w 를 (w - c)·줌 + c 에 그린다.
         */
        const c = { x: cam.width / 2, y: cam.height / 2 };
        const worldX = hud.x + kid.x * hud.scaleX;
        const worldY = hud.y + kid.y * hud.scaleY;
        return {
          zoom: cam.zoom,
          hudScale: hud.scaleX,
          kidScreenX: (worldX - c.x) * cam.zoom + c.x,
          kidScreenY: (worldY - c.y) * cam.zoom + c.y,
        };
      });

    // 넷을 한자리에 모은다 — 뭉치면 당기는 것이 규칙이다
    await page.evaluate(() => {
      const s = window.game.scene.getScene('Battle');
      s.ais.length = 0;
      s.fighters.forEach((f, i) => {
        f.x = 900 + i * 12;
        f.y = 520;
        f.body?.setVelocity(0, 0);
        f.invulnUntil = s.time.now + 600000;
      });
    });
    await page.waitForTimeout(2500);
    const tight = await camState();

    // 이제 양 끝으로 흩어 놓는다 — 물러나야 한다
    await page.evaluate(() => {
      const s = window.game.scene.getScene('Battle');
      const live = s.fighters.filter((f) => f.alive);
      live.forEach((f, i) => {
        f.x = i % 2 === 0 ? 260 : 1660;
        f.body?.setVelocity(0, 0);
      });
    });
    await page.waitForTimeout(2500);
    const wide = await camState();

    if (!(tight.zoom > 1.02)) {
      bad(`[카메라] 넷이 뭉쳤는데 안 당깁니다 (줌 ${tight.zoom.toFixed(3)})`);
    } else if (!(wide.zoom < tight.zoom - 0.02)) {
      bad(
        `[카메라] 흩어졌는데 안 물러납니다 (${tight.zoom.toFixed(3)} → ${wide.zoom.toFixed(3)})`,
      );
    } else {
      ok(`줌 — 뭉치면 ${tight.zoom.toFixed(2)}배 · 흩어지면 ${wide.zoom.toFixed(2)}배`);
    }

    /*
     * 상쇄 확인 — 줌이 달랐던 두 순간에 HUD 자식이 **같은 화면 좌표**에
     * 있어야 한다. 어긋나면 당길 때마다 계기판이 슬금슬금 움직인다.
     */
    if (tight.kidScreenX === null || wide.kidScreenX === null) {
      bad('[카메라] HUD 자식을 못 찾아 상쇄를 확인하지 못했습니다');
    } else {
      const dx = Math.abs(tight.kidScreenX - wide.kidScreenX);
      const dy = Math.abs(tight.kidScreenY - wide.kidScreenY);
      const scaleOk = Math.abs(tight.hudScale * tight.zoom - 1) < 0.01;
      if (!scaleOk) {
        bad(
          `[카메라] HUD 되돌리기가 안 맞습니다 (줌 ${tight.zoom.toFixed(3)} × 크기 ${tight.hudScale.toFixed(3)})`,
        );
      } else if (dx > 1 || dy > 1) {
        bad(`[카메라] 줌에 따라 HUD 가 움직입니다 (${dx.toFixed(1)}, ${dy.toFixed(1)}px)`);
      } else {
        ok('HUD 는 당겨도 제자리 (되돌리기 상쇄 확인)');
      }
    }
  }

  /*
   * 10.5 상장폐지된 사람이 둘이면 유령도 둘인가.
   *
   * ── 왜 보는가 ──────────────────────────────────────────────────
   * 유령(공매도)은 자리 번호로 갈린다. 로컬 자리에 번호를 안 적으면 전부
   * 0번으로 접혀서, 둘째가 죽는 순간 **첫째의 유령을 함께 조종한다** —
   * 유령은 하나만 그려지고 두 사람의 좌우 입력이 같은 것을 밀고 당긴다.
   * 사람이 둘까지일 때는 둘 다 죽으면 판이 끝나 드러나지 않던 것이,
   * 넷이 되면서 실제로 보인다.
   */
  {
    await page.evaluate(() => {
      const s = window.game.scene.getScene('Battle');
      s.ais.length = 0;
      // 앞의 둘만 떨어뜨린다 — 나머지 둘이 남아야 판이 안 끝난다
      s.fighters.slice(0, 2).forEach((f) => s.stock.forceDelist(f.fighterId, null));
    });
    await page.waitForTimeout(2500);

    const ghosts = await page.evaluate(() => {
      const s = window.game.scene.getScene('Battle');
      return {
        dead: s.fighters.filter((f) => !f.alive).length,
        ghosts: s.ghosts.size,
        slots: [...s.ghosts.keys()],
      };
    });

    if (ghosts.dead < 2) {
      console.log(`  · 죽은 사람이 ${ghosts.dead}명뿐이라 유령 검사는 건너뜁니다`);
    } else if (ghosts.ghosts < 2) {
      bad(
        `[유령] 둘이 죽었는데 유령이 ${ghosts.ghosts}개입니다 (자리 ${JSON.stringify(ghosts.slots)})`,
      );
    } else {
      ok(`유령도 사람마다 하나 (자리 ${JSON.stringify(ghosts.slots)})`);
    }
  }

  /*
   * 11. 판이 끝난 뒤 패드로 다시 붙을 수 있는가.
   *
   * ── 왜 이게 중요한가 ───────────────────────────────────────────
   * 넷이서 하는 게임에서 **제일 자주 하게 될 동작**이 "한 판 더"다. 그런데
   * 결과 화면의 스타트가 부르던 것은 연승 도전(혼자 이겼을 때만 열린다)
   * 하나뿐이라, 사람 둘 이상이 붙은 판에서는 눌러도 아무 일이 없었다.
   * 전원이 패드를 쥐고 있는데 누군가 키보드까지 손을 뻗어 R 을 눌러야 했다.
   *
   * 아무 일도 안 일어나는 버튼은 화면에 흔적을 안 남긴다 — 눌러 봐야 안다.
   */
  {
    // 남은 사람을 전부 떨어뜨려 판을 끝낸다
    await page.evaluate(() => {
      const s = window.game.scene.getScene('Battle');
      s.ais.length = 0;
      const live = s.fighters.filter((f) => f.alive);
      // 하나만 남기고 상장폐지 — 그 하나가 승자가 된다
      live.slice(1).forEach((f) => s.stock.forceDelist(f.fighterId, null));
    });

    let ended = false;
    for (let i = 0; i < 40 && !ended; i++) {
      await page.waitForTimeout(300);
      ended = await page.evaluate(
        () => window.game?.scene?.getScene('Battle')?.resultShown ?? false,
      );
    }

    if (!ended) {
      bad('[한 판 더] 판이 끝나 결과 화면까지 가지 못했습니다');
    } else {
      // 전적표를 읽을 시간(1.2초)이 지나야 받는다 — 그 잠금도 함께 본다
      await padSet(BTN.START, true);
      await page.waitForTimeout(200);
      await padSet(BTN.START, false);
      await page.waitForTimeout(200);
      const tooEarly = await page.evaluate(
        () => window.game?.scene?.getScene('Battle')?.resultShown ?? false,
      );
      if (!tooEarly) {
        bad('[한 판 더] 전적표가 뜨자마자 눌린 것이 그대로 먹었습니다');
      }

      await page.waitForTimeout(1400);
      await tap(BTN.START, 260);

      let restarted = false;
      for (let i = 0; i < 40 && !restarted; i++) {
        await page.waitForTimeout(300);
        restarted = await page.evaluate(() => {
          const s = window.game?.scene?.getScene('Battle');
          return !!s && !s.resultShown && s.fighters.filter((f) => f.alive).length > 1;
        });
      }

      if (!restarted) bad('[한 판 더] 결과 화면에서 스타트로 새 판이 안 열립니다');
      else ok('결과 화면 → 스타트로 한 판 더 (연타 잠금도 걸린다)');

      /*
       * 등수가 실제로 오래 버틴 순서인가.
       *
       * 넷이 붙는 판에서 "내가 몇 등이야?"가 결과 화면의 전부다. 준 피해
       * 순으로 세우면 순위표가 아니라 통계표가 되는데, 화면만 봐서는
       * 그 둘이 구별이 안 간다 — 어느 쪽이든 줄이 넷 놓여 있을 뿐이다.
       */
      const places = await page.evaluate(() => {
        const s = window.game.scene.getScene('Battle');
        if (!s.koOrder) return null;
        return s.fighters.map((f) => ({
          name: f.cfg.name,
          alive: f.alive,
          koAt: s.koOrder.indexOf(f.fighterId),
          place: s.placementOf(f),
        }));
      });
      if (!places) {
        bad('[등수] 등수를 읽지 못했습니다');
      } else {
        const bad1 = places.filter((p) => p.alive && p.place !== 1);
        // 먼저 죽은 사람이 더 낮은 등수(숫자가 큼)여야 한다
        const dead = places.filter((p) => !p.alive).sort((a, b) => a.koAt - b.koAt);
        const monotonic = dead.every((p, i) => i === 0 || dead[i - 1].place > p.place);
        if (bad1.length) {
          bad(`[등수] 살아남았는데 1위가 아닙니다 — ${bad1.map((p) => p.name).join(', ')}`);
        } else if (!monotonic) {
          bad(
            `[등수] 먼저 죽은 사람이 더 높은 등수입니다 — ${dead
              .map((p) => `${p.name}:${p.place}위`)
              .join(' ')}`,
          );
        } else {
          ok(`등수는 오래 버틴 순서 (${places.length}명)`);
        }
      }
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
