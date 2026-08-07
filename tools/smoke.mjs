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
      /*
       * FIGHT! 가 떠야 조작이 먹는다.
       * 개시 연출(READY? → FIGHT!) 동안 BattleScene은 handleInput을 아예
       * 호출하지 않는다. 이걸 안 보고 키를 넣으면 입력이 통째로 사라져
       * "커맨드가 안 나갔다"로 오판한다.
       */
      active: !!scene.battleActive,
      /*
       * 이 플레이어 객체에 기록기가 붙어 있는가.
       * 판이 갈리면 플레이어 객체가 통째로 새로 만들어지므로,
       * 이 값이 새 판인지 옛 판인지를 가리는 유일하게 확실한 표시다.
       */
      recorded: !!p.__recorded,
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
  const ready = (s) => s.alive && s.active && s.free && !s.airborne;
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
    /*
     * R을 누르기 전에 지금 기록기가 붙어 있는지 봐 둔다.
     *
     * "주가가 100이고 조작이 먹으면 새 판"으로는 판별할 수 없다.
     * 아직 아무도 맞지 않은 **옛 판**도 똑같이 100이어서, R을 누른 직후
     * 옛 씬을 새 판으로 착각한다. 그러면 기록기를 곧 사라질 옛 플레이어에
     * 달게 되고, 진짜 새 판에서 나간 기술은 하나도 세어지지 않는다.
     * (커맨드 검증의 앞쪽 몇 개만 실패하던 원인이 이것이었다)
     *
     * 판이 갈리면 플레이어 객체가 새로 만들어지므로 기록기 표시도 함께
     * 사라진다. 그 사라짐을 새 판의 증거로 삼는다.
     */
    const wasRecorded = (await playerState())?.recorded ?? false;

    await hold('r', 220);

    /*
     * 여기서는 "씬이 갈렸는가"만 본다. "조작이 먹는가"는 waitGrounded 몫이다.
     *
     * 개시 연출이 끝나기(FIGHT!)를 여기서 함께 기다리면 안 된다.
     * 그 시점에는 이미 봇 셋이 달려들어, 주가가 시작값에 머무는 구간이
     * 한순간뿐이라 폴링이 그 틈을 놓친다.
     */
    const fresh = await waitUntil(
      (s) =>
        s.alive &&
        (wasRecorded
          ? // 기록기가 떨어져 나갔다 = 플레이어 객체가 새로 만들어졌다
            !s.recorded
          : // 첫 호출이라 비교할 기록기가 없다 — 시작 상태로 갈음한다
            s.stock === 100 && s.free && !s.airborne),
      '새 판 시작 대기',
      8000,
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
/*
 * 급강하를 걸기 전에 확보해야 하는 높이.
 *
 * 브라우저를 오가는 사이에도 계속 떨어진다 — 방향키와 공격키를 누르는 두 번의
 * 왕복만으로 100px 넘게 내려오고, S가 먼저 눌린 프레임에서는 급강하 낙하까지
 * 붙는다. 여유를 넉넉히 두지 않으면 공중기를 노렸는데 지상기가 나간다.
 */
const DIVE_MIN_HEIGHT = 150;

const goAirborne = async () => {
  for (let i = 0; i < 6; i++) {
    const s = await playerState();
    if (!s?.alive) return false;
    if (s.airborne && s.height > DIVE_MIN_HEIGHT) return true;

    /*
     * 후딜·경직 중에는 점프가 씹힌다 — 풀린 뒤에 누른다.
     *
     * 충분히 길게 누른다. 짧게 누르면 숏홉이 되어(버튼을 떼면 상승이 잘린다)
     * 급강하를 넣기 전에 착지해 버린다. 사람도 높이 뛰려면 길게 누른다.
     */
    if (s.free || s.airborne) {
      await hold('Space', 420);
      await page.waitForTimeout(60);
      // 2단 점프로 한 번 더 밀어 올려 여유를 만든다
      await hold('Space', 420);
      // 여기서 이미 충분히 떴으면 더 기다리지 않는다 — 기다리는 만큼 떨어진다
      const now = await playerState();
      if (now?.airborne && now.height > DIVE_MIN_HEIGHT) return true;
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
  const until = Date.now() + 22000;
  let fired = false;
  /* 실패했을 때 "무엇이 대신 나갔는지"를 말해 주기 위해 마지막 오답을 남긴다 */
  let wrong = null;

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
    /*
     * 두 키를 한 번에 보낸다. 하나씩 await 하면 그 사이에도 브라우저를
     * 오가고, 방향키만 눌린 그 프레임에서 급강하 낙하가 붙어 착지해 버린다.
     */
    await Promise.all([page.keyboard.down(dirKey), page.keyboard.down(btn)]);
    await page.waitForTimeout(200);
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
      wrong = list[before];
      await trimMoves(before);
      continue;
    }
    fired = true;
  }

  if (!fired) {
    const why = wrong
      ? `기대 "${expect}" 대신 "${wrong}" 이(가) 나갔습니다`
      : '아무 기술도 발동하지 않았습니다';
    errors.push(`[커맨드] ${dirKey}+${btn} 가 기술로 이어지지 않았습니다 — ${why}`);
  }
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
    /*
     * 한 번 누르고 페이드가 끝날 때까지 기다린다.
     * 짧게 끊어 여러 번 누르면 그중 하나가 선택 화면으로 새어 들어가
     * 캐릭터를 즉시 확정해 버려, 이후 단계가 통째로 엉뚱해진다.
     */
    await page.waitForTimeout(700);
    continue;
  }
  await page.waitForTimeout(250);
}
if (!atSelect) errors.push('[부팅] 캐릭터 선택 화면까지 넘어가지 못했습니다');

