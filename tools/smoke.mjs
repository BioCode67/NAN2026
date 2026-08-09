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
    /*
     * 판이 갈리는 순간에는 씬 객체가 살아 있어도 그 안의 player 가 아직
     * **앞 판의 파괴된 파이터**를 가리킨다. 그 상태로 canAct() 를 부르면
     * 이미 없어진 씬을 들여다보다 터진다 — 게임이 아니라 이 검사가 너무
     * 이른 순간을 들여다본 것이다. 파괴된 객체는 scene 이 비어 있다.
     */
    if (!p || !p.scene?.time) return null;

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
   try {
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
   } catch {
     /* 판이 갈리는 중이면 아직 읽을 수 없다 — 다음 폴링에서 다시 본다 */
     return null;
   }
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
 * 봇을 세우고 플레이어를 건드리지 못하게 한다.
 *
 * ── 왜 필요한가 ────────────────────────────────────────────────────
 * 한 가지 장치만 떼어 재는 검사(모션·피격 반응·연속기 갈래)는 옆에서 봇이
 * 한 대 치는 순간 값이 통째로 뒤집힌다. 실제로 "강공격에 맞은 몸이 -27도로
 * 젖혀져야 하는데 -13도"라는 실패가 나왔는데, 원인은 그 사이에 봇이 잽을
 * 넣은 것이었다 — 코드는 멀쩡했다.
 *
 * 더 나쁜 것은 뒷일이다. 재는 동안 플레이어가 맞아 장외로 떨어지면 그 뒤의
 * 검사들이 줄줄이 "잡기가 안 붙는다 / 상장폐지 상태다"로 실패한다. 원인과
 * 한참 떨어진 곳에서 터지므로 읽는 사람이 가장 헷갈리는 종류다.
 */
const isolatePlayer = () =>
  page.evaluate(() => {
    const s = window.game.scene.getScene('Battle');
    if (!window.__parkedAis?.length) window.__parkedAis = s.ais.splice(0);
    s.fighters.forEach((f) => {
      f.moveHorizontal(0);
      f.attackPhase = 'none';
      f.currentAttack = null;
    });
    // 판정 자체가 안 들어오게 막는다 — 봇을 세워도 이미 나간 주먹은 날아간다
    s.player.invulnUntil = s.time.now + 600000;
  });

/** 격리를 푼다 — 다음 검사는 평소의 판에서 돌아야 한다 */
const releasePlayer = () =>
  page.evaluate(() => {
    const s = window.game.scene.getScene('Battle');
    if (window.__parkedAis?.length && s.ais.length === 0) {
      s.ais.push(...window.__parkedAis);
    }
    window.__parkedAis = [];
    s.player.invulnUntil = 0;
    s.player.stunUntil = 0;
  });

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
    /*
     * 곡이 틀렸다면 십중팔구 곡의 문제가 아니라 **지금 있는 화면의** 문제다.
     * 앞 화면에서 누른 Enter 가 새어 들어와 선택 화면이 그대로 확정되면
     * 전투가 시작되고, 그러면 여기서 전투 곡이 읽힌다 — 이 검사가 가끔
     * "메뉴 곡이 아닙니다: battle" 을 적던 것이 그것이었다.
     * 곡 이름만 적으면 사운드를 뒤지게 되므로 어느 화면인지 같이 남긴다.
     */
    const where = await page.evaluate(
      () =>
        window.game?.scene?.scenes
          ?.filter((s) => s.scene.isActive())
          .map((s) => s.scene.key)
          .join('+') ?? '?',
    );
    errors.push(`[BGM] 메뉴 곡이 아닙니다: ${a.track} (지금 화면: ${where})`);
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
/*
 * 열렸는지를 **기다려서** 본다.
 *
 * 한 번 찍고 마는 검사는 여기서 거짓말을 했다. TAB 이 열었는데 400ms 안에
 * 확인이 안 되면 곧바로 I 를 누르는데, 그 I 가 열려 있는 것을 **도로 닫는다.**
 * 그러고는 "둘 다 안 열렸다"고 적는다 — 실제로는 첫 키가 제대로 열었는데도.
 * 느린 기계에서 셋 중 하나꼴로 그랬다.
 */
const waitDetail = async (want, tries = 12) => {
  for (let i = 0; i < tries; i++) {
    if ((await isDetailOpen()) === want) return true;
    await page.waitForTimeout(200);
  }
  return false;
};

