#!/usr/bin/env node
/**
 * 스모크 테스트 — 변경 후 게임이 실제로 돌아가는지 항상 같은 기준으로 확인한다.
 *
 * "선택 → 전투 진입 → 이동/점프/약공격/강공격/커맨드 무브/스킬/방어/대시 → 결과"
 * 경로를 자동으로 밟으며 각 단계 스크린샷을 남기고, 콘솔 오류가 하나라도
 * 있으면 실패로 끝난다.
 *
 * 커맨드 무브(W+J, S+K, 공중 급강하 …)는 그림이 아니라 **기술 이름으로** 확인한다.
 * 눌린 방향에 맞는 기술이 실제로 발동했는지는 스크린샷으로 단정할 수 없기 때문이다.
 * 기대값은 게임 데이터에서 그대로 읽으므로, 캐릭터를 추가해도 테스트는 그대로 둔다.
 *
 * 사용법:
 *   npm run dev                   (다른 터미널에서 먼저 실행)
 *   npm run smoke                 (1번 캐릭터)
 *   npm run smoke -- 4            (5번 캐릭터 — 0부터 셈)
 *   HEADED=1 npm run smoke        (창을 띄워 눈으로 확인)
 *   PW_CHROMIUM=/path/to/chrome npm run smoke   (설치된 크로미움을 직접 지정)
 *
 * 결과물: tools/smoke-shots/*.png
 *
 * 주의: 헤드리스는 소프트웨어 렌더러라 4~6 FPS로 느리다.
 *       성능을 볼 목적이면 HEADED=1 로 볼 것 (실측 60 FPS).
 *       느린 프레임에서도 같은 시나리오가 되도록, 대기는 벽시계가 아니라
 *       게임 상태(행동 가능·지상/공중·주가)를 보고 끊는다.
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
/*
 * 브라우저를 직접 지정할 수 있게 열어 둔다.
 * playwright가 받은 브라우저 빌드 번호와 환경에 깔린 크로미움이 다를 때
 * (CI 컨테이너 등) 재설치 없이 있는 것을 그대로 쓰기 위함이다.
 *   PW_CHROMIUM=/path/to/chrome npm run smoke
 */
const browser = await chromium.launch({
  headless: HEADLESS,
  ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
});
const page = await (
  await browser.newContext({ viewport: { width: 1400, height: 900 } })
).newPage();