await page.waitForTimeout(600);
await shot('select');

/*
 * 메뉴 곡이 실제로 돌고 있는가.
 *
 * 소리는 스크린샷에 안 남는다. 시퀀서가 멈춰도 화면은 멀쩡하므로, 곡이
 * 죽은 채 제출되는 사고는 눈으로는 절대 안 잡힌다. 스텝 수가 실제로
 * 늘어나는지를 두 번 읽어 확인한다.
 */
{
  const read = () => page.evaluate(() => window.sound?.bgmDebug ?? null);
  const a = await read();
  await page.waitForTimeout(700);
  const b = await read();

  if (!a || !b) {
    errors.push('[BGM] 사운드 시스템을 읽지 못했습니다');
  } else if (a.track !== 'menu') {
    errors.push(`[BGM] 메뉴 곡이 아닙니다: ${a.track}`);
  } else if (b.step <= a.step) {
    errors.push(`[BGM] 시퀀서가 멈춰 있습니다 (${a.step} → ${b.step})`);
  } else {
    console.log(`  ✓ 메뉴 곡 재생 중 (${a.step} → ${b.step} 스텝)`);
  }
}

/*
 * 상세 보기 — 커맨드 열네 개를 펼쳐 보는 화면.
 *
 * 이 게임의 가장 큰 자산이 "스무 명 × 열네 개 = 280개의 서로 다른 기술
 * 이름"인데, 그것을 실제로 보여주는 화면이 여기 하나뿐이다. 열리지 않으면
 * 자산이 통째로 안 보이는 것이라, 눈으로 확인할 수 있어도 검사에 넣는다.
 */
const isDetailOpen = () =>
  page.evaluate(() => !!window.game?.scene?.getScene('Select')?.detail);

/*
 * 키를 두 가지로 받는 이유는 UI 쪽과 같다 — TAB 은 브라우저가 먼저
 * 가로챌 수 있어서, 막히면 기능 전체가 사라지지 않도록 I 도 받는다.
 * 검사도 둘 다 눌러 보고 어느 쪽으로 열렸는지 남긴다.
 */
let openedBy = '';
for (const key of ['Tab', 'i']) {
  await page.keyboard.press(key);
  await page.waitForTimeout(400);
  if (await isDetailOpen()) {
    openedBy = key;
    break;
  }
}

if (!openedBy) errors.push('[선택] TAB · I 어느 쪽으로도 상세 보기가 열리지 않았습니다');
else console.log(`  ✓ ${openedBy.toUpperCase()} → 커맨드 상세`);
await shot('detail');

// 닫기 — 열려 있으면 다음 단계의 방향키가 안 먹는다
for (let i = 0; i < 3 && (await isDetailOpen()); i++) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
}

for (let i = 0; i < PICK; i++) {
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(250);
}
await shot('picked');

await page.keyboard.press('Enter');
// 페이드아웃 + 전투 생성 + READY/FIGHT 연출
await page.waitForTimeout(3600);
await shot('battle-start');

// 전투에 들어오면 곡이 바뀐다 — 메뉴 곡이 그대로 흐르면 배선이 빠진 것이다
{
  const now = await page.evaluate(() => window.sound?.bgmDebug ?? null);
  if (now?.track !== 'battle') {
    errors.push(`[BGM] 전투 곡으로 바뀌지 않았습니다: ${now?.track}`);
  } else {
    console.log('  ✓ 전투 곡으로 전환');
  }
}

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

  /*
   * 공중 급강하만 중력을 낮춰 놓고 확인한다.
   *
   * 확인하려는 것은 "공중에서 S+K 가 급강하로 해석되는가"이지 체공 시간이
   * 아니다. 그런데 헤드리스는 키 하나 누르는 데도 브라우저를 오가느라
   * 100ms 넘게 걸리고, 그 사이에 떨어져 착지해 버려 같은 입력이 지상기로
   * 해석된다 — 조작이 깨진 게 아니라 검사가 준비에 실패하는 것이다.
   * 체공을 넉넉히 만들어 그 변수를 지운다.
   */
  const slowFall = name === 'cmd-air-dive';
  let gravityBefore = 0;
  if (slowFall) {
    gravityBefore = await page.evaluate(() => {
      const w = window.game.scene.getScene('Battle').physics.world;
      const before = w.gravity.y;
      w.gravity.y = 520;
      return before;
    });
  }

  await command(dir, btn, prep, want);

  if (slowFall) {
    await page.evaluate((g) => {
      window.game.scene.getScene('Battle').physics.world.gravity.y = g;
    }, gravityBefore);
  }

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
 * 한 문장에 두 가지 — 이 게임의 축이 실제로 두 번 작동하는가.
 *
 * 해석기 단위 검사(test:prompt)는 "둘로 읽는다"까지만 본다. 실제로 둘 다
 * 걸리는지는 다른 문제다 — 둘째는 배너가 겹치지 않도록 늦춰 걸리므로,
 * 그 지연 경로가 끊어져도 단위 검사는 통과한다.
 */