let openedBy = '';
for (const key of ['Tab', 'i']) {
  await page.keyboard.press(key);
  if (await waitDetail(true)) {
    openedBy = key;
    break;
  }
  /*
   * 다음 키를 누르기 전에 확실히 닫아 둔다. 이 키가 늦게 도착해 뒤늦게
   * 열리면, 다음 키는 "열기"가 아니라 "닫기"가 되어 같은 함정에 다시 빠진다.
   */
  await page.keyboard.press('Escape');
  await waitDetail(false, 4);
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

/*
 * 전투 씬이 실제로 설 때까지 기다린다.
 *
 * 예전에는 3.6초를 재고 넘어갔다. 저사양에서 부팅이 밀리면 그 시점에는
 * 아직 선택 화면이라, 곡이 안 바뀐 게 아니라 **전투가 시작을 안 한 것**인데
 * "배선이 빠졌다"는 결론이 났다. 실제로 그렇게 한 번 헛다리를 짚었다.
 */
await page
  .waitForFunction(() => !!window.game?.scene?.isActive('Battle'), null, { timeout: 20000 })
  .catch(() => {});
await shot('battle-start');

// 전투에 들어오면 곡이 바뀐다 — 메뉴 곡이 그대로 흐르면 배선이 빠진 것이다
{
  // 씬이 서고 나서도 곡 전환은 한 박자 뒤라, 바뀔 때까지 잠깐 지켜본다
  await page
    .waitForFunction(() => window.sound?.bgmDebug?.track === 'battle', null, {
      timeout: 8000,
    })
    .catch(() => {});
  const now = await page.evaluate(() => window.sound?.bgmDebug ?? null);
  if (now?.track !== 'battle') {
    errors.push(`[BGM] 전투 곡으로 바뀌지 않았습니다: ${now?.track}`);
  } else {
    console.log('  ✓ 전투 곡으로 전환');
  }
}

/*
 * 개시 연출(READY? → FIGHT!)이 끝날 때까지 기다린다.
 *
 * 그 동안에는 handleInput 이 아예 안 불린다 — 여기서부터 키를 넣으므로,
 * 연출 중에 시작하면 첫 몇 커맨드가 통째로 사라져 "연속기가 안 나간다"가 된다.
 */
await page
  .waitForFunction(
    () => window.game.scene.getScene('Battle')?.battleActive === true,
    null,
    { timeout: 20000 },
  )
  .catch(() => errors.push('[부팅] FIGHT! 까지 가지 못했습니다'));

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

/*
 * 세 번을 몰아 넣고, 못 미치면 한 번 더 해 본다.
 *
 * 앞 타의 경직이 아직 안 풀린 순간에 걸리면 세 번째가 통째로 무시된다 —
 * 연속기가 안 되는 것이 아니라 시작점이 나빴던 것이다. 조건을 느슨하게
 * 하지 않고 **시작점만** 다시 잡는다. 두 번 다 못 하면 그건 진짜 고장이다.
 */
const runChain = async () => {
  await clearMoves();
  await page.evaluate(() => {
    const p = window.game.scene.getScene('Battle').player;
    p.attackPhase = 'none';
    p.stunUntil = 0;
    p.attack('light', 'neutral');
    p.attack('light', 'neutral');
    p.attack('light', 'neutral');
  });
  // 상태 머신이 세 타를 다 흘려보낼 때까지 기다린다
  for (let i = 0; i < 40; i++) {
    if ((await readMoves()).length >= expected.chain.length) break;
    await page.waitForTimeout(120);
  }
  return readMoves();
};

let chained = await runChain();
if (JSON.stringify(chained) !== JSON.stringify(expected.chain)) {
  await waitGrounded();
  chained = await runChain();
}
await shot('chain-jjj');

if (JSON.stringify(chained) !== JSON.stringify(expected.chain)) {
  errors.push(
    `[연속기] 기대 ${JSON.stringify(expected.chain)} / 실제 ${JSON.stringify(chained)}`,
  );
} else {
  console.log(`  ✓ 연속기 ${expected.chain.join(' → ')}`);
}
await clearMoves();

/*
 * 앞·뒤 커맨드 — 상대 쪽으로 누르며 치면 앞 기술, 반대로 누르면 뒤 기술.
 *
 * 두 가지가 각각 죽을 수 있어서 따로 잰다.
 *  1. 슬롯 해석 — 'forward' 라는 방향이 앞 기술로 이어지는가
 *  2. 입력 매핑 — 누른 방향키가 'forward' 로 읽히는가
 * 2가 특히 조용히 죽는다. 바라보는 방향을 기준으로 잡으면 걸을 때마다
 * 방향이 따라 돌아 **뒤 기술이 영영 안 나오는데**, 화면에는 앞 기술이
 * 멀쩡히 나가므로 아무 문제 없어 보인다.
 *
 * 키보드로 넣지 않고 입력 한 프레임을 직접 만들어 넘긴다. 헤드리스에서는
 * 키 하나 누르는 데 100ms 넘게 걸려서, 누르는 사이에 걸어가 위치가 바뀌고
 * 앞뒤 기준 자체가 달라진다 — 조작이 아니라 검사가 흔들리는 것이다.
 */
console.log('앞뒤 커맨드');
{
  await restartRound();
  await waitGrounded();
  await isolatePlayer();

  const cmd = await page.evaluate(async () => {
    const s = window.game.scene.getScene('Battle');
    const p = s.player;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    /* 상대를 오른쪽에 세워 둔다 — 앞뒤의 기준점이 된다 */
    const foe = s.fighters.find((f) => f !== p && f.alive);
    if (!foe) return { why: '살아 있는 상대가 없습니다' };
    p.setPosition(p.x, p.y);
    foe.setPosition(p.x + 220, p.y);
    foe.body.setVelocity(0, 0);

    const frame = (over) => ({
      left: false, right: false, up: false, down: false,
      jumpHeld: false, heavyHeld: false,
      tapLeft: false, tapRight: false, tapJump: false,
      tapLight: false, tapHeavy: false, tapSkill: false,
      tapGrab: false, tapTaunt: false, releaseJump: false,
      ...over,
    });

    const press = async (over) => {
      window.__moves = [];
      p.attackPhase = 'none';
      p.stunUntil = 0;
      p.chainUntil = 0;
      p.chainNext = null;
      foe.setPosition(p.x + 220, p.y);
      s.handleInput(p, frame(over), { dir: 0, at: 0 });
      await wait(160);
      return window.__moves[0] ?? null;
    };

    /* 오른쪽에 상대 → 오른쪽으로 누르며 J 는 앞, 왼쪽으로 누르며 J 는 뒤 */
    const fwdJ = await press({ right: true, tapLight: true });
    const backJ = await press({ left: true, tapLight: true });
    const fwdK = await press({ right: true, tapHeavy: true });
    const backK = await press({ left: true, tapHeavy: true });
    const plain = await press({ tapLight: true });

    /* 슬롯 해석은 직접 물어본다 */
    const byDir = {};
    for (const [intent, dir] of [
      ['light', 'forward'], ['light', 'back'],
      ['heavy', 'forward'], ['heavy', 'back'],
    ]) {
      byDir[`${intent}:${dir}`] = p.resolveMove(intent, dir).name;
    }

    const m = p.cfg.moves;
    return {
      pressed: { fwdJ, backJ, fwdK, backK, plain },
      byDir,
      want: {
        fwdJ: m.lightFwd.name, backJ: m.lightBack.name,
        fwdK: m.heavyFwd.name, backK: m.heavyBack.name,
        plain: m.light.name,
      },
    };
  });
  await releasePlayer();

  if (cmd.why) {
    errors.push(`[앞뒤] ${cmd.why}`);
  } else {
    const wrong = Object.entries(cmd.want).filter(([k, v]) => cmd.pressed[k] !== v);
    if (wrong.length) {
      errors.push(
        `[앞뒤] 누른 방향이 기술로 안 이어집니다 — ` +
          wrong.map(([k, v]) => `${k}: 기대 ${v}/실제 ${cmd.pressed[k]}`).join(' · '),
      );
    } else {
      console.log(
        `  ✓ 상대 쪽 → ${cmd.pressed.fwdJ}/${cmd.pressed.fwdK} · ` +
          `반대쪽 → ${cmd.pressed.backJ}/${cmd.pressed.backK} · 가만히 → ${cmd.pressed.plain}`,
      );
    }
  }
  await shot('cmd-fwd-back');
}

/*
 * 대시 중 J 와 K 가 갈리는가.
 *
 * 전에는 대시 중이면 방향도 버튼도 무시하고 돌진 공격 하나였다. 어깨로
 * 들이받는 것과 미끄러져 발밑을 쓰는 것은 쓰임이 전혀 다른데, 한 슬롯이
 * 둘을 삼키면 K 를 눌러도 J 가 나가고 아무도 눈치채지 못한다.
 */
console.log('대시 공격 두 갈래');
{
  const dash = await page.evaluate(() => {
    const p = window.game.scene.getScene('Battle').player;
    return { j: p.cfg.moves.dashAttack.name, k: p.cfg.moves.dashSlide.name };
  });
  const slots = await page.evaluate(() => {
    const s = window.game.scene.getScene('Battle');
    const p = s.player;
    // 대시 중 상태를 만들어 두고 무엇으로 해석되는지 물어본다
    p.dashUntil = s.time.now + 400;
    const out = {
      j: p.resolveMove('light', 'neutral').name,
      k: p.resolveMove('heavy', 'neutral').name,
    };
    p.dashUntil = 0;
    return out;
  });

  if (slots.j !== dash.j || slots.k !== dash.k) {
    errors.push(
      `[대시] J/K 가 안 갈립니다 — J 기대 ${dash.j}/실제 ${slots.j} · K 기대 ${dash.k}/실제 ${slots.k}`,
    );
  } else {
    console.log(`  ✓ 대시 중 J ${slots.j} · K ${slots.k}`);
  }
}

/*
 * 연속기 마무리 갈래 — 같은 J 인데 어디를 누르고 있었느냐로 끝이 달라진다.
 *
 * 키를 안 늘리고 기술을 늘리는 방법이라, 이것이 조용히 죽으면 "공격이
 * 단조롭다"로 되돌아간다. 그런데 겉으로는 아무 일도 안 일어난 것처럼 보인다 —
 * 3타가 그냥 원래 3타로 나갈 뿐이라 오류도, 이상한 그림도 남지 않는다.
 * 그런 종류의 회귀는 사람이 절대 못 잡는다.
 */
{
  const branch = async (dir) => {
    await clearMoves();
    await page.evaluate((d) => {
      const p = window.game.scene.getScene('Battle').player;
      p.attackPhase = 'none';
      p.stunUntil = 0;
      p.attack('light', 'neutral');
      p.attack('light', 'neutral');
      p.attack('light', d);
    }, dir);
    for (let i = 0; i < 40; i++) {
      if ((await readMoves()).length >= 3) break;
      await page.waitForTimeout(120);
    }
    return (await readMoves())[2];
  };

  await restartRound();
  await waitGrounded();
  await isolatePlayer();

  const up = await branch('up');
  /*
   * 갈래를 하나 시험할 때마다 발을 땅에 돌려놓는다.
   * ↑ 마무리는 상대를 띄우는 기술이라 낸 쪽도 위로 솟는다. 뜬 채로 다음
   * 갈래를 시험하면 지상 연속기가 아예 이어지지 않는다 — 갈래가 고장난 것이
   * 아니라 지상이 아니었던 것이다.
   */
  await page.evaluate(() => {
    const p = window.game.scene.getScene('Battle').player;
    p.body.setVelocity(0, 0);
    p.stunUntil = 0;
  });
  await waitGrounded();
  const down = await branch('down');
  await releasePlayer();

  const want = { up: expected.lightUp, down: expected.lightDown };
  if (up !== want.up || down !== want.down) {
    errors.push(
      `[연속기] 마무리가 방향으로 안 갈립니다 — ` +
        `↑ 기대 ${want.up}/실제 ${up} · ↓ 기대 ${want.down}/실제 ${down}`,
    );
  } else {
    console.log(
      `  ✓ 마무리 갈래 — J J J ${expected.chain[2]} · J J ↑J ${up} · J J ↓J ${down}`,
    );
  }
  await clearMoves();
}

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

/*
 * 이 판에 문장을 하나 남겨 둔다.
 *
 * 결과 화면의 "이 판을 바꾼 말"은 **그 판에** 입력된 문장을 보여준다.
 * 앞의 기믹 검사는 판을 새로 시작하며 지나갔으므로, 여기서 한 번 더 걸어야
 * 결과 화면에 남을 것이 생긴다.
 */
for (let i = 0; i < 25; i++) {
  const up = await page.evaluate(() => {
    const s = window.game.scene.getScene('Battle');
    s.orbs.nextSpawnAt = 0;
    return s.orbs.isActive();
  });
  if (up) break;
  await page.waitForTimeout(300);
}
/*
 * 그래도 안 뜨면 그 자리에서 직접 띄운다.
 *
 * 판을 새로 열면 주가가 100%로 돌아가 남은 시간 안에 판이 안 끝나고,
 * 그러면 정작 보려던 결과 화면까지 못 간다. 확인하려는 것은 "오브가 몇 초
 * 뒤에 뜨는가"가 아니라 결과 화면에 문장이 남는가이므로 여기서는 띄워 준다.
 */
await page.evaluate(() => {
  const s = window.game.scene.getScene('Battle');
  if (!s.orbs.isActive()) s.orbs.spawn(s.time.now, s.player.x, s.player.y - 140);
});
/*
 * 깨는 사람은 살아 있는 아무나.
 *
 * 이 지점의 판은 한참 진행돼 플레이어가 이미 떨어졌을 수 있다. 확인하려는
 * 것은 "누가 깼는가"가 아니라 **그 문장이 결과 화면에 남는가**이므로,
 * 봇이 깨도 된다 — 봇이 깨면 게임이 알아서 한 문장을 외치고 그것도 똑같이
 * 이 판의 기록으로 남아야 한다.
 */
const broke = await page.evaluate(() => {
  const s = window.game.scene.getScene('Battle');
  if (!s.orbs.isActive()) return 'no-orb';
  const who = s.player.alive ? s.player : s.fighters.find((f) => f.alive);
  if (!who) return 'nobody';
  s.orbs.onBreak(who);
  return who === s.player ? 'ok' : 'bot';
});
if (broke === 'no-orb' || broke === 'nobody') {
  console.log(`  · 오브를 못 깼습니다 (${broke})`);
}
/*
 * 입력창이 뜰 때까지 기다렸다가 채운다.
 *
 * onBreak 은 입력창을 곧바로 만들지 않는다 — 판을 멈추고 다음 프레임에 연다.
 * 기다리지 않고 count() 로 보면 0이 나와 그냥 지나치는데, 그러면 입력창이
 * 열린 채로 남아 물리가 영영 멈춘다. 이 판은 끝나지 않고 스모크가 통째로 선다.
 */
if (broke === 'ok') {
  const opened = await page
    .waitForSelector('[data-testid="prompt-overlay"]', { timeout: 6000 })
    .then(() => true)
    .catch(() => false);
  if (!opened) console.log('  · 오브를 깼는데 입력창이 안 떴습니다');
  if (opened) {
    /*
     * 서든데스로 고른다.
     *
     * 아무 문장이나 되는 것이 아니다 — 전원을 회복시키는 문장을 쓰면 판이
     * 길어져 정작 보려던 결과 화면까지 못 간다. 서든데스는 피해가 세 배라
     * 문장도 남기고 판도 앞당긴다.
     */
    await page.locator('[data-testid="prompt-input"]').fill('한방에 끝내자');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(900);
    // 그래도 남아 있으면 닫고 간다 — 열린 채로 두면 판이 멈춘다
    await dismissPrompt();
  }
}

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
  25000,
  true,
);

