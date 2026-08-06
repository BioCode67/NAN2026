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

/*
 * 스택까지 남긴다.
 * 메시지만 있으면 "Cannot read properties of undefined" 같은 오류가 어디서
 * 났는지 찾느라 처음부터 다시 재현해야 한다.
 */
page.on('pageerror', (e) => {
  const where = (e.stack ?? '').split('\n').slice(1, 4).join('\n');
  errors.push(`[pageerror] ${e.message}${where ? `\n${where}` : ''}`);
});
page.on('console', (m) => {
  if (m.type() !== 'error') return;

  /*
   * 파비콘 등 게임과 무관한 404는 무시한다.
   *
   * 리소스 로드 실패 메시지에는 URL이 본문이 아니라 location에 담긴다.
   * 본문만 보면 파비콘 404가 걸러지지 않아 스모크가 항상 실패한다.
   *
   * 아직 안 그린 배경·UI 그림(public/bg, public/ui)의 404도 같이 넘긴다.
   * 이 그림들은 없는 것이 정상 상태다 — 없으면 코드로 그린 화면이 대신한다.
   */
  const where = m.location()?.url ?? '';
  if (/favicon|sourcemap/i.test(`${m.text()} ${where}`)) return;
  if (/\/(bg|ui)\/[\w-]+\.png/.test(where)) return;

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

    /*
     * 기록 지점은 attack()이 아니라 beginAttack()이다.
     *
     * attack()에서 재면 선입력으로 쌓인 호출까지 "그 시점의 해석"으로 세어버려,
     * 연타를 몰아 넣었을 때 실제로는 1타→2타→3타가 나갔는데도 1타만 세 번
     * 나온 것처럼 보인다. 실제로 시작된 모션을 세야 맞다.
     */
    if (!p.__recorded) {
      const originalBegin = p.beginAttack.bind(p);
      p.beginAttack = (atk) => {
        window.__moves.push(atk.name);
        return originalBegin(atk);
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
      // 연속기 — J 를 세 번 이어 누르면 순서대로 나가야 한다
      chain: [m.light.name, m.light2.name, m.light3.name],
    };
  });

const readMoves = () => page.evaluate(() => window.__moves ?? []);
const clearMoves = () => page.evaluate(() => void (window.__moves = []));
/** 기록을 n개까지만 남긴다 (빗나간 시도를 지우고 다시 해보기 위함) */
const trimMoves = (n) =>
  page.evaluate((len) => void (window.__moves.length = len), n);

/**
 * 프롬프트 오버레이가 떠 있으면 넘긴다.
 *
 * 오브를 깨면 판이 멈추고 입력창이 뜬다. 기믹을 검증하는 단계가 아니라면
 * 이게 떠 있는 채로 다음 커맨드를 넣게 되어 "조작이 안 먹는다"로 오판한다.
 */
const dismissPrompt = async () => {
  if ((await page.locator('[data-testid="prompt-overlay"]').count()) === 0) {
    return false;
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(220);
  return true;
};

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
      // 지면까지 남은 높이 — "떠 있다"만으로는 착지 직전인지 알 수 없다
      height: 590 - (p.y + 42),
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
    // 입력창이 떠 있으면 게임이 멈춰 있어 조건이 영영 안 바뀐다
    if (await dismissPrompt()) continue;

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

/**
 * 급강하를 넣을 수 있을 만큼 확실히 띄운다.
 *
 * "떠 있다"만 보고 누르면 안 된다. 착지 직전 몇 픽셀 높이에서도 조건은 참이지만,
 * 키 입력이 처리되는 다음 프레임에는 이미 지면이라 공중기가 아니라 지상기가 나간다.
 * 프레임이 드문 환경일수록 이 틈이 커지므로, 2단 점프까지 써서 여유 높이를 만든다.
 */
const DIVE_MIN_HEIGHT = 130;

const goAirborne = async () => {
  for (let i = 0; i < 10; i++) {
    const s = await playerState();
    if (!s?.alive) return false;
    if (s.airborne && s.height > DIVE_MIN_HEIGHT) return true;

    // 후딜·경직 중에는 점프가 씹힌다 — 풀린 뒤에 누른다
    if (s.free || s.airborne) {
      await hold('Space', 200);
      await page.waitForTimeout(70);
      // 2단 점프로 한 번 더 밀어 올려 여유를 만든다
      await hold('Space', 200);
    }
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
 * @param prep   매 시도 직전에 만족시킬 조건 (예: 공중에 떠 있기)
 * @param expect 나와야 하는 기술 이름. 다른 게 나오면 기록을 지우고 다시 시도한다
 */
const command = async (dirKey, btn, prep, expect) => {
  const before = (await readMoves()).length;
  const until = Date.now() + 12000;
  let fired = false;

  while (Date.now() < until && !fired) {
    /*
     * prep은 반드시 방향키를 놓은 상태에서 돌려야 한다.
     * S를 누른 채로 점프시키면 공중에서 급강하(fastFall)가 걸려
     * 곧바로 지면에 처박히고, 결국 공중기가 아니라 지상기가 나간다.
     */
    /*
     * 준비가 안 됐으면 이번 시도는 건너뛴다.
     * 공중에 못 뜬 채로 S+K를 누르면 지상 광역기가 나가고,
     * 그게 기록되어 "급강하가 안 나왔다"가 아니라 "엉뚱한 기술이 나왔다"가 된다.
     */
    if (prep && (await prep()) === false) {
      await page.waitForTimeout(120);
      continue;
    }

    /*
     * 방향키와 버튼은 간격 없이 함께 누른다.
     *
     * 게임은 프레임 시점의 키 상태를 읽으므로 순서는 상관없지만, 사이에 틈을 두면
     * 그 사이 프레임에서 S만 눌린 상태가 되어 공중 급강하(fastFall)가 걸린다.
     * 프레임이 드문 환경에서는 그 한 프레임에 지면까지 내려와, 공중기를 노렸는데
     * 지상 광역기가 나가버린다.
     */
    await page.keyboard.down(dirKey);
    await page.keyboard.down(btn);
    await page.waitForTimeout(260);
    await page.keyboard.up(btn);
    await page.keyboard.up(dirKey);

    await page.waitForTimeout(120);
    const list = await readMoves();
    if (list.length <= before) continue;

    /*
     * 나온 기술이 기대와 다르면 없던 일로 하고 다시 건다.
     *
     * 공중 급강하가 대표적이다. "떠 있다"를 확인한 뒤 키를 누르기까지
     * 브라우저를 몇 번 오가는데, 그 사이에 프레임이 돌아 착지해 버리면
     * 같은 S+K가 지상기로 해석된다. 그건 조작 해석이 깨진 게 아니라
     * 테스트가 준비에 실패한 것이므로, 실패로 세지 않고 다시 시도한다.
     */
    if (expect && list[before] !== expect) {
      await trimMoves(before);
      continue;
    }
    fired = true;
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

/*
 * 타이틀 → 캐릭터 선택.
 *
 * 시간을 재서 넘기지 않는다 — 저사양 헤드리스에서는 부팅이 몇 초씩 밀린다.
 * 선택 씬이 실제로 살아날 때까지 Enter를 두드린다.
 */
const sceneAlive = (key) =>
  page.evaluate((k) => !!window.game?.scene?.isActive(k), key).catch(() => false);

let atSelect = false;
for (let i = 0; i < 60; i++) {
  if (await sceneAlive('Select')) {
    atSelect = true;
    break;
  }
  if (await sceneAlive('Title')) {
    if (i === 0) await shot('title');
    await page.keyboard.press('Enter');
  }
  await page.waitForTimeout(250);
}
if (!atSelect) errors.push('[부팅] 캐릭터 선택 화면까지 넘어가지 못했습니다');

await page.waitForTimeout(600);
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
  ['w', 'j', 'cmd-up-light', undefined, expected.lightUp],
  ['w', 'k', 'cmd-up-heavy', undefined, expected.heavyUp],
  ['s', 'j', 'cmd-down-light', undefined, expected.lightDown],
  ['s', 'k', 'cmd-down-heavy', undefined, expected.heavyDown],
  // 공중 급강하 — 시도 직전마다 공중에 떠 있는지 확인한다
  ['s', 'k', 'cmd-air-dive', goAirborne, expected.airDive],
];

for (const [dir, btn, name, prep, want] of cases) {
  await restartRound();
  await waitGrounded();
  await command(dir, btn, prep, want);
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

/*
 * 연속기 — J 를 이어 누르면 1타 → 2타 → 마무리로 넘어가야 한다.
 *
 * 여기서는 키보드가 아니라 attack()을 직접 세 번 호출한다.
 * 프레임이 드문 환경에서 키 입력이 프레임 사이로 사라지면 "연타가 안 이어졌다"가
 * 되는데, 그건 연속기가 아니라 입력이 문제다 — 키보드 경로는 위 커맨드 검증이
 * 이미 확인했으므로, 여기서는 연타 캔슬과 선입력 버퍼만 떼어 본다.
 *
 * 세 번을 한 프레임에 몰아 넣는 것이 곧 "손이 빠른 사람의 연타"다.
 * 버퍼가 한 칸뿐이면 3타가 버려져 여기서 잡힌다.
 */
await restartRound();
await waitGrounded();
await clearMoves();

await page.evaluate(() => {
  const p = window.game.scene.getScene('Battle').player;
  p.attack('light', 'neutral');
  p.attack('light', 'neutral');
  p.attack('light', 'neutral');
});

// 상태 머신이 세 타를 다 흘려보낼 때까지 기다린다
for (let i = 0; i < 40; i++) {
  if ((await readMoves()).length >= expected.chain.length) break;
  await page.waitForTimeout(120);
}
await shot('chain-jjj');

const chained = await readMoves();
if (JSON.stringify(chained) !== JSON.stringify(expected.chain)) {
  errors.push(
    `[연속기] 기대 ${JSON.stringify(expected.chain)} / 실제 ${JSON.stringify(chained)}`,
  );
} else {
  console.log(`  ✓ 연속기 ${expected.chain.join(' → ')}`);
}
await clearMoves();

/*
 * 프롬프트 기믹 — 오브를 깨고 문장을 입력하면 판이 실제로 바뀌어야 한다.
 *
 * 오브 등장을 기다리면 스모크가 한없이 길어지므로 타이머만 당겨서 띄운다.
 * 확인하려는 것은 "떠서 → 깨지고 → 입력창이 뜨고 → 그 문장대로 룰이 바뀐다"는
 * 연결이지, 오브가 몇 초 뒤에 나오느냐가 아니다.
 */
console.log('프롬프트 기믹');
await restartRound();
await waitGrounded();

/*
 * 등장 타이머를 반복해서 당긴다.
 *
 * 한 번만 당기면 안 된다 — 판이 시작될 때 인트로가 orbs.start()를 다시 불러
 * 타이머를 원래대로 되돌린다. 오브 갱신은 전투가 실제로 시작된 뒤에만 도므로,
 * "떴는가"를 보면서 될 때까지 당기는 편이 확실하다.
 */
let orbUp = false;
for (let i = 0; i < 25 && !orbUp; i++) {
  orbUp = await page.evaluate(() => {
    const s = window.game.scene.getScene('Battle');
    s.orbs.nextSpawnAt = 0;
    return s.orbs.isActive();
  });
  if (!orbUp) await page.waitForTimeout(300);
}
if (!orbUp) errors.push('[기믹] 프롬프트 오브가 등장하지 않았습니다');
await shot('orb-spawn');

// 플레이어가 깬 것으로 처리 → 입력창이 떠야 한다
await page.evaluate(() => {
  const s = window.game.scene.getScene('Battle');
  s.orbs.onBreak(s.player);
});
await page.waitForSelector('[data-testid="prompt-overlay"]', { timeout: 8000 })
  .catch(() => errors.push('[기믹] 프롬프트 입력창이 뜨지 않았습니다'));
await shot('orb-prompt');

/* 문장 → 룰 변경. 리듬 배틀은 승부 방식 자체가 바뀌는 대표 기믹이다 */
await page.locator('[data-testid="prompt-input"]').fill('리듬으로 승부하자');
await page.keyboard.press('Enter');
await page.waitForTimeout(1600);
await shot('orb-gimmick');

const gimmickState = await page.evaluate(() => {
  const s = window.game.scene.getScene('Battle');
  return {
    active: s.gimmicks.getActive().map((a) => a.spec.id),
    rhythm: s.rhythm.isActive(),
    overlayGone: !document.querySelector('[data-testid="prompt-overlay"]'),
  };
});

if (!gimmickState.active.includes('rule_rhythm') || !gimmickState.rhythm) {
  errors.push(
    `[기믹] "리듬으로 승부하자" 가 리듬 배틀로 이어지지 않았습니다: ${JSON.stringify(gimmickState)}`,
  );
} else if (!gimmickState.overlayGone) {
  errors.push('[기믹] 확정 후에도 입력창이 남아 있습니다');
} else {
  console.log('  ✓ 오브 → 프롬프트 → 리듬 배틀');
}

/* 맵 기믹은 물리가 실제로 바뀌는지로 확인한다 */
const gravityBefore = await page.evaluate(
  () => window.game.scene.getScene('Battle').physics.world.gravity.y,
);
await page.evaluate(() => {
  const s = window.game.scene.getScene('Battle');
  s.orbs.onBreak(s.player);
});
await page.waitForSelector('[data-testid="prompt-overlay"]', { timeout: 8000 }).catch(() => {});
await page.locator('[data-testid="prompt-input"]').fill('달로 보내줘');
await page.keyboard.press('Enter');
await page.waitForTimeout(1400);

const gravityAfter = await page.evaluate(
  () => window.game.scene.getScene('Battle').physics.world.gravity.y,
);
if (!(gravityAfter < gravityBefore)) {
  errors.push(`[기믹] 저중력이 걸리지 않았습니다 (${gravityBefore} → ${gravityAfter})`);
} else {
  console.log(`  ✓ 오브 → 프롬프트 → 저중력 (중력 ${gravityBefore} → ${gravityAfter})`);
}
await shot('orb-moon');

/*
 * 캐릭터 고유 메커니즘.
 *
 * 다섯 캐릭터가 각자 다른 조작 규칙을 갖는 것이 이 게임에서 캐릭터를
 * 고르는 이유다. 규칙이 조용히 죽어도 화면상으로는 티가 안 나므로
 * 상태값으로 직접 확인한다. (스모크는 한 캐릭터만 돌리므로 자기 것만 본다)
 */
console.log('고유 메커니즘');
await restartRound();
await waitGrounded();

const sig = await page.evaluate(() => {
  const s = window.game.scene.getScene('Battle');
  const me = s.player;
  const foe = s.fighters.find((f) => f !== me);
  const id = me.cfg.signature.id;

  switch (id) {
    case 'shares': {
      for (let i = 0; i < 5; i++) me.onDealtHit();
      const stacked = me.getSignatureStacks();
      me.skillReadyAt = 0;
      me.useSkill();
      const name = me.getCurrentAttack()?.name ?? '';
      // 지분을 태워 이름이 바뀌고 스택이 비워져야 한다
      return { id, ok: stacked === 5 && me.getSignatureStacks() === 0 && name.includes('지분'), detail: name };
    }
    case 'oneMoreThing': {
      me.skillReadyAt = 0;
      me.useSkill();
      me.onSkillLanded();
      return { id, ok: me.isSignatureWindowOpen(), detail: '후속 입력 창' };
    }
    case 'booster': {
      const full = me.getSignatureStacks();
      me.body.blocked.down = false;
      me.body.touching.down = false;
      const airDash = me.dash(1);
      // 공중 대시가 되고 부스터가 한 칸 줄어야 한다
      return { id, ok: full > 0 && airDash && me.getSignatureStacks() === full - 1, detail: `공중 대시 ${airDash}` };
    }
    case 'fork': {
      me.onGuarded(foe.cfg.moves.heavy);
      const stolen = me.getForkedName();
      me.skillReadyAt = 0;
      me.useSkill();
      const cast = me.getCurrentAttack()?.name ?? '';
      return { id, ok: !!stolen && cast.startsWith('포크:'), detail: cast };
    }
    case 'balloon': {
      for (let i = 0; i < 3; i++) me.onDealtHit();
      const stacked = me.getSignatureStacks();
      me.jumpsLeft = 0;
      me.body.blocked.down = false;
      me.body.touching.down = false;
      me.jump();
      const afterJump = me.getSignatureStacks();
      me.receiveHit(me.cfg.moves.light, me.x - 50);
      // 풍선으로 한 번 더 뛰고, 맞으면 전부 터져야 한다
      return {
        id,
        ok: stacked === 3 && afterJump === 2 && me.getSignatureStacks() === 0,
        detail: `${stacked} → ${afterJump} → 0`,
      };
    }
    default:
      return { id, ok: false, detail: '알 수 없는 메커니즘' };
  }
});

if (!sig.ok) {
  errors.push(`[고유] ${sig.id} 메커니즘이 동작하지 않습니다: ${sig.detail}`);
} else {
  console.log(`  ✓ 고유 메커니즘 ${sig.id} (${sig.detail})`);
}
await shot('signature');

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