/*
 * 오브를 깨기 전에 플레이어가 살아 있는지 확인한다.
 *
 * runPrompt 는 전투가 끝났으면 입력창을 아예 열지 않는다. 앞 단계에서
 * 셋에게 둘러싸여 상장폐지됐으면 여기서 "입력창이 안 뜬다"로 멈추는데,
 * 그건 기믹이 고장난 게 아니라 죽어서다.
 */
await waitGrounded();
await page.evaluate(() => {
  const s = window.game.scene.getScene('Battle');
  s.orbs.onBreak(s.player);
});
await page.waitForSelector('[data-testid="prompt-overlay"]', { timeout: 8000 }).catch(() => {});
await page.locator('[data-testid="prompt-input"]').fill('전부 거대하게 만들고 느리게');
await page.keyboard.press('Enter');

/*
 * 둘째는 배너가 겹치지 않도록 늦춰 걸린다. 고정 시간으로 기다리면 앞
 * 단계에서 걸어 둔 슬로우 모션 같은 것이 시계를 늦출 때 놓친다 —
 * 둘 다 걸릴 때까지 본다.
 */
let combo = [];
for (let i = 0; i < 30; i++) {
  combo = await page.evaluate(() =>
    window.game.scene.getScene('Battle').gimmicks.getActive().map((a) => a.spec.id),
  );
  if (combo.includes('rule_giant') && combo.includes('rule_slow')) break;
  await page.waitForTimeout(200);
}
if (!combo.includes('rule_giant') || !combo.includes('rule_slow')) {
  errors.push(
    `[기믹] 한 문장에 두 가지를 썼는데 둘 다 걸리지 않았습니다: ${JSON.stringify(combo)}`,
  );
} else {
  console.log('  ✓ 한 문장 → 기믹 둘 (거대화 + 슬로우 모션)');
}
await shot('orb-combo');

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

/*
 * 봇 성격.
 *
 * 캐릭터마다 고유 메커니즘을 만들어 놨어도 봇이 그걸 쓰지 않으면
 * 네 명이 붙어도 이름표만 다른 같은 봇 넷과 싸우는 것이 된다.
 * 플레이어를 가만히 둔 채 한동안 지켜보며 두 가지를 본다.
 *   - 봇마다 서로 다른 성격을 들고 있는가
 *   - 막는 캐릭터(리누스)가 실제로 막는가
 * 겸사겸사 봇이 여전히 공격적인지도 확인한다 — 방어를 넣었으니 소극적으로
 * 변했을 수 있다. 가만히 서 있는데 아무도 안 때리면 그게 더 큰 문제다.
 */
console.log('봇 성격');
/*
 * 여기서는 판을 새로 열지 않는다.
 *
 * 개시 직후에는 넷이 1920 폭에 흩어져 있고, 헤드리스는 3~5 FPS라
 * 봇이 플레이어에게 닿는 데만 벽시계로 십수 초가 걸린다. 그 시간을
 * 관전 창으로 쓰면 "봇이 안 때린다"가 아니라 "아직 오는 중"을 보게 된다.
 * 앞 단계에서 이미 엉겨 붙은 지금이, 보려는 것(붙어 있는데도 안 때리는가)에
 * 맞는 상태다. 죽어 있을 때만 새로 연다.
 */