page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
page.on('console', (m) => {
  if (m.type() !== 'error') return;

  /*
   * 파비콘 등 게임과 무관한 404는 무시한다.
   *
   * 리소스 로드 실패 메시지에는 URL이 본문이 아니라 location에 담긴다.
   * 본문만 보면 파비콘 404가 걸러지지 않아 스모크가 항상 실패한다.
   */
  const where = m.location()?.url ?? '';
  if (/favicon|sourcemap/i.test(`${m.text()} ${where}`)) return;

  errors.push(`[console] ${m.text()}${where ? ` (${where})` : ''}`);
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
/*
 * 커맨드 무브는 스크린샷만으로 검증할 수 없다.
 *
 * 헤드리스는 프레임이 드물어 판정이 켜진 순간을 놓치기 일쑤고, 그림만 봐서는
 * "W+K를 눌렀는데 정말 상승기가 나갔는지"를 단정할 수 없다.
 * 그래서 attack()을 감싸 실제로 발동한 기술 이름을 기록한 뒤 대조한다.
 */
const installRecorder = () =>
  page.evaluate(() => {
    const scene = window.game?.scene?.getScene('Battle');
    const p = scene?.player;
    if (!p) return null;

    window.__moves ??= [];

    // 판을 새로 열면 플레이어 객체가 갈리므로 매번 다시 건다. 두 번 감싸지는 않는다.
    if (!p.__recorded) {
      const original = p.attack.bind(p);
      p.attack = (intent, dir) => {
        const move = p.resolveMove(intent, dir);
        const ok = original(intent, dir);
        if (ok) window.__moves.push(move.name);
        return ok;
      };
      p.__recorded = true;
    }

    // 기대값도 게임 데이터에서 그대로 읽는다 (테스트가 이름을 따로 알 필요가 없다)
    const m = p.cfg.moves;
    return {
      name: p.cfg.name,
      lightUp: m.lightUp.name,
      lightDown: m.lightDown.name,
      heavyUp: m.heavyUp.name,
      heavyDown: m.heavyDown.name,
      airDive: m.airDive.name,
    };
  });

const readMoves = () => page.evaluate(() => window.__moves ?? []);
const clearMoves = () => page.evaluate(() => void (window.__moves = []));

/** 플레이어의 현재 상태를 읽는다 */
const playerState = () =>
  page.evaluate(() => {
    const scene = window.game?.scene?.getScene('Battle');
    const p = scene?.player;
    if (!p) return null;
    return {
      alive: p.alive,
      free: p.canAct(),
      airborne: !(p.body.blocked.down || p.body.touching.down),
      stock: scene.stock?.get(p.fighterId) ?? -1,
    };
  });

/**
 * 조건이 만족될 때까지 기다린다.
 *
 * 벽시계로 기다리면 헤드리스처럼 프레임이 드문 환경에서 아직 후딜 중인
 * 캐릭터에게 다음 커맨드를 넣게 되고, 지상기가 공중기 자리에 나가버린다.
 * 게임 상태를 직접 보고 기다려야 프레임률과 무관하게 같은 시나리오가 된다.
 */
const waitUntil = async (check, label, timeout = 25000, quiet = false) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const s = await playerState();
    if (s && check(s)) return true;
    await page.waitForTimeout(90);
  }
  // quiet은 "실패해도 재시도할 대기"용 — 재시도 과정을 오류로 남기지 않는다
  if (!quiet) {
    errors.push(`[대기] ${label} — ${timeout}ms 안에 조건이 만족되지 않았습니다`);
  }
  return false;
};

/**
 * 지상 커맨드를 넣을 수 있는 상태가 될 때까지 기다린다.
 *
 * "행동 가능"만으로는 부족하다. 공중에 떠 있는 채로 S+J를 넣으면
 * 규칙대로 급강하가 나가므로, 지상기를 기대한 검증이 엉뚱하게 실패한다.
 */
const waitGrounded = async () => {
  const ready = (s) => s.alive && s.free && !s.airborne;
  if (await waitUntil(ready, '지상 · 행동 가능 대기', 12000, true)) return true;

  /*
   * 3명에게 둘러싸여 상장폐지되면 이후 커맨드는 영영 나가지 않는다.
   * 그건 커맨드가 고장난 게 아니라 죽어서다 — 판을 새로 열고 계속한다.
   */
  await restartRound();
  return waitUntil(ready, '지상 · 행동 가능 대기');
};

/**
 * R로 판을 새로 시작하고, 실제로 새 판이 돌기 시작할 때까지 기다린다.
 * (프레임이 드문 환경에서는 R 한 번이 프레임 사이로 사라질 수 있어 재시도한다)
 */
const restartRound = async () => {
  for (let i = 0; i < 6; i++) {
    await hold('r', 220);
    // 주가가 시작값으로 돌아왔고 조작이 먹으면 새 판이다
    const fresh = await waitUntil(
      (s) => s.alive && s.stock === 100 && s.free && !s.airborne,
      '새 판 시작 대기',
      6000,
      true,
    );
    if (fresh) {
      // 새 플레이어 객체에 기록기를 다시 건다
      await installRecorder();
      return true;
    }
  }
  errors.push('[대기] R로 새 판을 시작하지 못했습니다');
  return false;
};

/** 확실히 공중에 뜰 때까지 점프한다 (점프 입력도 같은 이유로 눌러 둔다) */
const goAirborne = async () => {
  for (let i = 0; i < 8; i++) {
    const s = await playerState();
    if (s?.airborne) return true;
    await hold('Space', 220);
    await page.waitForTimeout(90);
  }
  return false;
};