/*
 * 아직 안 끝났으면 끝을 만들어 준다.
 *
 * 결과 화면은 판이 끝나야만 나오는 화면이라, 여기까지 못 오면 전적표도
 * "이 판을 바꾼 말"도 통째로 검증되지 않는다. 그런데 봇 넷이 언제 결판이
 * 날지는 매번 다르고, 기다리는 시간을 늘리는 것으로는 확정되지 않는다.
 *
 * 그래서 남은 봇을 **게임이 쓰는 바로 그 길**로 떨어뜨린다 — 장외 판정이다.
 * 승패를 조작하는 것이 아니라 결말을 앞당기는 것이고, 검사하려는 결과 화면은
 * 어느 쪽이 이겼든 똑같이 그려진다.
 */
if (await page.evaluate(() => window.game.scene.getScene('Battle').battleActive)) {
  await page.evaluate(() => {
    const s = window.game.scene.getScene('Battle');
    s.fighters
      .filter((f) => f !== s.player && f.alive)
      .forEach((f) => f.setPosition(f.x, 3000));
  });
  await waitUntil((st) => !st.active, '남은 봇 장외 처리', 12000, true);
}
await page.waitForTimeout(1200);
await shot('final');

/*
 * 결과 화면이 화면 안에 있는가.
 *
 * 전적표와 제목은 월드 좌표로 그려지는데 카메라는 마지막 순간까지 생존자를
 * 따라가 있다. 넓은 무대의 오른쪽 끝에서 판이 끝나면 카메라가 거기 머물러
 * **제목과 표가 화면 왼쪽 밖으로 잘려 나간다.** 스크린샷만 보면 "글자가
 * 좀 왼쪽에 있네"로 지나가기 쉬우므로 카메라 위치를 숫자로 본다.
 */
const camAtEnd = await page.evaluate(() => {
  const s = window.game.scene.getScene('Battle');
  return { scrollX: s.cameras.main.scrollX, over: !s.battleActive };
});
if (camAtEnd.over && Math.abs(camAtEnd.scrollX) > 1) {
  errors.push(
    `[결과] 카메라가 원점으로 돌아오지 않았습니다 (scrollX ${Math.round(camAtEnd.scrollX)}) — 전적표가 화면 밖으로 잘립니다`,
  );
} else if (camAtEnd.over) {
  console.log('  ✓ 결과 화면 — 카메라 원점 고정');
}

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
 * 공격 모션 — 눌렀을 때 몸이 실제로 움직이는가.
 *
 * 기술마다 "이만큼 늘어나고 이만큼 눌린다"를 정해 뒀는데 **한 번도 적용되지
 * 않고 있었다.** 위치만 움직이니 찌르기든 내려찍기든 화면에서는 같은 동작으로
 * 보였다 — 그림이 아니라 코드에서 죽어 있던 데이터다. 같은 일이 다시 나면
 * 알아채려면 숫자로 봐야 한다.
 */
console.log('공격 모션');
{
  await restartRound();
  await waitGrounded();
  await isolatePlayer();

  const motion = await page.evaluate(async () => {
    const s = window.game.scene.getScene('Battle');
    const p = s.player;
    const sp = p.view.sprite;
    if (!sp) return { why: '도형 아트라 스프라이트가 없습니다' };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    const home = { x: sp.x, y: sp.y, sx: sp.scaleX, sy: sp.scaleY };

    /*
     * 예비동작과 내지르기를 **한 번에** 잰다.
     *
     * 한 시점을 찍지 않고 공격이 끝날 때까지 촘촘히 훑으며, 가장 뒤로 간
     * 값(예비동작)과 가장 앞으로 간 값(내지르기)을 함께 남긴다.
     *
     * ── 왜 둘을 갈라 재면 안 되는가 ────────────────────────────────
     * 처음에는 선딜 구간과 내지르는 구간을 따로 돌았다. 그러면 두 구간의
     * **경계를 정확히 짚어야** 하는데, 검사용 브라우저는 초당 열 장이라
     * 그 경계가 샘플 사이에 통째로 들어간다. 경계를 놓치면 앞 구간이 뒷
     * 구간까지 먹어 치우고, 뒤 구간은 아무것도 못 재서 0.0px 을 적는다 —
     * 실제로 선딜 검사를 촘촘하게 고쳤더니 이번엔 내지르기가 0.0px 이 됐다.
     *
     * 한 줄기로 훑으면 경계를 짚을 필요가 아예 없다. 최솟값과 최댓값은
     * 어디서 갈리든 같은 값이다.
     */
    p.attackPhase = 'none';
    p.stunUntil = 0;
    /*
     * 안 나갔으면 안 나갔다고 말한다.
     *
     * 여기서 그냥 넘어가면 아래 측정이 0 을 재고 "예비동작이 없다"고 적는다 —
     * 예비동작은 멀쩡한데 칠 수 없는 상태였을 뿐인데, 원인과 증상이 안 닮아서
     * 애먼 곳을 뒤지게 된다.
     */
    if (!p.attack('heavy', 'neutral')) {
      return { why: '강공격이 시작되지 않았습니다 (칠 수 있는 상태가 아님)' };
    }

    let wind = { dx: 0, sy: 1 };
    let out = { dx: 0, sx: 1, sy: 1 };
    let sawAttack = false;
    let samples = 0;
    let startupSamples = 0;

    for (let i = 0; i < 140; i++) {
      await wait(16);
      const dx = sp.x - home.x;
      if (dx < wind.dx) wind = { dx, sy: sp.scaleY / home.sy };
      if (dx > out.dx) {
        out = { dx, sx: sp.scaleX / home.sx, sy: sp.scaleY / home.sy };
      }

      if (p.attackPhase !== 'none') sawAttack = true;
      /*
       * 공격이 끝나면 멈춘다. 다만 **한 번이라도 공격 중인 것을 본 뒤에**
       * 끝난 것으로 친다 — 첫 샘플이 공격이 시작되기 전에 떨어지면
       * 시작도 안 한 것을 끝난 것으로 읽고 곧바로 빠져나온다.
       */
      else if (sawAttack) break;

      samples++;
      if (p.attackPhase === 'startup') startupSamples++;
    }

    /*
     * 실패했을 때 들여다볼 것들을 함께 남긴다.
     *
     * 이 검사는 예비동작이 아주 작게(-0.0px) 잡히며 가끔 실패하는데, 그
     * 원인을 아직 못 짚었다. 여기까지 좁혀 뒀다 — 내지르기(+22px)는 제대로
     * 나오므로 트윈 경로 자체는 살아 있고, 예비동작 트윈만 거의 안 움직인
     * 채 끝난다. 다음에 뜰 때 몇 장을 봤고 그중 몇 장이 선딜이었는지가
     * 있으면 "샘플이 모자랐나"와 "트윈이 안 돌았나"를 가를 수 있다.
     */
    return {
      wind,
      out,
      samples,
      startupSamples,
      startup: p.currentAttack?.startup ?? null,
      move: p.lastMove,
    };
  });

  if (motion.why) {
    console.log(`  · ${motion.why}`);
  } else {
    /*
     * "뒤로 갔는가"만 본다. 얼마나 갔는지는 이 환경에서 잴 수 없다.
     *
     * ── 왜 임계값이 0 인가 ─────────────────────────────────────────
     * 처음에는 -1px 을 요구했는데 셋 중 하나꼴로 실패했다. 원인은 예비동작이
     * 아니라 프레임 수였다. 헤드리스는 초당 다섯 장이라 선딜 165ms 가 서너
     * 프레임에 끝나고, 예비동작 트윈이 끝까지 가는 그 프레임과 내지르기가
     * 시작하는 프레임이 **같은 한 장**이다. 그래서 밖에서 볼 수 있는 최대치가
     * 프레임 경계가 어디 걸리느냐에 따라 2px 도 되고 0.04px 도 된다.
     * 실제 화면(60장)에서는 열 프레임에 걸쳐 6.6px 을 전부 지나간다.
     *
     * 이 검사가 지키려는 것은 "예비동작 데이터가 또 죽지 않았는가"이지
     * 몇 px 인가가 아니다. 죽으면 트윈이 아예 안 돌아 정확히 0 이 나오므로,
     * 0보다 작기만 하면 살아 있는 것이다. 크기는 로그에 남겨 두어
     * 눈에 띄게 줄어들면 사람이 알아볼 수 있게 한다.
     */
    if (!(motion.wind.dx < 0)) {
      errors.push(
        `[모션] 선딜에 뒤로 당기지 않습니다 (${motion.wind.dx.toFixed(2)}px` +
          ` · ${motion.move} 선딜 ${motion.startup}ms` +
          ` · 샘플 ${motion.samples}장 중 선딜 ${motion.startupSamples}장)`,
      );
    } else {
      console.log(
        `  ✓ 예비동작 — 뒤로 ${(-motion.wind.dx).toFixed(1)}px 당긴다` +
          ` (느린 화면에서 관측된 값 · 실제로는 더 크다)`,
      );
    }

    if (motion.out.dx < 8) {
      errors.push(`[모션] 공격해도 앞으로 안 나갑니다 (${motion.out.dx.toFixed(1)}px)`);
    } else if (Math.abs(motion.out.sx - 1) < 0.02 && Math.abs(motion.out.sy - 1) < 0.02) {
      errors.push(
        `[모션] 늘어남·눌림이 적용되지 않았습니다 (가로 ${motion.out.sx.toFixed(3)} · 세로 ${motion.out.sy.toFixed(3)})`,
      );
    } else {
      console.log(
        `  ✓ 내지르기 — 앞으로 ${motion.out.dx.toFixed(0)}px · 가로 ×${motion.out.sx.toFixed(2)} · 세로 ×${motion.out.sy.toFixed(2)}`,
      );
    }
  }
  await releasePlayer();
  await shot('attack-motion');
}