if (!(await playerState())?.alive) await restartRound();
{
  /*
   * 관전 창은 FIGHT! 가 뜬 뒤에 연다.
   *
   * 헤드리스는 10~15 FPS라 인트로(READY?/FIGHT!)가 벽시계로 몇 초씩 늘어진다.
   * 그동안 봇은 아예 돌지 않으므로(battleActive=false), 시간을 재서 기다리면
   * 관전 창 전체를 인트로가 먹고 "봇이 공격을 안 한다"는 오판이 나온다.
   */
  await page
    .waitForFunction(
      () => window.game?.scene?.getScene('Battle')?.battleActive === true,
      null,
      { timeout: 30000, polling: 200 },
    )
    .catch(() => errors.push('[봇] 전투가 시작되지 않았습니다'));

  /*
   * 1) 배선 확인 — 봇이 자기 캐릭터의 성격을 들고 있는가.
   *
   * 이건 확률이 섞이지 않아 매번 같은 답이 나온다. 성격표를 만들어 놓고
   * 엉뚱한 캐릭터에 붙이는 실수가 가장 흔하고 가장 안 보이므로 여기서 잡는다.
   */
  const wiring = await page.evaluate(() => {
    const sc = window.game?.scene?.getScene('Battle');
    if (!sc?.ais) return null;
    const bots = sc.fighters.filter((f) => f.side === 'ai');
    return sc.ais.map((a, i) => ({
      name: bots[i].cfg.name,
      sig: bots[i].cfg.signature.id,
      label: a.getPersona().label,
    }));
  });

  if (!wiring) {
    errors.push('[봇] 봇 정보를 읽지 못했습니다');
  } else {
    const labels = wiring.map((w) => w.label);
    if (new Set(labels).size < labels.length) {
      errors.push(`[봇] 성격이 겹칩니다: ${labels.join(' / ')}`);
    }
    // 고유 메커니즘 → 성격 이 1:1로 붙었는지 (같은 메커니즘이면 같은 성격)
    const bySig = new Map();
    for (const w of wiring) {
      const prev = bySig.get(w.sig);
      if (prev && prev !== w.label) {
        errors.push(`[봇] ${w.sig} 에 성격이 두 개 붙어 있습니다`);
      }
      bySig.set(w.sig, w.label);
    }
    console.log(
      `  ✓ 성격 배선 ${wiring.map((w) => `${w.name}=${w.label}`).join(' / ')}`,
    );
  }

  /*
   * 2) 소극적으로 변하지 않았는가.
   *
   * 방어를 넣었으니 봇이 막기만 하다 끝날 수 있다. 플레이어가 치는 상황을
   * 만들어 주며 지켜보다가, 아무도 공격 자세에 들어가지 않고 주가도 그대로면
   * 그때만 실패로 본다. 몇 초 만에 때리느냐는 월드 크기와 프레임률에 좌우되므로
   * 시간은 기준으로 삼지 않는다.
   */
  const seen = { guarded: false, attacked: false };
  let stock = 100;

  const until = Date.now() + 14000;
  while (Date.now() < until) {
    await dismissPrompt();
    // 봇이 막을 것이 있어야 방어도 나온다 — 가만히 서 있으면 EVADE 자체가 안 뜬다
    await page.keyboard.press('j');

    const snap = await page.evaluate(() => {
      const sc = window.game?.scene?.getScene('Battle');
      if (!sc?.ais) return null;
      return {
        states: sc.ais.map((a) => a.getState()),
        guarding: sc.fighters.some((f) => f.side === 'ai' && f.isGuarding()),
        stock: sc.stock.get(sc.player.fighterId),
      };
    });

    if (snap) {
      if (snap.guarding) seen.guarded = true;
      if (snap.states.includes('ATTACK')) seen.attacked = true;
      stock = Math.min(stock, snap.stock);
    }
    await page.waitForTimeout(140);
  }

  if (!seen.attacked && stock >= 98) {
    errors.push('[봇] 14초 동안 아무도 공격하지 않았습니다 — 방어만 하고 있습니다');
  }

  /*
   * 방어를 봤는지는 알림으로만 남긴다.
   * 봇이 막을지는 확률이고 상대도 무작위로 뽑히므로, 못 봤다고 고장은 아니다.
   * 막을지 말지의 규칙 자체는 npm run test:ai 가 확정적으로 검사한다.
   */
  console.log(
    `    공격 ${seen.attacked ? 'O' : '-'} · 방어 ${seen.guarded ? 'O' : '-'} · 주가 ${stock}%`,
  );
}
await shot('ai-persona');

console.log('전투 진행');
for (let i = 0; i < 20; i++) {
  await page.keyboard.press('j');
  await page.waitForTimeout(180);
  await page.keyboard.press('k');
  await page.waitForTimeout(300);
  if (i % 6 === 0) await page.keyboard.press('l');
}
await shot('mid-battle');

/*
 * 결과 화면까지 간다.
 *
 * 전적표는 판이 끝나야만 나오는 화면이라, 여기까지 오지 않으면 통째로
 * 검증되지 않는다. 이기든 지든 상관없다 — 표가 그려지고 숫자가 채워지는지만 본다.
 */
await waitUntil(
  (st) => !st.active,
  '전투 종료 대기',
  40000,
  true,
);
await page.waitForTimeout(1200);
await shot('final');

const board = await page.evaluate(() => {
  const s = window.game.scene.getScene('Battle');
  const me = s.stats?.get(s.player.fighterId);
  return me
    ? { dealt: me.dealt, taken: me.taken, hits: me.hits, over: !s.battleActive }
    : null;
});
if (!board) {
  errors.push('[결과] 전적을 읽지 못했습니다');
} else if (!board.over) {
  console.log('  · 아직 전투 중이라 결과 화면은 건너뜁니다');
} else if (board.hits === 0 && board.taken === 0) {
  errors.push('[결과] 한 판을 다 치렀는데 전적이 비어 있습니다');
} else {
  console.log(
    `  ✓ 전적 집계 — 준 피해 ${Math.round(board.dealt)} · 맞은 피해 ${Math.round(board.taken)} · 적중 ${board.hits}`,
  );
}

/*
 * 조작감 세 가지 — 숏홉 · 차지 강공격 · 회피.
 *
 * 셋 다 "손에 어떻게 잡히는가"의 문제라 스크린샷으로는 확인할 수 없다.
 * 눌린 길이에 따라 결과가 달라져야 하는 것들이므로, 실제로 길이를 달리
 * 눌러 보고 나온 숫자를 비교한다.
 */
