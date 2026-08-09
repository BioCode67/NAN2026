#!/usr/bin/env node
/**
 * 문장 → 그림 파이프라인을 **실제로 붙여 보는** 검사.
 *
 *   npm run test:image     (dev 서버가 떠 있어야 한다)
 *
 * ── 왜 필요한가 ────────────────────────────────────────────────────
 * "서버 주소만 주면 그림이 나옵니다"는 확인하지 않으면 희망사항이다.
 * 시연 당일에 SD 서버를 켰는데 그림이 안 나오면, 원인이 서버인지 게임인지
 * 알 방법이 없다 — 그 자리에서 코드를 열게 된다.
 *
 * 그래서 **진짜 HTTP 서버**를 띄운다. AUTOMATIC1111 의 txt2img 응답 모양을
 * 그대로 흉내 내는 서버다. 게임이 그 서버를 부르고, 받은 그림을 텍스처로
 * 굽고, 연출한 뒤 배경으로 앉히는 것까지 눈이 아니라 상태로 확인한다.
 *
 * 확인하는 것:
 *   1. 주소가 없으면 아무 일도 안 일어난다 (기본 상태가 멀쩡한가)
 *   2. 주소를 주면 서버를 실제로 부른다 — 무엇을 보냈는지까지 본다
 *   3. 받은 그림이 이 판의 배경이 된다
 *   4. 서버가 죽어 있어도 게임은 멀쩡히 돌아간다
 *   5. 같은 문장이면 같은 씨앗으로 부른다 (온라인에서 그림이 갈리지 않는다)
 */

import { createServer } from 'node:http';
import { deflateSync } from 'node:zlib';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('playwright 가 없습니다:\n  npm i -D playwright');
  process.exit(1);
}

let failed = 0;
const pass = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => {
  failed++;
  console.log(`  ✗ ${m}`);
};

/* ------------------------------------------------------------------ */
/* 가짜 그림 서버                                                      */
/* ------------------------------------------------------------------ */

/**
 * PNG 를 **손으로 굽는다**.
 *
 * 1×1 이 아니라 가로로 긴 그림을 돌려준다 — 배경으로 앉히는 코드가 원본
 * 크기를 읽어 비율을 맞추므로, 1×1 을 주면 그 계산이 통째로 건너뛰어져
 * "붙였다"만 확인되고 "제대로 붙었다"는 확인되지 않는다.
 *
 * 처음에는 어디선가 본 base64 한 줄을 붙여 넣었는데, 그게 깨진 PNG 였다.
 * 브라우저는 조용히 onerror 를 내고, 검사는 "그림이 안 붙었습니다"라고만
 * 말했다 — 게임 코드에는 아무 문제가 없었는데 반나절을 거기서 찾게 된다.
 * 짧은 인코더를 직접 두면 검사가 쓰는 그림이 진짜라는 것이 자명해진다.
 */
function makePng(w, h, rgb) {
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // 비트 깊이
  ihdr[9] = 2; // 트루컬러
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 3);
    raw[row] = 0; // 필터 없음
    for (let x = 0; x < w; x++) {
      raw[row + 1 + x * 3] = rgb[0];
      raw[row + 2 + x * 3] = rgb[1];
      raw[row + 3 + x * 3] = rgb[2];
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const PNG_16x9 = makePng(160, 90, [220, 40, 60]);

const seen = [];
let mode = 'ok';

const server = createServer((req, res) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    let parsed = {};
    try {
      parsed = JSON.parse(body || '{}');
    } catch {
      /* 못 읽어도 기록은 남긴다 */
    }
    seen.push({ url: req.url, body: parsed });

    if (mode === 'boom') {
      res.writeHead(500, cors);
      res.end('nope');
      return;
    }
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ images: [PNG_16x9.toString('base64')] }));
  });
});

await new Promise((r) => server.listen(7861, '127.0.0.1', r));
const SD = 'http://127.0.0.1:7861';

/* ------------------------------------------------------------------ */

console.log('문장 → 그림 파이프라인\n');

const browser = await chromium.launch({
  ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
});

/** 전투 화면까지 몰고 간다 */
async function toBattle(sdUrl) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  // 게임이 뜨기 **전에** 주소를 심어야 한다 — 설정은 켤 때 한 번 읽는다
  if (sdUrl) {
    await page.addInitScript((u) => {
      localStorage.setItem('sd.url', u);
      localStorage.setItem('sd.mode', 'a1111');
    }, sdUrl);
  } else {
    await page.addInitScript(() => {
      localStorage.removeItem('sd.url');
      localStorage.removeItem('sd.mode');
    });
  }

  await page.goto('http://localhost:3000');
  await page.waitForFunction(() => window.game?.scene?.isActive('Title'), null, {
    polling: 200,
    timeout: 20000,
  });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.game?.scene?.isActive('Select'), null, {
    polling: 200,
    timeout: 20000,
  });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.game?.scene?.isActive('Battle'), null, {
    polling: 200,
    timeout: 30000,
  });
  return page;
}

/** 문장 하나를 판에 건다 (오브를 깨는 과정은 건너뛴다 — 여기 관심사가 아니다) */
const say = (page, text) =>
  page.evaluate((t) => {
    const s = window.game.scene.getScene('Battle');
    s.applyPrompt(t, '검사');
  }, text);