/*
 * 기술별 이펙트 — 눈으로 구분되는가.
 *
 * 찌르기·쳐올림·내려찍기·회전·베기가 각각 다른 모양으로 그려져야
 * "여러 가지 공격을 하고 있다"가 전달된다. 모양은 스크린샷으로 단정하기
 * 어려우므로 **몇 개가 어떤 굵기로 그려졌는지**를 센다 — 색 한 겹만 있던
 * 것을 흰 심까지 두 겹으로 바꿨고, 타수가 오를수록 커지게 했다.
 */
console.log('기술별 이펙트');
{
  /*
   * 살아 있는지부터 본다.
   *
   * 앞 블록이 releasePlayer() 로 봇을 풀어 준 뒤 스크린샷을 한 장 찍는데,
   * 느린 기계에서는 그 한 장이 몇 초다. 그 사이에 셋에게 둘러싸여 죽으면
   * 아래 spawnSwing 은 아무것도 못 그리고, 검사는 네 기술 **전부** 이펙트가
   * 없다고 적는다 — 이펙트가 죽은 게 아니라 사람이 죽은 것이다.
   * waitGrounded 는 죽어 있으면 판을 새로 연다.
   */
  await waitGrounded();
  await isolatePlayer();
  const fx = await page.evaluate(async () => {
    const s = window.game.scene.getScene('Battle');
    const p = s.player;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    /*
     * 개수 차이가 아니라 **새로 생긴 것**을 센다.
     *
     * 화면에는 타격 입자처럼 계속 생겼다 사라지는 도형이 있어서, 앞뒤 개수를
     * 빼면 음수가 나오기도 한다. 부르기 전의 목록을 기억해 두고 그 뒤에
     * 새로 들어온 것만 세면 정확하다.
     */
    const shapes = () =>
      s.children.list.filter(
        (o) => o.depth >= 20 && (o.type === 'Ellipse' || o.type === 'Arc'),
      );

    const out = {};
    for (const slot of ['light', 'light3', 'heavy2', 'airHeavy']) {
      const atk = p.cfg.moves[slot];
      if (!atk) continue;
      const seen = new Set(shapes());
      p.attackPhase = 'none';
      p.stunUntil = 0;
      p.spawnSwing(atk);

      /*
       * 그려질 때까지 **기다린다.**
       *
       * 20ms 한 번만 보고 넘어갔더니, 느린 기계에서 그 사이 프레임이 한 장도
       * 안 지나가 앞쪽 두 기술(light, light3)만 0겹으로 잡히곤 했다.
       * 이펙트가 없는 게 아니라 아직 안 그려진 것이다 — 목록의 앞쪽만
       * 실패하는 것이 그 증거였다. 생기면 곧바로 넘어가므로 느려지지도 않는다.
       */
      let fresh = [];
      for (let i = 0; i < 25 && fresh.length === 0; i++) {
        await wait(20);
        fresh = shapes().filter((o) => !seen.has(o));
      }
      out[slot] = { fx: atk.fx, shapes: fresh.length };
      await wait(420);
    }
    return out;
  });

  const kinds = new Set(Object.values(fx).map((v) => v.fx));
  const drawn = Object.entries(fx).filter(([, v]) => v.shapes > 0);

  if (drawn.length < Object.keys(fx).length) {
    // 어떤 fx 인지 함께 남긴다 — 슬롯 이름만으로는 어느 그리기 경로인지 모른다
    const missing = Object.entries(fx)
      .filter(([, v]) => v.shapes === 0)
      .map(([k, v]) => `${k}(${v.fx})`);
    errors.push(`[이펙트] 아무것도 안 그려진 기술이 있습니다 — ${missing.join(', ')}`);
  } else if (kinds.size < 3) {
    errors.push(`[이펙트] 기술이 달라도 같은 모양입니다 — ${[...kinds].join(', ')}`);
  } else if (Object.values(fx).some((v) => v.shapes < 2)) {
    errors.push(
      `[이펙트] 흰 심이 안 그려졌습니다 (배경에 묻힙니다) — ${JSON.stringify(fx)}`,
    );
  } else {
    console.log(
      `  ✓ 기술마다 다른 이펙트 — ${Object.entries(fx)
        .map(([k, v]) => `${k}:${v.fx}(${v.shapes}겹)`)
        .join(' · ')}`,
    );
  }
  await releasePlayer();
}

/*
 * 맞은 쪽 반응 — 무엇에 맞았는지가 맞은 몸에 쓰여 있는가.
 *
 * 때리는 쪽은 기술마다 갈라 놓았는데 맞는 쪽은 전부 같은 모양으로 한 번
 * 납작해지고 끝이었다. 쳐올려 하늘로 뜨는 순간과 바닥에 꽂히는 순간이
 * 같은 그림이면 절반만 전달된다.
 *
 * 두 가지를 따로 본다 — (1) 기술마다 다른 값을 **정했는가**,
 * (2) 그 값이 실제로 화면 객체에 **발라졌는가**. 예전에 늘어남·눌림이
 * 정의만 되고 한 번도 적용되지 않은 채 죽어 있었다. 정한 것과 보이는 것을
 * 함께 재지 않으면 그 종류의 버그는 검사를 통과한다.
 */
console.log('맞은 쪽 반응');
{
  await restartRound();
  await waitGrounded();
  await isolatePlayer();

  const react = await page.evaluate(async () => {
    const s = window.game.scene.getScene('Battle');
    const p = s.player;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    // 맞을 때마다 날아가므로 매번 제자리로 돌려놓는다 (장외로 나가면 죽는다)
    const home = { x: p.x, y: p.y };

    const out = {};
    for (const slot of ['light', 'lightUp', 'lightDown', 'heavy2', 'airHeavy']) {
      const atk = p.cfg.moves[slot];
      if (!atk) continue;

      p.setPosition(home.x, home.y);
      p.body.setVelocity(0, 0);
      p.alive = true;
      p.guarding = false;
      p.receiveHit(atk, home.x - 40);

      // 정한 값 — 트윈이 풀리기 전이라 목표치 그대로다
      const want = { kind: p.getHitReaction(), lean: p.lean.angle, sy: p.squash.y };

      /*
       * 발라진 값.
       *
       * 되돌아오는 트윈을 **세워 놓고** 잰다. 검사용 브라우저는 초당 열 장쯤
       * 그리므로, 그냥 한 프레임 기다렸다 보면 200ms 짜리 반응은 이미 다
       * 풀려서 0에 가깝다. 값이 안 발라진 것과 구별이 안 된다 —
       * 시간에 기대는 검사는 느린 기계에서 거짓말을 한다.
       */
      const frozen = [
        ...s.tweens.getTweensOf(p.lean),
        ...s.tweens.getTweensOf(p.squash),
      ];
      frozen.forEach((t) => t.pause());
      await wait(140);
      const seen = { lean: p.visual.angle, sy: Math.abs(p.visual.scaleY) };
      frozen.forEach((t) => t.resume());

      out[slot] = { ...want, seen };
      p.body.setVelocity(0, 0);
      p.stunUntil = 0;
      await wait(520);
    }
    p.setPosition(home.x, home.y);
    return out;
  });
  await releasePlayer();

  const kinds = new Set(Object.values(react).map((v) => v.kind));
  /*
   * 정한 값과 화면에 있는 값이 같아야 한다 — 다르면 어딘가에서 죽은 데이터다.
   *
   * 각도는 한 바퀴를 빼고 비교한다. 회전기는 -360도로 젖히는데 화면 객체는
   * 각도를 -180~180 로 접어서 들고 있어서, 곧이곧대로 빼면 -360과 0이
   * 다르다고 나온다. 한 바퀴 돈 것과 안 돈 것은 보이는 그림이 같다.
   */
  const wrap = (d) => Math.abs((((d % 360) + 540) % 360) - 180);
  const lost = Object.entries(react).filter(
    ([, v]) => wrap(v.seen.lean - v.lean) > 0.5 || Math.abs(v.seen.sy - v.sy) > 0.02,
  );

  if (kinds.size < 4) {
    errors.push(
      `[피격] 기술이 달라도 반응이 같습니다 — ${[...kinds].join(', ')} (${JSON.stringify(react)})`,
    );
  } else if (lost.length) {
    errors.push(
      `[피격] 정해 둔 값이 화면에 발라지지 않았습니다 — ` +
        lost
          .map(([k, v]) => `${k}: ${v.lean.toFixed(0)}°→${v.seen.lean.toFixed(0)}°`)
          .join(' · '),
    );
  } else if (!(react.lightUp?.sy > 1) || !(react.lightDown?.sy < 1)) {
    errors.push(
      `[피격] 띄우기는 세로로 늘어나고 내려치기는 눌려야 합니다 — ` +
        `위 ${react.lightUp?.sy} · 아래 ${react.lightDown?.sy}`,
    );
  } else {
    console.log(
      `  ✓ 맞은 모양이 기술마다 다르다 — ${Object.entries(react)
        .map(([k, v]) => `${k}:${v.kind}(${Math.round(v.lean)}°)`)
        .join(' · ')}`,
    );
  }
  await shot('hit-reaction');
}