console.log('조작감');
{
  /* --- 숏홉 — 짧게 누르면 낮게 뛴다 ------------------------------ */

  /*
   * 정점 높이로 재려다 실패했다. 넷이 붙어 싸우는 판에서는 뛰는 도중
   * 맞아 날아가고, 헤드리스는 표본이 드물어 정점을 자주 놓친다.
   * 그래서 둘로 나눠 본다 — **규칙이 맞는가**와 **입력이 닿는가**.
   */
  await waitGrounded();

  const hop = await page.evaluate(() => {
    const p = window.game.scene.getScene('Battle').player;
    p.body.setVelocityY(0);
    p.jump();
    const full = p.body.velocity.y;
    p.releaseJump();
    return { full, cut: p.body.velocity.y };
  });

  if (!(hop.full < -300)) {
    errors.push(`[조작감] 점프가 나가지 않았습니다 (속도 ${hop.full})`);
  } else if (!(hop.cut > hop.full * 0.75)) {
    errors.push(
      `[조작감] 버튼을 떼도 상승이 잘리지 않습니다 (${Math.round(hop.full)} → ${Math.round(hop.cut)})`,
    );
  } else {
    console.log(
      `  ✓ 숏홉 — 떼는 순간 상승 ${Math.round(hop.full)} → ${Math.round(hop.cut)} ` +
        `(${Math.round((hop.cut / hop.full) * 100)}%)`,
    );
  }

  /* 입력이 실제로 닿는가 — 누른 동안과 뗀 동안의 상태가 갈리는지 */
  const heldState = async (down) => {
    if (down) await page.keyboard.down(' ');
    else await page.keyboard.up(' ');
    await page.waitForTimeout(400);
    return page.evaluate(
      () => window.game.scene.getScene('Battle').player.jumpHeld,
    );
  };

  const whileHeld = await heldState(true);
  const whileFree = await heldState(false);

  if (!whileHeld || whileFree) {
    errors.push(
      `[조작감] 점프 버튼 상태가 캐릭터에 전달되지 않습니다 (누름 ${whileHeld} / 뗌 ${whileFree})`,
    );
  } else {
    console.log('  ✓ 점프 버튼 상태 전달 — 누름 true / 뗌 false');
  }

  /* --- 차지 강공격 — 꾹 누르면 세진다 ---------------------------- */
  /*
   * 차지된 피해량은 beginAttack 시점에는 아직 정해지지 않았다 —
   * 선딜이 끝나는 순간에야 "얼마나 모았는지"가 확정되기 때문이다.
   * 그래서 발동 순간을 가로채는 대신, 확정된 값을 게임에게 물어본다.
   */
  const heavyDamage = async (holdMs) => {
    await waitGrounded();

    /*
     * 앞 시도의 기록을 지운다. 안 지우면 이번에 공격이 안 나갔을 때
     * 지난번 값이 그대로 읽혀 "차지가 안 된다"는 엉뚱한 결론이 난다.
     */
    await page.evaluate(() => {
      window.game.scene.getScene('Battle').player.lastMoveAt = -99999;
    });

    await page.keyboard.down('k');
    await page.waitForTimeout(holdMs);
    await page.keyboard.up('k');
    // 선딜이 끝나 판정이 켜질 때까지
    await page.waitForTimeout(700);

    return page.evaluate(() => {
      const p = window.game.scene.getScene('Battle').player;
      // 이번 시도에서 실제로 나간 것만 (오래된 기록은 null)
      const name = p.getRecentMoveName(2500);
      return { damage: name ? p.getRecentMoveDamage() : 0, name };
    });
  };

  /*
   * 맞아서 끊기거나 공중에서 눌리면 다른 기술이 나간다 —
   * 지상 중립 강공격이 실제로 나온 시도만 센다.
   */
  const groundHeavyName = await page.evaluate(
    () => window.game.scene.getScene('Battle').player.cfg.moves.heavy.name,
  );
  /*
   * 기준은 설정에 적힌 원래 피해량이다. "짧게 눌렀을 때"와 비교하면
   * 프레임이 드문 환경에서 짧은 누름조차 조금 모여 버려 기준이 흔들린다.
   */
  const baseDamage = await page.evaluate(
    () => window.game.scene.getScene('Battle').player.cfg.moves.heavy.damage,
  );

  let charged = null;
  for (let i = 0; i < 6 && !charged; i++) {
    const r = await heavyDamage(1200);
    if (r.name?.startsWith(groundHeavyName) && r.damage > baseDamage) charged = r;
  }

  if (!charged) {
    errors.push(
      `[조작감] 꾹 눌러도 강공격이 세지지 않습니다 (기본 ${baseDamage})`,
    );
  } else {
    console.log(
      `  ✓ 차지 강공격 — 기본 ${baseDamage} → ${charged.damage} ` +
        `(×${(charged.damage / baseDamage).toFixed(2)}) "${charged.name}"`,
    );
  }

  /* --- 회피 — 방어 중 좌우로 무적 구르기 ------------------------- */

  /*
   * 경직 중이면 못 구르는 것이 규칙이다(맞고도 빠져나가면 연속기가 성립하지
   * 않는다). 넷이 붙어 싸우는 판에서는 그 순간에 걸리는 일이 흔하므로
   * 몇 번 시도해 본다 — 한 번 실패했다고 기능이 죽은 것은 아니다.
   */
  /*
   * 무적(0.21초)은 회피 지속(0.3초)보다 짧다 — 아무 때나 굴러도 되는 것이
   * 아니라는 규칙이다. 그래서 구르는 것을 확인한 뒤 천천히 읽으면
   * 무적이 이미 끝나 있다. 누른 직후에 한 번에 읽어야 한다.
   */
  let rolled = { dodging: false, invuln: false };
  for (let i = 0; i < 6 && !(rolled.dodging && rolled.invuln); i++) {
    await waitGrounded();
    await page.keyboard.down('s');
    await page.waitForTimeout(160);
    await page.keyboard.press('d');

    // 페이지 안에서 촘촘히 들여다본다 — 왕복하며 재기에는 창이 너무 짧다
    rolled = await page.evaluate(async () => {
      const p = window.game.scene.getScene('Battle').player;
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      let dodging = false;
      let invuln = false;
      for (let i = 0; i < 22; i++) {
        if (p.isDodging()) {
          dodging = true;
          if (p.isInvulnerable()) invuln = true;
        } else if (dodging) break;
        await wait(20);
      }
      return { dodging, invuln };
    });
    await page.keyboard.up('s');
    if (!rolled.dodging) await page.waitForTimeout(700);
  }

  if (!rolled.dodging) {
    errors.push('[조작감] 방어 중 방향키로 구르기가 나가지 않았습니다');
  } else if (!rolled.invuln) {
    errors.push('[조작감] 구르는 중인데 무적이 아닙니다');
  } else {
    console.log('  ✓ 회피 — 방어 중 A/D 구르기 + 무적');
  }
  await shot('dodge');
}