try {
  /* --- 1. 주소가 없을 때 -------------------------------------------- */
  {
    const page = await toBattle(null);
    const status = await page.evaluate(() => window.sdStatus());
    await say(page, '달로 보내줘');
    await page.waitForTimeout(1200);
    const state = await page.evaluate(
      () => window.game.scene.getScene('Battle').promptArt.state,
    );

    if (status.ready) {
      fail(`주소를 안 줬는데 켜져 있습니다 — ${JSON.stringify(status)}`);
    } else if (state !== 'off') {
      fail(`주소가 없는데 상태가 ${state} 입니다 (off 여야 합니다)`);
    } else {
      pass('주소가 없으면 부르지 않는다 (게임은 그대로 돈다)');
    }
    await page.close();
  }

  /* --- 2·3·5. 주소를 주면 실제로 부르고, 배경이 된다 ------------------ */
  {
    seen.length = 0;
    mode = 'ok';
    const page = await toBattle(SD);

    const status = await page.evaluate(() => window.sdStatus());
    if (!status.ready || status.mode !== 'a1111') {
      fail(`주소를 줬는데 안 잡힙니다 — ${JSON.stringify(status)}`);
    } else {
      pass(`주소를 주면 잡는다 (${status.mode})`);
    }

    await say(page, '용암을 부어라');

    const shown = await page
      .waitForFunction(
        () => window.game.scene.getScene('Battle').promptArt.state === 'shown',
        null,
        { polling: 200, timeout: 20000 },
      )
      .then(() => true)
      .catch(() => false);

    if (!shown) {
      const st = await page.evaluate(
        () => window.game.scene.getScene('Battle').promptArt.state,
      );
      fail(`그림이 안 붙었습니다 (상태 ${st}, 서버가 받은 요청 ${seen.length}건)`);
    } else {
      pass('서버를 부르고 받은 그림을 텍스처로 굽는다');
    }

    /* 무엇을 보냈는가 — 장면 설명이 앞에 서고 사람 말이 뒤에 붙어야 한다 */
    const req = seen[0];
    if (!req) {
      fail('서버가 요청을 하나도 못 받았습니다');
    } else if (!/sdapi\/v1\/txt2img/.test(req.url)) {
      fail(`엉뚱한 곳을 불렀습니다 — ${req.url}`);
    } else if (!/lava|volcanic/i.test(req.body.prompt ?? '')) {
      fail(`장면 설명이 안 실렸습니다 — ${String(req.body.prompt).slice(0, 120)}`);
    } else if (!String(req.body.prompt).includes('용암을 부어라')) {
      fail('사람이 쓴 말이 안 실렸습니다');
    } else {
      pass('보내는 문장에 장면 설명(영어)과 사람이 쓴 말이 함께 실린다');
    }

    /* 배경이 됐는가 — 연출이 끝난 뒤 무대 그림이 갈린다 */
    const became = await page
      .waitForFunction(
        () => {
          const s = window.game.scene.getScene('Battle');
          return /^prompt-art-/.test(s.bgArt?.texture?.key ?? '');
        },
        null,
        { polling: 200, timeout: 20000 },
      )
      .then(() => true)
      .catch(() => false);

    if (!became) {
      const key = await page.evaluate(
        () => window.game.scene.getScene('Battle').bgArt?.texture?.key ?? null,
      );
      fail(`그림이 이 판의 배경이 되지 않았습니다 (지금 배경 ${key})`);
    } else {
      pass('받은 그림이 이 판의 배경이 된다');
    }

    /* 같은 문장 → 같은 씨앗 (온라인에서 사람마다 다른 그림이 나오면 안 된다) */
    seen.length = 0;
    await say(page, '용암을 부어라');
    await page.waitForTimeout(1500);
    const again = seen[0];
    if (!again) {
      fail('두 번째 요청이 안 갔습니다');
    } else if (again.body.seed !== req.body.seed) {
      fail(`같은 문장인데 씨앗이 다릅니다 — ${req.body.seed} vs ${again.body.seed}`);
    } else {
      pass(`같은 문장이면 같은 씨앗 (${req.body.seed}) — 온라인에서 그림이 안 갈린다`);
    }

    await page.screenshot({ path: 'tools/smoke-shots/prompt-art.png' });
    await page.close();
  }

  /* --- 4. 서버가 죽어 있어도 ---------------------------------------- */
  {
    seen.length = 0;
    mode = 'boom';
    const page = await toBattle(SD);
    await say(page, '전부 거대하게');

    const settled = await page
      .waitForFunction(
        () => window.game.scene.getScene('Battle').promptArt.state === 'failed',
        null,
        { polling: 200, timeout: 20000 },
      )
      .then(() => true)
      .catch(() => false);

    const alive = await page.evaluate(() => {
      const s = window.game.scene.getScene('Battle');
      return {
        active: window.game.scene.isActive('Battle'),
        gimmicks: s.gimmicks.getActive().length,
      };
    });

    if (!settled) {
      fail('서버가 500을 줬는데 상태가 정리되지 않습니다');
    } else if (!alive.active || alive.gimmicks === 0) {
      fail(`서버가 죽으니 게임이 흔들립니다 — ${JSON.stringify(alive)}`);
    } else {
      pass('서버가 죽어 있어도 기믹은 그대로 걸리고 판은 멀쩡하다');
    }
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}

console.log(
  failed
    ? `\n실패 ${failed}건`
    : '\n통과 — 주소만 주면 문장이 그림이 되고, 없으면 조용히 넘어간다',
);
process.exit(failed ? 1 : 0);