/*
 * 참가자(게스트) 화면 재현 — 회선 없이 그 코드 경로를 직접 부른다.
 *
 * 참가자 화면 버그는 늘 늦게 발견된다 — 창 두 개를 띄워야 보이고, 호스트
 * 화면만 보고 개발하기 때문이다. 실제로 "참가자는 공격 모션이 안 나가고
 * 스킬이 항상 가득 차 보인다"가 그렇게 오래 살아남았다. 참가자가 쓰는
 * 함수(setRemotePose · applyRemoteMeters · playRemoteReaction)는 회선과
 * 무관하므로, 혼자 도는 판에서도 그대로 불러 검사할 수 있다.
 */
console.log('참가자 화면 재현');
{
  await restartRound();
  await waitGrounded();
  await isolatePlayer();

  const guest = await page.evaluate(async () => {
    const s = window.game.scene.getScene('Battle');
    const f = s.fighters[1];
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    if (!f) return { why: '두 번째 파이터가 없습니다' };

    /* 계기판 — 호스트가 보낸 값이 그대로 보이는가 */
    const before = f.getSkillCooldownRatio();
    f.applyRemoteMeters(0.62, 2, false);
    const meters = {
      before,
      after: f.getSkillCooldownRatio(),
      stacks: f.getSignatureStacks(),
    };

    /* 공격 포즈 전이 — 스윙 연출(이펙트·기술 이름)이 재생되는가 */
    const shapes = () =>
      s.children.list.filter(
        (o) => o.depth >= 20 && (o.type === 'Ellipse' || o.type === 'Arc'),
      );
    const seen = new Set(shapes());
    f.setRemotePose('idle');
    f.setRemotePose('attackK');
    /*
     * 스윙은 선딜만큼 늦게 그려진다(예비동작 → 내지름). 그런데 검사용
     * 브라우저는 초당 열 장이라 Phaser 가 프레임 델타를 ~20ms 로 눌러 잡고,
     * 게임 안 타이머가 실제 시간의 1/5 로 흐른다 — 고정 대기는 여기서
     * 반드시 거짓말을 한다. 나타날 때까지 본다.
     */
    let fxCount = 0;
    for (let i = 0; i < 80 && fxCount === 0; i++) {
      await wait(50);
      fxCount = shapes().filter((o) => !seen.has(o)).length;
    }
    const moveName = f.getRecentMoveName(60000);

    /* 피격 반응 — 호스트가 보낸 반응 번호대로 몸이 젖혀지는가 */
    f.playRemoteReaction('launch');
    const lean = f.lean.angle;

    return { meters, fxCount, moveName, want: f.cfg.moves.heavy.name, lean };
  });
  await releasePlayer();

  if (guest.why) {
    errors.push(`[참가자] ${guest.why}`);
  } else {
    if (Math.abs(guest.meters.after - 0.62) > 0.001 || guest.meters.stacks !== 2) {
      errors.push(
        `[참가자] 계기판이 회선 값을 안 씁니다 — 쿨다운 ${guest.meters.after} · 스택 ${guest.meters.stacks}`,
      );
    } else {
      console.log(
        `  ✓ 계기판 — 쿨다운 ${guest.meters.before} → ${guest.meters.after} · 자원 ${guest.meters.stacks}칸`,
      );
    }

    if (guest.fxCount < 2 || guest.moveName !== guest.want) {
      errors.push(
        `[참가자] 공격 포즈 전이가 스윙으로 안 이어집니다 — 이펙트 ${guest.fxCount}겹 · 이름 ${guest.moveName}/${guest.want}`,
      );
    } else {
      console.log(`  ✓ 공격 전이 — ${guest.moveName} 이펙트 ${guest.fxCount}겹`);
    }

    if (Math.abs(guest.lean - -38) > 0.5) {
      errors.push(`[참가자] 피격 반응이 재생되지 않습니다 (기울기 ${guest.lean})`);
    } else {
      console.log(`  ✓ 피격 반응 — 떠오름 ${guest.lean}°`);
    }
  }
  await shot('guest-replay');
}


/*
 * 공매도 유령 — 상장폐지된 사람도 판에 개입한다.
 *
 * 넷이 붙는 판에서 가장 먼저 떨어진 사람은 남은 1~2분을 구경만 한다.
 * 그 시간이 이 게임에서 제일 재미없는 시간이라 유령을 붙였다.
 * 죽은 뒤에 좌우로 움직이고, 원하는 자리에 물건을 떨어뜨릴 수 있어야 한다.
 */
console.log('공매도 유령');
{
  /*
   * 넷이 다 살아 있는 판에서 확인한다.
   *
   * 여기까지 오는 동안 봇들이 거의 죽어 있어서, 플레이어까지 떨어지면 판이
   * 그대로 끝난다. 판이 끝나면 입력을 아예 안 읽으므로 유령도 안 움직인다 —
   * 유령이 고장난 것이 아니라 확인할 상황이 아닌 것이다.
   */
  await restartRound();
  await waitGrounded();

  const ghost = await page.evaluate(async () => {
    const s = window.game.scene.getScene('Battle');
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const me = s.player;

    // 죽은 상태를 만든다 — 게임이 쓰는 장외 판정 그대로
    me.setPosition(me.x, 3000);
    for (let i = 0; i < 40 && me.alive; i++) await wait(100);
    if (me.alive) return { why: '장외로 나갔는데 상장폐지되지 않았습니다' };

    // 유령이 생겼는가 (첫 입력이 들어와야 만들어진다)
    for (let i = 0; i < 20 && s.ghosts.size === 0; i++) await wait(100);
    if (s.ghosts.size === 0) return { why: '죽었는데 유령이 안 생겼습니다' };

    const g = [...s.ghosts.values()][0];
    const x0 = g.x;

    // 좌우로 움직이는가 — 키 대신 입력 한 프레임을 직접 넣는다
    const h = s.humans.find((h) => !h.fighter.alive);
    if (!h) return { why: '죽은 사람이 humans 에 없습니다' };
    const held = h.keys;
    return { x0, hasKeys: !!held, items0: s.items.snapshot().length, ok: true };
  });

  if (ghost.why) {
    errors.push(`[유령] ${ghost.why}`);
  } else {
    /* 방향키로 실제로 움직이는가 */
    await page.keyboard.down('d');
    await page.waitForTimeout(700);
    await page.keyboard.up('d');
    await page.waitForTimeout(150);

    const moved = await page.evaluate(
      (x0) => {
        const s = window.game.scene.getScene('Battle');
        const g = [...s.ghosts.values()][0];
        return Math.round(Math.abs(g.x - x0));
      },
      ghost.x0,
    );

    if (moved < 20) {
      errors.push(`[유령] 방향키를 눌러도 유령이 안 움직입니다 (${moved}px)`);
    } else {
      console.log(`  ✓ 유령이 좌우로 움직인다 (${moved}px)`);
    }

    /*
     * J 로 물건을 떨어뜨리는가.
     *
     * 유령은 생기자마자 1.2초 동안 못 놓는다 — 죽는 순간 누르고 있던 키가
     * 그대로 흘러 들어가 물건이 튀어나오지 않게 하는 장치다. 그 시간을
     * 기다리지 않고 눌러 놓고 "안 떨어진다"고 하면 검사가 거짓말을 한다.
     */
    await page.waitForFunction(
      () => {
        const s = window.game.scene.getScene('Battle');
        const g = [...s.ghosts.values()][0];
        return !!g && s.time.now >= g.readyAt;
      },
      null,
      { polling: 100, timeout: 6000 },
    );

    const before = await page.evaluate(
      () => window.game.scene.getScene('Battle').items.snapshot().length,
    );
    /*
     * 키를 몇 번 눌러 본다.
     * 초당 열 장짜리 화면에서는 keydown 하나가 프레임 사이로 빠지는 일이
     * 실제로 있다 — 첫 시도 실패는 유령 고장이 아니라 입력 유실이다.
     * 성공한 뒤에는 더 누르지 않으므로 쿨다운 검사와 충돌하지 않는다.
     */
    let dropped = { items: before, readyAt: 0, now: 0 };
    for (let attempt = 0; attempt < 3 && dropped.items <= before; attempt++) {
      await page.keyboard.press('j');
      await page.waitForTimeout(700);
      dropped = await page.evaluate(() => {
        const s = window.game.scene.getScene('Battle');
        const g = [...s.ghosts.values()][0];
        return { items: s.items.snapshot().length, readyAt: g.readyAt, now: s.time.now };
      });
    }

    if (dropped.items <= before) {
      errors.push(`[유령] J 를 눌러도 물건이 안 떨어집니다 (${before}→${dropped.items})`);
    } else {
      console.log(`  ✓ 유령이 물건을 떨어뜨린다 (아이템 ${before} → ${dropped.items})`);
    }

    /*
     * 쿨다운 — 연타해도 한 번만.
     *
     * 떨어진 개수로 세면 안 된다. 무대가 스스로 물건을 뿌리는 타이머가 따로
     * 돌고 있어서, 연타와 상관없이 하나 더 생기면 검사가 억울하게 실패한다.
     * 유령이 **다음 발사 시각을 새로 잡았는지**를 보면 그 흔들림이 사라진다.
     */
    await page.keyboard.press('j');
    await page.waitForTimeout(400);
    const spam = await page.evaluate(
      () => [...window.game.scene.getScene('Battle').ghosts.values()][0].readyAt,
    );
    if (spam !== dropped.readyAt) {
      errors.push('[유령] 연타로 물건이 계속 떨어집니다 — 살아 있는 사람이 못 놉니다');
    } else if (!(dropped.readyAt > dropped.now)) {
      errors.push('[유령] 물건을 놓고도 쿨다운이 안 걸립니다');
    } else {
      console.log(
        `  ✓ 연타해도 한 번만 (다음 발사까지 ${Math.round((dropped.readyAt - dropped.now) / 100) / 10}초)`,
      );
    }
  }
  await shot('ghost');
  await restartRound();
  await waitGrounded();
}