/*
 * 잡기 — 공격 · 가드 · 잡기의 삼각형.
 *
 * 이건 판정이 아니라 **관계**를 확인하는 검사다. 잡기가 가드를 뚫지 못하면
 * 삼각형이 닫히지 않고, 그러면 웅크리고 버티는 것이 여전히 정답이 된다.
 *
 * 넷이 뒤엉켜 도망 다니는 판에서 키 입력만으로 잡기를 성립시키기는 어렵다.
 * 그래서 두 갈래로 나눈다 — **키가 닿는가**(U를 실제로 눌러 본다)와
 * **규칙이 맞는가**(상대를 앞에 세워 두고 관계를 확인한다).
 */
console.log('잡기');
{
  /* --- U 키가 잡기로 이어지는가 ---------------------------------- */
  let keyReached = false;
  for (let i = 0; i < 6 && !keyReached; i++) {
    await waitGrounded();
    await page.keyboard.press('u');
    await page.waitForTimeout(90);
    keyReached = await page.evaluate(() =>
      window.game.scene.getScene('Battle').player.isGrabActive(),
    );
    if (!keyReached) await page.waitForTimeout(700);
  }

  if (!keyReached) errors.push('[잡기] U를 눌러도 잡기 모션이 나가지 않습니다');
  else console.log('  ✓ U — 잡기 모션 발동');

  // 헛친 후딜이 끝나기를 기다린다
  await page.waitForTimeout(900);

  /*
   * 잡을 상대가 남아 있어야 한다.
   *
   * 여기까지 오는 동안 봇 셋이 전부 상장폐지됐을 수 있다. 그러면 잡기가
   * 고장난 것이 아니라 잡을 사람이 없는 것이므로, 판을 새로 열고 확인한다.
   */
  const hasFoe = async () =>
    page.evaluate(() => {
      const s = window.game.scene.getScene('Battle');
      return s.fighters.some((f) => f !== s.player && f.alive);
    });
  if (!(await hasFoe())) {
    await restartRound();
    await waitGrounded();
  }

  /*
   * 규칙 검사는 브라우저 안에서 한 번에 돌린다.
   * 붙잡는 데 성공하려면 상대가 판정 구간 내내 앞에 있어야 하는데,
   * 봇은 매 프레임 움직인다 — 바깥에서 왕복하며 붙잡아 두기에는 너무 느리다.
   */
  const grab = await page.evaluate(async () => {
    const s = window.game.scene.getScene('Battle');
    const p = s.player;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const foeOf = () => s.fighters.find((f) => f !== p && f.alive);

    let foe = foeOf();
    if (!foe) return { why: '살아 있는 상대가 없습니다' };

    /** 상대를 앞에 세워 두고 잡힐 때까지 기다린다 */
    const holdStill = async (frames) => {
      for (let i = 0; i < frames && !p.isGrabbing(); i++) {
        // 잡으려던 상대가 격추되면 다른 상대로 갈아탄다
        if (!foe?.alive) foe = foeOf();
        if (!foe) return;
        foe.setPosition(p.x + p.facing * 44, p.y);
        foe.body.setVelocity(0, 0);
        // 가드를 세워 둔다 — 잡기가 뚫어야 하는 것이 바로 이 상태다
        foe.setGuard(true);
        if (foe.isGuarding()) guardedFoe = true;
        await wait(25);
      }
    };

    let guardedFoe = false;

    /**
     * 한 번 잡아서 붙잡기까지.
     *
     * 붙지 않으면 null. 넷이 뒤엉킨 판이라 자주 실패한다 —
     * 실패는 기능이 죽었다는 뜻이 아니라 그냥 이번엔 안 붙은 것이다.
     */
    const grabOnce = async () => {
      p.facing = 1;
      p.grab();
      await holdStill(16);
      return p.isGrabbing() ? p.getGrabbed() : null;
    };

    /*
     * 잡기 → 툭툭 → 던지기를 한 호흡에 확인한다.
     *
     * 도중에 다른 봇이 끼어들어 때리면 잡기가 풀린다 — 그것이 규칙이므로
     * 실패가 아니라 **다시 해야 할 시도**다. 끼어들었으면 처음부터 다시 잡는다.
     */
    let combo = null;
    for (let t = 0; t < 10 && !combo; t++) {
      const victim = await grabOnce();
      if (!victim) continue;

      const before = s.stock.get(victim.fighterId);

      /* 잡은 채 툭툭 치기 — 넉백 없이 피해만 (잡기가 풀리면 안 된다) */
      p.pummelReadyAt = 0;
      p.pummel();
      await wait(40);
      // 여기서 풀렸으면 바깥에서 끼어든 것이다
      if (!p.isGrabbing()) continue;

      const afterPummel = s.stock.get(victim.fighterId);

      /* 위로 던지기 — 높이 떠야 쫓아 올라가 이어칠 수 있다 */
      p.throwGrabbed('up');
      await wait(100);

      combo = {
        pummel: { before, after: afterPummel },
        thrown: {
          vy: victim.body.velocity.y,
          released: !p.isGrabbing() && !victim.isGrabbed(),
        },
      };
    }
    if (!combo) return { why: '잡기가 붙지 않았습니다', guardedFoe };

    /* 두드려서 빠져나가기 */
    await wait(900);
    let escaped = false;
    for (let t = 0; t < 8 && !escaped; t++) {
      const held = await grabOnce();
      if (!held) continue;

      for (let i = 0; i < 12 && p.isGrabbing(); i++) {
        held.struggle();
        await wait(70);
      }
      escaped = !p.isGrabbing();
    }

    return { guardedFoe, ...combo, escaped };
  });

  if (grab.why) {
    errors.push(`[잡기] ${grab.why}`);
  } else {
    if (!grab.guardedFoe) {
      // 확인하지 못했을 뿐이므로 실패로는 치지 않는다
      console.log('  · 가드 상태를 세워 두지 못해 "가드를 뚫는다"는 확인 못 함');
    } else {
      console.log('  ✓ 잡기가 가드를 뚫는다 — 막고 선 상대를 그대로 잡았다');
    }

    if (grab.pummel.after >= grab.pummel.before) {
      errors.push('[잡기] 잡기 공격에 피해가 없습니다');
    } else {
      console.log(
        `  ✓ 잡기 공격 — 주가 ${grab.pummel.before} → ${grab.pummel.after}, 잡은 채 유지`,
      );
    }

    if (!grab.thrown.released) {
      errors.push('[잡기] 던졌는데 잡기가 풀리지 않았습니다');
    } else if (grab.thrown.vy > -300) {
      errors.push(
        `[잡기] 위로 던졌는데 뜨지 않습니다 (수직 속도 ${Math.round(grab.thrown.vy)})`,
      );
    } else {
      console.log(
        `  ✓ 위로 던지기 — 수직 속도 ${Math.round(grab.thrown.vy)} 로 띄운다`,
      );
    }

    if (!grab.escaped) errors.push('[잡기] 두드려도 빠져나가지 못합니다');
    else console.log('  ✓ 몸부림 — 연타로 잡기 탈출');
  }
  await shot('grab');

  /* --- 공중 히트 → 점프 반환 (공중 연속기의 근거) ----------------- */
  const airCombo = await page.evaluate(async () => {
    const s = window.game.scene.getScene('Battle');
    const p = s.player;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    for (let t = 0; t < 6; t++) {
      const foe = s.fighters.find((f) => f !== p && f.alive);
      if (!foe) return { why: '살아 있는 상대가 없습니다' };

      /* 둘 다 공중에 띄우고, 점프를 다 쓴 상태로 만든다 */
      p.setPosition(640, 210);
      p.body.setVelocity(0, -40);
      foe.setPosition(640 + 44, 210);
      foe.body.setVelocity(0, -40);
      p.facing = 1;
      p.jumpsLeft = 0;
      p.hitTargets.clear();
      p.attack('light', 'neutral');

      for (let i = 0; i < 24; i++) {
        await wait(25);
        const grounded = p.body.blocked.down || p.body.touching.down;
        // 착지하면 어차피 점프가 복구되므로 그 표본은 버린다
        if (grounded) break;
        if (p.jumpsLeft > 0) return { refunded: true };
      }
    }
    return { refunded: false };
  });

  if (airCombo.why) errors.push(`[공중 연속기] ${airCombo.why}`);
  else if (!airCombo.refunded) {
    errors.push('[공중 연속기] 공중에서 맞혀도 점프가 돌아오지 않습니다');
  } else {
    console.log('  ✓ 공중 히트 — 점프를 한 번 돌려받는다 (띄우고 쫓아간다)');
  }
}