/**
 * 방향키를 누른 채 공격 버튼을 치는 커맨드 입력 (W+K 등).
 *
 * 단순히 press() 하면 안 된다. Phaser의 Key는 keyup에서 justDown을 지우므로,
 * 헤드리스처럼 프레임이 드문 환경에서는 눌렀다 뗀 사이에 게임 프레임이
 * 한 번도 돌지 않아 입력이 통째로 사라진다.
 * 버튼을 충분히 눌러 두고, 기술이 실제로 기록될 때까지 다시 시도한다.
 *
 * @param prep 매 시도 직전에 만족시킬 조건 (예: 공중에 떠 있기)
 */
const command = async (dirKey, btn, prep) => {
  const before = (await readMoves()).length;
  const until = Date.now() + 12000;
  let fired = false;

  while (Date.now() < until && !fired) {
    /*
     * prep은 반드시 방향키를 놓은 상태에서 돌려야 한다.
     * S를 누른 채로 점프시키면 공중에서 급강하(fastFall)가 걸려
     * 곧바로 지면에 처박히고, 결국 공중기가 아니라 지상기가 나간다.
     */
    if (prep) await prep();

    await page.keyboard.down(dirKey);
    await page.waitForTimeout(60);
    await page.keyboard.down(btn);
    await page.waitForTimeout(260);
    await page.keyboard.up(btn);
    await page.keyboard.up(dirKey);

    await page.waitForTimeout(120);
    fired = (await readMoves()).length > before;
  }

  if (!fired) errors.push(`[커맨드] ${dirKey}+${btn} 가 기술로 이어지지 않았습니다`);
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

/*
 * 커맨드 무브 — 같은 버튼이라도 방향에 따라 다른 기술이 나가야 한다.
 *
 * 검증은 새 판에서 한다. 앞 단계에서 이미 3명과 뒤엉킨 상태라면
 * 계속 경직에 걸려 "커맨드가 안 나갔다"가 되는데, 그건 커맨드의 문제가 아니라
 * 맞고 있어서다. 파이터가 흩어져 있는 개시 직후가 가장 깨끗한 검증 구간이다.
 */
await restartRound();

const expected = await installRecorder();
if (!expected) throw new Error('Battle 씬의 플레이어를 찾지 못했습니다');
await clearMoves();
console.log(`커맨드 무브 검증 대상: ${expected.name}`);

/*
 * 커맨드 하나마다 판을 새로 연다.
 *
 * 한 판에서 다섯 개를 이어서 넣으면 뒤로 갈수록 3명에게 둘러싸여,
 * 경직에 막힌 것을 "커맨드가 안 나갔다"로 오판하게 된다.
 * 개시 직후의 흩어진 상태가 커맨드 해석만 보기에 가장 깨끗하다.
 */
console.log('커맨드 무브 (상단기 · 하단기 · 급강하)');
const cases = [
  ['w', 'j', 'cmd-up-light', undefined],
  ['w', 'k', 'cmd-up-heavy', undefined],
  ['s', 'j', 'cmd-down-light', undefined],
  ['s', 'k', 'cmd-down-heavy', undefined],
  // 공중 급강하 — 시도 직전마다 공중에 떠 있는지 확인한다
  ['s', 'k', 'cmd-air-dive', goAirborne],
];

for (const [dir, btn, name, prep] of cases) {
  await restartRound();
  await waitGrounded();
  await command(dir, btn, prep);
  await shot(name);
}

/*
 * 순서까지 그대로 나와야 한다.
 * 하나라도 어긋나면 입력 → 슬롯 해석이 깨졌다는 뜻이다.
 */
const fired = await readMoves();
const want = [
  expected.lightUp,
  expected.heavyUp,
  expected.lightDown,
  expected.heavyDown,
  expected.airDive,
];
if (JSON.stringify(fired) !== JSON.stringify(want)) {
  errors.push(
    `[커맨드] 기대 ${JSON.stringify(want)} / 실제 ${JSON.stringify(fired)}`,
  );
} else {
  console.log(`  ✓ ${want.join(' → ')}`);
}

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
