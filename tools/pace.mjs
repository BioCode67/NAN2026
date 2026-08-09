#!/usr/bin/env node
/**
 * 판의 리듬을 잰다 — 한 판이 얼마나 걸리고, 무엇으로 죽는가.
 *
 * ── 왜 재는가 ──────────────────────────────────────────────────────
 * 넉백·회피·카메라를 손댈 때마다 "이러면 재미있어질 것이다"라고 적었지만,
 * 그 말이 맞는지는 아무도 안 봤다. 손맛은 숫자로 못 재도 **리듬은 재진다** —
 * 한 판이 20초면 아무도 기술을 못 써 보고 끝나고, 3분이면 넷이 지친다.
 *
 * 그리고 이 게임에는 죽는 길이 둘 있다. 주가가 0이 되는 것(상장폐지)과
 * 무대 밖으로 날아가는 것(장외)이다. 대난투류의 손맛은 뒤엣것에서 나오는데,
 * 넉백이 약하면 장외가 0%에 가깝고 그러면 "때려서 깎는 게임"이 된다.
 * 그 비율이 어느 쪽으로 기울었는지는 눈으로 못 본다.
 *
 * 봇끼리 붙여 놓고 여러 판을 돌린다. 사람이 없어야 판마다 조건이 같다.
 *
 * 사용법:
 *   npm run dev          (다른 터미널에서 먼저)
 *   npm run pace         (기본 5판)
 *   npm run pace -- 10   (10판)
 */

const URL = process.env.SMOKE_URL ?? 'http://localhost:3000';
const ROUNDS = Number(process.argv[2] ?? 5);

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('playwright가 없습니다');
  process.exit(1);
}

try {
  const res = await fetch(URL, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(String(res.status));
} catch {
  console.error(`${URL} 에 접속할 수 없습니다. 먼저 "npm run dev" 를 실행하세요.`);
  process.exit(1);
}

const browser = await chromium.launch({
  headless: true,
  ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
});
const page = await (
  await browser.newContext({ viewport: { width: 1280, height: 720 } })
).newPage();

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('canvas');

const alive = (k) =>
  page.evaluate((s) => !!window.game?.scene?.isActive(s), k).catch(() => false);

for (let i = 0; i < 40 && !(await alive('Select')); i++) {
  if (await alive('Title')) {
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1500);
  } else await page.waitForTimeout(250);
}
await page.waitForTimeout(900);
await page.keyboard.press('Enter');
for (let i = 0; i < 60 && !(await alive('Battle')); i++) await page.waitForTimeout(250);

console.log(`판의 리듬 — ${ROUNDS}판\n`);

const rounds = [];