/*
 * 연승 도전.
 *
 * 이긴 뒤 SPACE 로 다음 상대가 나오는 경로다. 여기가 끊기면 스무 명과
 * 무대 넷을 만들어 놓고도 한 판에 다섯 명과 한 곳밖에 못 보게 된다.
 * 실제로 이길 때까지 기다릴 수는 없으므로(수 분이 걸린다) 상대를 직접
 * 지워 승리 상태를 만든 뒤, 이어지는 판의 조건이 실제로 달라지는지 본다.
 */
console.log('연승 도전');
{
  await restartRound();
  await waitGrounded();

  const before = await page.evaluate(() => {
    const s = window.game.scene.getScene('Battle');
    return {
      ai: s.fighters.filter((f) => f.side === 'ai').map((f) => f.cfg.id),
      stage: s.getStageInfo().id,
      label: s.difficulty.label,
      interval: s.difficulty.decisionInterval,
    };
  });

  // 봇 셋을 상장폐지시켜 승리로 끝낸다
  await page.evaluate(() => {
    const s = window.game.scene.getScene('Battle');
    for (const f of s.fighters.filter((x) => x.side === 'ai' && x.alive)) {
      s.stock.add(f.fighterId, -999, null);
    }
  });
  await waitUntil((st) => !st.active, '승리 대기', 20000, true);
  await page.waitForTimeout(1400);
  await shot('streak-win');

  await page.keyboard.press('Space');
  await page.waitForFunction(
    () => window.game?.scene?.getScene('Battle')?.getStageInfo?.() && window.game.scene.getScene('Battle').streak === 1,
    null,
    { timeout: 10000 },
  ).catch(() => {});

  const after = await page.evaluate(() => {
    const s = window.game.scene.getScene('Battle');
    return {
      streak: s.streak,
      ai: s.fighters.filter((f) => f.side === 'ai').map((f) => f.cfg.id),
      stage: s.getStageInfo().id,
      label: s.difficulty.label,
      interval: s.difficulty.decisionInterval,
      playerStock: s.stock.get(s.player.fighterId),
    };
  });

  if (after.streak !== 1) {
    errors.push(`[연승] SPACE 로 다음 판이 시작되지 않았습니다 (연승 ${after.streak})`);
  } else {
    if (after.interval >= before.interval) {
      errors.push(
        `[연승] 봇이 빨라지지 않았습니다 (판단 주기 ${before.interval} → ${after.interval})`,
      );
    }
    if (after.stage === before.stage) {
      errors.push(`[연승] 무대가 그대로입니다 (${after.stage})`);
    }
    // 앞 판의 주가를 이어받되 하한이 있다
    if (after.playerStock < 70 || after.playerStock > 150) {
      errors.push(`[연승] 이어받은 주가가 범위 밖입니다 (${after.playerStock}%)`);
    }
    console.log(
      `  ✓ 승리 → SPACE → 2번째 판 (봇 판단 ${before.interval}→${after.interval}ms · ` +
        `무대 ${before.stage}→${after.stage} · 주가 ${after.playerStock}%)`,
    );
  }
  await shot('streak-next');
}