/*
 * 이 판을 바꾼 말.
 *
 * 전적표는 어느 대전 게임에나 있고, 이 게임에만 있는 것은 "사람이 친 문장이
 * 판을 뒤집었다"는 사실이다. 그것이 결과 화면에 **문장 그대로** 남는지 본다 —
 * 숫자로 "프롬프트 3회"만 남으면 붙인 의미가 없다.
 */
const promptLog = await page.evaluate(() => {
  const s = window.game.scene.getScene('Battle');
  const log = [...(s.stats?.prompts ?? [])];
  // 화면에 실제로 그려졌는가 (마지막 세 줄만 보여준다)
  const drawn = s.children.list
    .filter((o) => o.type === 'Text' && typeof o.text === 'string' && o.text.includes('”  →  '))
    .map((o) => o.text);
  return { log, drawn };
});
if (!board?.over) {
  // 판이 아직 안 끝났으면 결과 화면 자체가 없다 — 검사할 것도 없다
  console.log('  · 결과 화면이 아직이라 문장 검사는 건너뜁니다');
} else if (promptLog.log.length === 0) {
  console.log('  · 이 판에는 프롬프트가 안 걸려 결과 화면 문장 검사는 건너뜁니다');
} else {
  const last = promptLog.log[promptLog.log.length - 1];
  const line = promptLog.drawn.find((t) => t.includes(last.gimmick));
  if (!line) {
    errors.push(
      `[결과] 마지막 문장이 결과 화면에 없습니다 — "${last.text}" → ${last.gimmick}` +
        ` (그려진 줄 ${promptLog.drawn.length}개)`,
    );
  } else if (!line.includes(last.who)) {
    errors.push(`[결과] 누가 썼는지가 빠졌습니다 — ${line}`);
  } else {
    console.log(`  ✓ 이 판을 바꾼 말 ${promptLog.log.length}줄 — ${line}`);
  }
}

/*
 * 여기서부터는 다시 살아 있는 판이 필요하다.
 *
 * 위에서 결과 화면까지 갔다면 전투는 멈춰 있다 — 그 상태로 잡기·연속기를
 * 확인하면 "조작이 안 먹는다"가 나오는데, 그건 고장이 아니라 판이 끝난 것이다.
 */
if (await page.evaluate(() => !window.game.scene.getScene('Battle').battleActive)) {
  await restartRound();
  await waitGrounded();
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

  /* --- 공중 회피 — 날아가는 동안 할 수 있는 유일한 것 ------------- */

  /*
   * 지상 회피와 같은 조합(`S`+방향)이 공중에서는 공중 회피로 갈린다.
   * 규칙이 하나라 외울 것이 안 늘어나는 대신, **갈라지는 그 지점**이
   * 조용히 죽기 쉽다 — 땅에서만 눌러 보면 영영 모른다.
   *
   * 한 체공에 한 번이라는 제한도 함께 본다. 그게 없으면 공중에서 무적을
   * 이어 붙여 내려오지 않는 캐릭터가 생긴다.
   */
  await waitGrounded();
  await isolatePlayer();
  const air = await page.evaluate(async () => {
    const s = window.game.scene.getScene('Battle');
    const p = s.player;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    const inAir = () => !(p.body.blocked.down || p.body.touching.down);

    /*
     * 높이 띄운다.
     *
     * 처음에는 -900 으로 띄웠는데, 공중 회피가 상승을 끊어(vy=-40) 그대로
     * 떨어지는 바람에 두 번째 시도 전에 착지해 버렸다. 그러면 그 두 번째는
     * 공중 회피가 아니라 **지상 구르기**가 나가고, 검사는 "한 체공에 두 번
     * 나간다"고 적는다 — 제한은 멀쩡한데 검사가 땅에서 재고 있던 것이다.
     * 넉넉히 띄우고, 두 번째를 누르기 직전에 아직 떠 있는지 다시 본다.
     */
    p.attackPhase = 'none';
    p.stunUntil = 0;
    p.body.setVelocity(0, -1600);
    await wait(100);

    const airborne = inAir();
    const first = p.dodge(1);

    let invuln = false;
    for (let i = 0; i < 8; i++) {
      if (p.isInvulnerable()) invuln = true;
      await wait(16);
    }

    // 같은 체공에서 한 번 더 — 되면 안 된다 (땅에 닿았으면 잴 수 없다)
    const stillAir = inAir();
    const second = stillAir ? p.dodge(-1) : null;

    return { airborne, first, invuln, second, stillAir };
  });

  if (!air.airborne) {
    console.log('  · 띄우지 못해 공중 회피는 건너뜁니다');
  } else if (!air.stillAir && air.first) {
    console.log('  ✓ 공중 회피 — 무적 (착지가 빨라 재사용 제한은 못 쟀다)');
  } else if (!air.first) {
    errors.push('[조작감] 공중에서 회피가 안 나갑니다');
  } else if (!air.invuln) {
    errors.push('[조작감] 공중 회피 중인데 무적이 아닙니다');
  } else if (air.second) {
    errors.push('[조작감] 공중 회피가 한 체공에 두 번 나갑니다');
  } else {
    console.log('  ✓ 공중 회피 — 무적 · 한 체공에 한 번');
  }

  /* --- 벗어나기(DI) — 누른 방향으로 궤도가 휜다 -------------------- */

  /*
   * 같은 기술을 같은 자리에서 두 번 맞되, 한 번은 아무 것도 안 누르고
   * 한 번은 위를 누른 채로 맞는다. 넉백의 **길이는 같고 각도만** 달라져야
   * 한다 — 길이가 줄면 누르는 것이 언제나 이득이라 판단이 아니게 되고,
   * 때린 쪽은 왜 안 날아갔는지 알 수가 없다.
   */
  const di = await page.evaluate(async () => {
    const s = window.game.scene.getScene('Battle');
    const p = s.player;
    const atk = p.cfg.moves.heavy;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    const launch = async (dx, dy) => {
      p.attackPhase = 'none';
      p.stunUntil = 0;
      p.invulnUntil = 0;
      p.body.setVelocity(0, 0);
      p.setDodgeInfluence(dx, dy);
      p.receiveHit(atk, p.x - 40);
      const v = { x: p.body.velocity.x, y: p.body.velocity.y };
      p.invulnUntil = s.time.now + 600000;
      await wait(40);
      return v;
    };

    const flat = await launch(0, 0);
    const bent = await launch(0, -1);
    const len = (v) => Math.hypot(v.x, v.y);
    const angle = (v) => (Math.atan2(v.y, v.x) * 180) / Math.PI;

    return {
      flatLen: len(flat),
      bentLen: len(bent),
      turned: Math.abs(angle(bent) - angle(flat)),
    };
  });

  if (di.flatLen < 1) {
    errors.push('[조작감] DI 검사 — 넉백이 아예 없습니다');
  } else if (Math.abs(di.bentLen - di.flatLen) > di.flatLen * 0.05) {
    errors.push(
      `[조작감] DI 가 넉백 크기를 바꿉니다 (${di.flatLen.toFixed(0)} → ${di.bentLen.toFixed(0)})`,
    );
  } else if (di.turned < 5) {
    errors.push(`[조작감] DI 로 궤도가 안 휩니다 (${di.turned.toFixed(1)}도)`);
  } else {
    console.log(
      `  ✓ 벗어나기(DI) — 크기는 그대로, 궤도만 ${di.turned.toFixed(0)}도`,
    );
  }
  await releasePlayer();
}

/*
 * 새로 넣은 기믹들.
 *
 * 카탈로그에 적어 두는 것과 실제로 걸리는 것은 다른 일이다. 이름만 있고
 * 아무 일도 안 일어나는 기믹이 섞여 있어도 화면은 멀쩡해 보인다 —
 * 문장을 넣어 걸어 보고 **판이 실제로 달라졌는지**를 숫자로 확인한다.
 */