for (let r = 0; r < ROUNDS; r++) {
  // 전투가 실제로 시작될 때까지
  for (let i = 0; i < 80; i++) {
    if (await page.evaluate(() => window.game?.scene?.getScene('Battle')?.battleActive)) break;
    await page.waitForTimeout(250);
  }

  /*
   * 사람을 봇으로 바꾼다.
   *
   * 사람 자리는 아무도 안 누르니 가만히 서서 맞기만 한다 — 그 판의 길이는
   * 게임의 리듬이 아니라 "허수아비 하나를 지우는 데 걸리는 시간"이다.
   * 봇 하나를 더 붙여 넷 다 싸우게 한다.
   */
  await page.evaluate(() => {
    const s = window.game.scene.getScene('Battle');
    const p = s.player;
    /*
     * **판마다** 다시 붙인다.
     *
     * 처음에는 한 번만 붙이고 표시를 남겼는데, R 로 다시 시작해도 씬 객체는
     * 그대로라 그 표시가 살아 있었다. 반면 봇 목록은 create 에서 비워진다 —
     * 그래서 2판부터는 사람 자리가 가만히 서서 맞는 허수아비가 됐고,
     * 판 길이가 13초와 147초로 두 갈래로 갈렸다. 리듬을 잰 게 아니라
     * "봇이 붙었나 안 붙었나"를 잰 셈이다.
     */
    const sample = s.ais[0];
    if (sample && s.ais.length < s.fighters.length) {
      // 생성자 인수는 씬이 쓰는 것과 같다 (파이터, 표적 고르기, 난이도, 동작)
      const AI = sample.constructor;
      s.ais.push(
        new AI(p, () => s.pickAiTarget(p), s.difficulty, {
          castSkill: (f) => s.castSkill(f),
        }),
      );
    }
    // 게임 시각을 기준으로 잰다 — 벽시계는 헤드리스에서 5배 늘어난다
    s.__paceStart = s.time.now;
    s.__paceKos = [];
  });

  /*
   * 격추를 원인까지 모은다.
   *
   * 처음에는 죽은 자리의 좌표로 갈랐다(y > 860 이면 장외 …). 그러면 장외
   * 경계값이 게임과 검사 두 군데에 적히고, 무대를 넓히는 날 조용히 어긋난다.
   * **장외는 forceDelist 를 타는 유일한 길**이므로 거기를 가로채면 경계값을
   * 알 필요가 없다 — 주가가 깎여 죽는 길은 이 함수를 안 지난다.
   */
  await page.evaluate(() => {
    const s = window.game.scene.getScene('Battle');
    if (s.__paceHooked) return;
    s.__paceHooked = true;

    const origDelist = s.stock.forceDelist.bind(s.stock);
    s.stock.forceDelist = (id, killerId) => {
      s.__paceOut = id;
      return origDelist(id, killerId);
    };

    const origKo = s.playKo.bind(s);
    s.playKo = (victim, killer) => {
      const how = s.__paceOut === victim.fighterId ? '장외' : '상장폐지';
      s.__paceOut = null;
      (s.__paceKos ??= []).push({ how, at: s.time.now - (s.__paceStart ?? 0) });
      return origKo(victim, killer);
    };
  });

  /*
   * 판이 끝날 때까지 — **게임 시각**으로 재고, 게임 시각으로 포기한다.
   *
   * 처음에는 "300ms 씩 400번" 으로 끊었는데, 그건 벽시계 120초다. 이 게임은
   * 2분 30초에 서든데스가 걸려 주가를 초당 1%씩 깎아 판을 닫는데, 그 시각이
   * 오기도 전에 검사가 먼저 포기한 것이다. 그래 놓고 "여덟 판 중 셋이 안
   * 끝난다"고 읽었다 — 게임이 늘어진 게 아니라 검사가 일찍 자리를 뜬 것이다.
   *
   * 서든데스(150초)에 전원이 0까지 깎이는 데 걸리는 시간(최대 100초)을
   * 더해도 250초면 어떤 판이든 닫힌다. 300초를 한계로 둔다.
   */
  const CAP_MS = 300000;
  let done = false;
  let elapsed = 0;
  for (let i = 0; i < 3000 && !done; i++) {
    await page.waitForTimeout(300);
    const st = await page.evaluate(() => {
      const s = window.game?.scene?.getScene('Battle');
      if (!s) return null;
      return {
        done: s.resultShown ?? false,
        t: s.time.now - (s.__paceStart ?? s.time.now),
      };
    });
    if (!st) break;
    done = st.done;
    elapsed = st.t;
    if (!done && elapsed > CAP_MS) break;
  }

  const r0 = await page.evaluate(() => {
    const s = window.game.scene.getScene('Battle');
    return {
      ms: s.time.now - (s.__paceStart ?? s.time.now),
      kos: s.__paceKos ?? [],
      done: s.resultShown,
      sudden: !!s.suddenDeath,
    };
  });
  rounds.push(r0);

  const secs = (r0.ms / 1000).toFixed(0);
  const out = r0.kos.filter((k) => k.how === '장외').length;
  console.log(
    `  ${r + 1}판 — ${r0.done ? `${secs}초` : '안 끝남'} · 격추 ${r0.kos.length}회` +
      ` (장외 ${out})${r0.sudden ? ' · 서든데스' : ''}`,
  );

  if (r < ROUNDS - 1) {
    await page.keyboard.press('r');
    await page.waitForTimeout(1500);
  }
}

const finished = rounds.filter((r) => r.done);
const allKos = finished.flatMap((r) => r.kos);
const outs = allKos.filter((k) => k.how === '장외').length;
const avg = finished.length
  ? finished.reduce((a, r) => a + r.ms, 0) / finished.length / 1000
  : 0;

console.log('');
console.log(`끝난 판       ${finished.length}/${ROUNDS}`);
console.log(`평균 길이     ${avg.toFixed(0)}초`);
console.log(
  `죽는 길       장외 ${outs}회 · 상장폐지 ${allKos.length - outs}회` +
    (allKos.length ? ` (장외 ${Math.round((outs / allKos.length) * 100)}%)` : ''),
);
console.log(`서든데스까지  ${finished.filter((r) => r.sudden).length}판`);

await browser.close();