/*
 * 무대 네 곳.
 *
 * 발판 배치는 스크린샷으로 보이지만 중력은 안 보인다. 그리고 무대를 늘리면
 * 늘어난 만큼 "그 무대에서만 터지는" 자리가 생긴다 — 발판이 여섯 개인 곳,
 * 중력이 다른 곳. 네 곳을 실제로 한 번씩 세워 보고 콘솔이 조용한지 본다.
 */
console.log('무대');
{
  /** 무대 → [이조(반음), 템포 배율] — stages.ts 와 맞춰 둔다 */
  const TONES = {
    exchange: [0, 1],
    rooftop: [3, 1.05],
    server: [-2, 1.09],
    moon: [-5, 0.88],
  };

  const WANT = [
    ['exchange', 5, 2200],
    ['rooftop', 3, 2200],
    ['server', 6, 2200],
    ['moon', 5, 1364],
  ];

  for (const [id, platforms, gravity] of WANT) {
    await page.evaluate((stageId) => {
      const g = window.game;
      const sc = g.scene.getScene('Battle');
      const prev = sc.scene.settings.data ?? {};
      g.scene.stop('Battle');
      g.scene.start('Battle', { ...prev, stageId });
    }, id);

    // 씬 재생성 + 페이드인
    await page.waitForFunction(
      (want) => window.game?.scene?.getScene('Battle')?.getStageInfo?.()?.id === want,
      id,
      { timeout: 8000 },
    ).catch(() => {});

    const info = await page.evaluate(
      () => window.game?.scene?.getScene('Battle')?.getStageInfo?.() ?? null,
    );

    if (!info) {
      errors.push(`[무대] ${id} 정보를 읽지 못했습니다`);
      continue;
    }
    if (info.id !== id) {
      errors.push(`[무대] ${id} 로 바뀌지 않았습니다 (${info.id})`);
      continue;
    }
    if (info.platforms !== platforms) {
      errors.push(`[무대] ${info.name}: 발판이 ${platforms}개여야 하는데 ${info.platforms}개`);
    }
    if (Math.abs(info.gravity - gravity) > 2) {
      errors.push(`[무대] ${info.name}: 중력이 ${gravity} 여야 하는데 ${info.gravity}`);
    }

    /*
     * 무대마다 곡이 달라지는가.
     *
     * 조와 템포는 눈으로 확인할 방법이 없다. 배선이 빠져도 화면은 멀쩡하고
     * 소리는 스크린샷에 안 남으므로, 상태값으로만 잡을 수 있다.
     */
    const tone = await page.evaluate(() => window.sound?.bgmDebug ?? null);
    const wantTone = TONES[id];
    if (!tone) {
      errors.push(`[무대] ${id} 곡 상태를 읽지 못했습니다`);
    } else if (tone.transpose !== wantTone[0] || Math.abs(tone.bpmMul - wantTone[1]) > 0.001) {
      errors.push(
        `[무대] ${info.name}: 곡이 ${wantTone[0]}반음 · 템포 ${wantTone[1]}배여야 하는데 ` +
          `${tone.transpose}반음 · ${tone.bpmMul}배`,
      );
    }

    await page.waitForTimeout(500);
    await shot(`stage-${id}`);
    console.log(
      `  ✓ ${info.name} — 발판 ${info.platforms}개 · 중력 ${Math.round(info.gravity)} · ` +
        `곡 ${tone?.transpose ?? '?'}반음 ${tone?.bpmMul ?? '?'}배`,
    );
  }
}
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