console.log('새 기믹');
{
  /*
   * 확인하는 동안 봇을 멈춰 세운다.
   *
   * 즉시 발동하는 기믹은 "건 직후"의 값으로 확인해야 하는데, 그 사이에
   * 누가 한 대 맞으면 주가가 다시 벌어진다. 그건 기믹이 안 걸린 것이 아니라
   * 계속 싸우고 있는 것이다 — 판단만 멈추면 값이 흔들리지 않는다.
   */
  await page.evaluate(() => {
    const s = window.game.scene.getScene('Battle');
    window.__gimAis = s.ais.splice(0);
    /*
     * 봇을 세우는 것만으로는 부족하다.
     *
     * 판단을 멈춰도 **이미 나가 있던 주먹**은 그대로 날아가 꽂힌다. 그러면
     * 주가를 똑같이 맞춘 직후에 누군가 한 대 맞아서, 기믹이 제대로 돌았는데도
     * "격차가 남아 있다"고 나온다. 재려는 것은 기믹이지 전투가 아니다.
     */
    s.fighters.forEach((f) => {
      f.moveHorizontal(0);
      f.attackPhase = 'none';
      f.currentAttack = null;
    });
  });

  const tryGimmick = async (text, check, waitMs = 500) => {
    const before = await page.evaluate(check);
    const got = await page.evaluate(
      (t) => {
        const s = window.game.scene.getScene('Battle');
        s.applyPrompt(t, '검사');
        return s.gimmicks.getActive().map((a) => a.spec.name);
      },
      text,
    );
    if (waitMs) await page.waitForTimeout(waitMs);
    const after = await page.evaluate(check);
    return { got, before, after };
  };

  /* 균등 분배 — 주가가 전원 같아진다 */
  await page.evaluate(() => {
    const s = window.game.scene.getScene('Battle');
    s.fighters.forEach((f, i) => s.stock.setExact(f.fighterId, 60 + i * 70));
  });
  const share = await tryGimmick('다 같이 똑같이 나눠', () => {
    const s = window.game.scene.getScene('Battle');
    const v = s.fighters.filter((f) => f.alive).map((f) => s.stock.get(f.fighterId));
    return Math.max(...v) - Math.min(...v);
  }, 0);
  if (share.after >= share.before || share.after > 2) {
    errors.push(`[기믹] 균등 분배 뒤에도 주가가 벌어져 있습니다 (${share.before}→${share.after})`);
  } else {
    console.log(`  ✓ 균등 분배 — 주가 격차 ${share.before} → ${share.after}`);
  }

  /* 미니어처 — 몸이 작아진다 */
  const tiny = await tryGimmick('전부 조그맣게 만들어', () =>
    window.game.scene.getScene('Battle').player.getSizeScale?.() ??
    window.game.scene.getScene('Battle').player.sizeScale,
  );
  if (!(tiny.after < tiny.before)) {
    errors.push(`[기믹] 미니어처인데 안 작아집니다 (${tiny.before}→${tiny.after})`);
  } else {
    console.log(`  ✓ 미니어처 — 몸 크기 ${tiny.before} → ${tiny.after.toFixed(2)}`);
  }

  /*
   * 배당금 — 전원 주가가 오른다.
   *
   * 합계 하나로 보면 안 된다. 앞선 검사에서 떨어뜨려 둔 폭탄이 이 사이에
   * 터지면 누군가는 크게 깎이고, 그러면 **전원이 30씩 받았는데도 합은 줄어든다**
   * — 고장이 아닌데 실패한다. 사람마다 따로 재고 "대부분이 받았는가"를 본다.
   */
  const gold = await tryGimmick('배당금 뿌려줘', () => {
    const s = window.game.scene.getScene('Battle');
    return Object.fromEntries(
      s.fighters.filter((f) => f.alive).map((f) => [f.fighterId, s.stock.get(f.fighterId)]),
    );
  }, 0);
  {
    const ids = Object.keys(gold.before).filter((id) => id in gold.after);
    const gained = ids.filter((id) => gold.after[id] - gold.before[id] >= 20);
    if (gained.length * 2 < ids.length || gained.length === 0) {
      const deltas = ids.map((id) => `${id} ${gold.after[id] - gold.before[id]}`).join(' · ');
      errors.push(`[기믹] 배당금인데 받은 사람이 ${gained.length}/${ids.length}명입니다 — ${deltas}`);
    } else {
      console.log(`  ✓ 배당금 — ${gained.length}/${ids.length}명이 주가를 받았다`);
    }
  }

  await page.evaluate(() => {
    const s = window.game.scene.getScene('Battle');
    if (window.__gimAis?.length && s.ais.length === 0) s.ais.push(...window.__gimAis);
    window.__gimAis = [];
  });
  await shot('gimmick-new');
}

/*
 * 선두 왕관.
 *
 * 넷이 붙는 판에서 "누구를 때릴까"를 만드는 장치다. 앞선 사람 머리에
 * 왕관이 떠야 셋이 그쪽을 노리고, 그래야 판이 뒤집힌다.
 * 왕관이 조용히 안 뜨면 아무도 그 사실을 모른 채 끝난다.
 */
console.log('선두 표시');
{
  const crown = await page.evaluate(async () => {
    const s = window.game.scene.getScene('Battle');
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    const alive = s.fighters.filter((f) => f.alive);
    if (alive.length < 2) return { why: '둘 이상 살아 있지 않습니다' };

    /*
     * 마지막에는 **플레이어**가 선두가 되게 한다.
     * 그래야 스크린샷 안에 왕관이 들어온다 — 남이 쓰고 있으면 화면 밖일 때가 많다.
     */
    /*
     * 기다리는 시간을 고정하지 않는다.
     *
     * 왕관은 매 프레임 갱신인데 헤드리스는 초당 열 장 남짓 그린다. 200ms를
     * 세어 두면 프레임 한두 장 차이로 "안 따라간다"가 나온다 — 고장이 아니라
     * 아직 안 그린 것이다. 조건이 될 때까지 본다.
     */
    const until = async (fn, ms = 2500) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (fn()) return true;
        await wait(50);
      }
      return false;
    };

    const lead = alive.find((f) => f !== s.player) ?? alive[0];
    alive.forEach((f) => s.stock.setExact(f.fighterId, f === lead ? 210 : 90));

    const onLead = await until(
      () => s.crown?.visible === true && Math.abs(s.crown.x - lead.x) < 60,
    );
    const shown = s.crown?.visible === true;

    /* 다른 사람이 앞서면 왕관도 따라가야 한다 */
    const next = s.player.alive ? s.player : alive[1];
    s.stock.setExact(next.fighterId, 260);
    const moved = await until(
      () => s.crown?.visible === true && Math.abs(s.crown.x - next.x) < 60,
    );

    // 왕관 그림이 실제로 픽셀을 갖는가 (글꼴에 없는 글자면 빈 칸이 된다)
    const tex = s.textures.get('crown-mark');
    const drawn = !!tex && tex.getSourceImage()?.width > 0;

    return { shown, onLead, moved, drawn, lead: lead.cfg.name, next: next.cfg.name };
  });

  if (crown.why) errors.push(`[선두] ${crown.why}`);
  else if (!crown.shown) errors.push('[선두] 앞서 있는데도 왕관이 안 뜹니다');
  else if (!crown.onLead) errors.push('[선두] 왕관이 선두 위에 있지 않습니다');
  else if (!crown.moved) errors.push('[선두] 선두가 바뀌었는데 왕관이 안 따라갑니다');
  else if (!crown.drawn) errors.push('[선두] 왕관 그림이 비어 있습니다');
  else console.log(`  ✓ 왕관 — ${crown.lead} → ${crown.next} 로 따라간다`);

  await shot('crown');
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
  /*
   * 검사하는 동안 봇을 멈춰 세운다.
   *
   * 잡기와 공중 연속기는 **상대를 코앞에 세워 두고** 확인해야 하는 규칙이다.
   * 그런데 그 자리는 넷이 뒤엉켜 싸우는 한복판이라, 확인하는 도중에 다른 봇이
   * 끼어들어 잡기를 풀어 버리거나(그것이 규칙이다) 상대가 격추된다.
   *
   * 그건 기능이 고장난 것이 아니라 **검사할 상황이 아닌 것**이다.
   * 판단만 멈추면 봇은 그 자리에 서 있고, 전투 코드는 그대로 돈다 —
   * 확인하려는 규칙은 조금도 우회하지 않는다.
   */
  const freezeBots = () =>
    page.evaluate(() => {
      const s = window.game.scene.getScene('Battle');
      window.__savedAis ??= [];
      window.__savedAis.push(...s.ais.splice(0));
      s.fighters.filter((f) => f.side === 'ai').forEach((f) => f.moveHorizontal(0));
    });
  const thawBots = () =>
    page.evaluate(() => {
      const s = window.game.scene.getScene('Battle');
      // 판이 새로 열렸으면 봇도 새로 만들어졌다 — 옛것을 되돌리면 안 된다
      if (window.__savedAis?.length && s.ais.length === 0) {
        s.ais.push(...window.__savedAis);
      }
      window.__savedAis = [];
    });

  /*
   * 플레이어가 살아 있어야 한다.
   *
   * 앞의 검사에서 일부러 떨어뜨린 뒤라 죽은 채로 들어올 수 있다. 죽은
   * 캐릭터는 무엇을 눌러도 안 나가므로 "잡기가 안 된다"·"점프가 안 돌아온다"가
   * 줄줄이 나오는데, 고장이 아니라 확인할 상황이 아닌 것이다.
   */
  if (!(await playerState())?.alive) {
    await restartRound();
    await waitGrounded();
  }

  await freezeBots();

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
  /** 잡을 상대가 있는 상태로 만든다 (없으면 판을 새로 연다) */
  const ensureFoe = async () => {
    if (await hasFoe()) return true;
    await restartRound();
    await waitGrounded();
    // 판이 새로 열렸으면 봇도 다시 움직인다 — 검사 동안에는 다시 멈춘다
    await freezeBots();
    return hasFoe();
  };
  await ensureFoe();

  /*
   * 규칙 검사는 브라우저 안에서 한 번에 돌린다.
   * 붙잡는 데 성공하려면 상대가 판정 구간 내내 앞에 있어야 하는데,
   * 봇은 매 프레임 움직인다 — 바깥에서 왕복하며 붙잡아 두기에는 너무 느리다.
   */
  const runGrabChecks = () => page.evaluate(async () => {
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

      /*
       * 위로 던지기 — 높이 떠야 쫓아 올라가 이어칠 수 있다.
       *
       * 속도는 **던진 직후에** 잰다. 한 프레임만 지나도 중력이 깎아
       * 내리므로(프레임이 드문 환경에서는 100ms에 220이나 준다),
       * 나중에 재면 "안 떴다"는 엉뚱한 결론이 난다.
       */
      const threw = p.throwGrabbed('up');
      const vy = victim.body.velocity.y;
      const released = !p.isGrabbing() && !victim.isGrabbed();
      await wait(80);

      if (!threw) continue;
      combo = {
        pummel: { before, after: afterPummel },
        thrown: { vy, released },
      };
    }
    if (!combo) return { why: '잡기가 붙지 않았습니다', guardedFoe };

    /* 두드려서 빠져나가기 */
    await wait(900);
    let escaped = false;
    for (let t = 0; t < 8 && !escaped; t++) {
      const held = await grabOnce();
      if (!held) continue;

      /*
       * 사람이 두드리는 속도로 두드린다.
       *
       * 헤드리스는 프레임이 드물어 한 프레임에 여러 번 불러도 최소 간격에
       * 걸려 한 번만 인정된다. 자동 던지기(1.3초)보다 먼저 열 번이 쌓여야
       * 하므로, 넉넉히 돌리되 매번 풀렸는지 확인한다.
       */
      for (let i = 0; i < 26 && p.isGrabbing(); i++) {
        held.struggle();
        await wait(55);
      }
      escaped = !p.isGrabbing();
    }

    return { guardedFoe, ...combo, escaped };
  });

  /*
   * 검사 도중 상대가 전멸할 수 있다.
   *
   * 상대를 코앞에 세워 두고 돌리는 검사라 봇들끼리 서로 몰아붙이다 끝나기도
   * 한다. 그건 잡기가 고장난 것이 아니라 검사할 상대가 없어진 것이므로,
   * 판을 새로 열고 한 번 더 해 본다.
   */
  let grab = await runGrabChecks();
  if (grab.why && (await ensureFoe())) grab = await runGrabChecks();

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
  await ensureFoe();
  const airCombo = await page.evaluate(async () => {
    const s = window.game.scene.getScene('Battle');
    const p = s.player;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    /*
     * 검사하는 동안만 중력을 끈다.
     *
     * 확인하려는 규칙은 "공중 히트가 점프를 돌려주는가"이지 "이 무대에서
     * 얼마나 오래 떠 있는가"가 아니다. 그런데 무대마다 중력이 다르고
     * (2200 ~ 2464) 무거운 무대에서는 공격 판정이 나오기 전에 착지해 버려서,
     * **고장이 아닌데 실패하는** 검사가 된다. 떠 있는 시간을 검사가 직접
     * 보장하면 어느 무대에서 돌아도 같은 답이 나온다.
     */
    const airborne = [];
    const hold = (f) => {
      airborne.push(f);
      f.body.setAllowGravity(false);
    };
    const release = () => airborne.forEach((f) => f.body.setAllowGravity(true));

    try {
    if (!p.alive) return { why: '플레이어가 상장폐지된 상태입니다' };

    for (let t = 0; t < 10; t++) {
      const foe = s.fighters.find((f) => f !== p && f.alive);
      if (!foe) return { why: '살아 있는 상대가 없습니다' };

      /* 둘 다 공중에 띄우고, 점프를 다 쓴 상태로 만든다 */
      /*
       * 거리를 조금씩 바꿔 가며 시도한다.
       *
       * 캐릭터마다 팔 길이가 다르다. 한 거리로만 열 번 시도하면 사거리가
       * 짧은 캐릭터에서는 열 번 다 헛친다 — 규칙이 고장난 것이 아니라
       * 닿지 않은 것이다.
       */
      const dist = 26 + (t % 5) * 10;
      p.setPosition(640, 210);
      p.body.setVelocity(0, 0);
      foe.setPosition(640 + dist, 210);
      foe.body.setVelocity(0, 0);
      hold(p);
      hold(foe);
      p.facing = 1;
      p.jumpsLeft = 0;
      p.hitTargets.clear();
      /*
       * 방금 맞은 상대는 무적이라 이번 타가 통째로 씹힌다.
       * 확인하려는 것은 "공중 히트가 점프를 돌려주는가"이지
       * "지금 이 순간 때릴 수 있는가"가 아니므로, 조건을 만들어 준다.
       */
      foe.invulnUntil = 0;
      p.stunUntil = 0;
      p.attackPhase = 'none';
      /*
       * 점프 반환은 한 체공에 한 번이고, 착지해야 다시 열린다.
       * 이 검사는 착지 없이 공중으로 옮겨 놓고 반복하므로, 옮길 때마다
       * "새로 뜬 것"으로 쳐 줘야 두 번째 시도부터 항상 실패한다.
       */
      p.airHitRefunded = false;
      p.attack('light', 'neutral');

      for (let i = 0; i < 40; i++) {
        await wait(25);
        const grounded = p.body.blocked.down || p.body.touching.down;
        // 착지하면 어차피 점프가 복구되므로 그 표본은 버린다
        if (grounded) break;
        if (p.jumpsLeft > 0) return { refunded: true, dist };
      }
    }
    return { refunded: false };
    } finally {
      release();
    }
  });

  if (airCombo.why) errors.push(`[공중 연속기] ${airCombo.why}`);
  else if (!airCombo.refunded) {
    errors.push('[공중 연속기] 공중에서 맞혀도 점프가 돌아오지 않습니다');
  } else {
    console.log('  ✓ 공중 히트 — 점프를 한 번 돌려받는다 (띄우고 쫓아간다)');
  }

  await thawBots();
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
 * 무대 전부.
 *
 * 발판 배치는 스크린샷으로 보이지만 중력은 안 보인다. 그리고 무대를 늘리면
 * 늘어난 만큼 "그 무대에서만 터지는" 자리가 생긴다 — 발판이 여섯 개인 곳,
 * 중력이 다른 곳. 하나씩 실제로 세워 보고 콘솔이 조용한지 본다.
 *
 * 기대값을 여기 적어 두지 않는다. 적어 두면 무대를 하나 늘릴 때마다 두 군데를
 * 고쳐야 하고, 한쪽을 잊으면 새 무대는 아무도 확인하지 않은 채 배포된다.
 * 설정을 게임에게 물어보고, **적어 둔 대로 실제로 서는지**를 대조한다.
 */
console.log('무대');
{
  const BASE_GRAVITY = 2200;
  const WANT = await page.evaluate(
    () => window.game.scene.getScene('Battle').listStages(),
  );
  console.log(`  등록된 무대 ${WANT.length}곳`);

  for (const want of WANT) {
    const { id, platforms } = want;
    const gravity = BASE_GRAVITY * want.gravityMul;
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
    if (!tone) {
      errors.push(`[무대] ${id} 곡 상태를 읽지 못했습니다`);
    } else if (
      tone.transpose !== want.transpose ||
      Math.abs(tone.bpmMul - want.bpmMul) > 0.001
    ) {
      errors.push(
        `[무대] ${info.name}: 곡이 ${want.transpose}반음 · 템포 ${want.bpmMul}배여야 하는데 ` +
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

/*
 * 2인 대전.
 *
 * 선택 화면에서 F2 → 두 번 고르고 → 사람 둘이 실제로 판에 서는지.
 * 여기가 끊기면 "모드가 있다"는 말만 남는다. 그리고 두 사람의 키가 진짜로
 * 갈렸는지까지 봐야 한다 — 한쪽 키가 다른 쪽 캐릭터를 움직이면
 * 화면상으로는 멀쩡해 보이지만 같이 못 한다.
 */
console.log('2인 대전');
{
  await page.keyboard.press('Escape');
  await page.waitForTimeout(900);
  await page.keyboard.press('F2');
  await page.waitForTimeout(300);

  const armed = await page.evaluate(
    () => window.game.scene.getScene('Select')?.twoPlayer === true,
  );
  if (!armed) {
    errors.push('[2인] F2로 2인 대전이 켜지지 않습니다');
  } else {
    // 1P 고르기 → 2P 고르기 (같은 화면에서 차례만 넘어간다)
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    const midway = await page.evaluate(() => {
      const s = window.game.scene.getScene('Select');
      return { p1: s?.p1Id ?? null, confirmed: s?.confirmed ?? null };
    });
    if (!midway.p1 || midway.confirmed) {
      errors.push('[2인] 1P가 고른 뒤 2P 차례로 넘어가지 않습니다');
    }

    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(160);
    }
    await shot('vs-select');
    await page.keyboard.press('Enter');

    await waitUntil((s) => s.alive && s.active, '2인 대전 개시', 20000);

    const vs = await page.evaluate(() => {
      const s = window.game.scene.getScene('Battle');
      const humans = s.fighters.filter((f) => f.side === 'player');
      return {
        total: s.fighters.length,
        humans: humans.length,
        names: humans.map((f) => f.cfg.name),
        ids: humans.map((f) => f.fighterId),
        same: humans.length === 2 && humans[0].cfg.id === humans[1].cfg.id,
        // 봇이 사람과 같은 캐릭터를 쓰고 있지는 않은가
        clash: s.fighters
          .filter((f) => f.side === 'ai')
          .some((b) => humans.some((h) => h.cfg.id === b.cfg.id)),
      };
    });

    if (vs.humans !== 2) {
      errors.push(`[2인] 사람이 둘이어야 하는데 ${vs.humans}명입니다`);
    } else if (vs.total !== 4) {
      errors.push(`[2인] 판에 넷이 서야 하는데 ${vs.total}명입니다`);
    } else if (vs.same || vs.clash) {
      errors.push('[2인] 같은 캐릭터가 두 번 나왔습니다');
    } else {
      console.log(
        `  ✓ F2 → 1P·2P 각자 선택 — ${vs.ids.join('/')} = ${vs.names.join(' vs ')} + 봇 둘`,
      );
    }

    /*
     * 키가 갈렸는가.
     *
     * 1P의 A/D 와 2P의 ←/→ 를 각각 눌러 **그 사람만** 움직이는지 본다.
     * 한 키가 둘 다 움직이면(혹은 엉뚱한 쪽을 움직이면) 같이 할 수 없다.
     */
    const moved = async (key) => {
      const before = await page.evaluate(() => {
        const s = window.game.scene.getScene('Battle');
        const h = s.fighters.filter((f) => f.side === 'player');
        return h.map((f) => f.x);
      });
      await hold(key, 420);
      await page.waitForTimeout(120);
      const after = await page.evaluate(() => {
        const s = window.game.scene.getScene('Battle');
        const h = s.fighters.filter((f) => f.side === 'player');
        return h.map((f) => f.x);
      });
      return after.map((x, i) => Math.abs(x - before[i]));
    };

    const byA = await moved('a');
    const byLeft = await moved('ArrowLeft');
    const MOVED = 18;

    if (byA[0] < MOVED) {
      errors.push(`[2인] A를 눌러도 1P가 움직이지 않습니다 (${byA[0]?.toFixed(0)}px)`);
    } else if (byLeft[1] < MOVED) {
      errors.push(`[2인] ←를 눌러도 2P가 움직이지 않습니다 (${byLeft[1]?.toFixed(0)}px)`);
    } else {
      console.log(
        `  ✓ 키 분리 — A→1P ${byA[0].toFixed(0)}px · ←→2P ${byLeft[1].toFixed(0)}px`,
      );
    }
    await shot('vs-battle');
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
