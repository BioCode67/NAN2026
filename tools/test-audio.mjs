#!/usr/bin/env node
/**
 * 소리 파일을 **실제로 넣어 보는** 검사.
 *
 *   npm run test:audio     (dev 서버가 떠 있어야 한다)
 *
 * ── 왜 필요한가 ────────────────────────────────────────────────────
 * "파일을 넣으면 그게 쓰인다"는 문장은 확인하지 않으면 희망사항이다.
 * 곡을 만들어 온 사람이 폴더에 넣었는데 게임에서 여전히 합성 소리가
 * 나면, 그 사람은 자기 파일이 잘못된 줄 안다 — 원인은 코드에 있는데.
 *
 * 그래서 진짜 WAV 를 만들어 public/ 에 넣고, 브라우저에서 게임을 켜서
 * **그 곡이 실제로 흐르는지**(bgmDebug.source === 'file') 확인한 뒤 치운다.
 * WAV 를 쓰는 이유는 헤더 44바이트로 손수 만들 수 있어서다 — mp3 인코더
 * 없이 검사가 자족한다.
 *
 * 확인하는 것:
 *   1. 파일이 없으면 합성 곡이 돈다 (기본 상태가 멀쩡한가)
 *   2. 파일을 넣으면 파일 곡으로 갈아탄다
 *   3. `_hot` 을 같이 넣으면 두 줄이 흐른다 (뜨거운 판 층)
 *   4. 효과음도 파일이 쓰인다
 *   5. 검사가 끝나면 넣은 파일이 남지 않는다
 */

import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';

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
/* 소리 파일 만들기                                                    */
/* ------------------------------------------------------------------ */

/**
 * 사인파 한 토막을 WAV 로 만든다.
 *
 * 내용은 중요하지 않다 — 브라우저가 디코드할 수 있는 진짜 소리이기만
 * 하면 된다. 그래도 무음이 아니라 사인파를 넣는 것은, 무음 파일을
 * "디코드 실패"와 구별하지 못하는 구현이 있을 수 있어서다.
 */
function makeWav(seconds = 0.5, freq = 440) {
  const rate = 22050;
  const n = Math.floor(rate * seconds);
  const buf = Buffer.alloc(44 + n * 2);

  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); // fmt 청크 크기
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // 모노
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28); // 초당 바이트
  buf.writeUInt16LE(2, 32); // 블록 정렬
  buf.writeUInt16LE(16, 34); // 비트 깊이
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);

  for (let i = 0; i < n; i++) {
    const v = Math.sin((2 * Math.PI * freq * i) / rate) * 0.25 * 32767;
    buf.writeInt16LE(Math.round(v), 44 + i * 2);
  }
  return buf;
}

/* ------------------------------------------------------------------ */

const PLANTED = [
  'public/bgm/menu.wav',
  'public/bgm/battle.wav',
  'public/bgm/battle_hot.wav',
  'public/sfx/uiConfirm.wav',
];

/** 넣어 둔 파일을 전부 치운다 — 실패해도 반드시 부른다 */
function cleanup() {
  for (const p of PLANTED) rmSync(p, { force: true });
  for (const d of ['public/bgm', 'public/sfx']) {
    try {
      rmSync(d, { recursive: false });
    } catch {
      /* 원래 다른 파일이 들어 있으면 지우지 않는다 */
    }
  }
}

/** 게임을 켜고 소리를 깨운 뒤 상태를 읽는다 */
async function readState(browser) {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  await page.goto('http://localhost:3000');
  await page.waitForFunction(() => window.game?.scene?.isActive('Title'), null, {
    polling: 200,
    timeout: 20000,
  });

  // 첫 입력이 곧 오디오 잠금 해제다 — 이게 없으면 영원히 조용하다
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.game?.scene?.isActive('Select'), null, {
    polling: 200,
    timeout: 15000,
  });

  /*
   * 곡이 실제로 자리를 잡을 때까지 기다린다.
   * 파일은 받아서 디코드까지 끝나야 갈아타므로, 켜자마자 읽으면
   * 아직 합성인 순간을 잡을 수 있다 — 그건 고장이 아니라 이른 것이다.
   */
  await page
    .waitForFunction(
      () => window.sound?.bgmDebug?.source === 'file',
      null,
      { polling: 150, timeout: 6000 },
    )
    .catch(() => {
      /* 파일이 없는 경우가 정상인 회차도 있다 */
    });

  const state = await page.evaluate(() => ({
    bgm: window.sound.bgmDebug,
    files: window.sound.fileAudio,
  }));
  await page.close();
  return state;
}

/* ------------------------------------------------------------------ */

console.log('소리 파일 파이프라인\n');
cleanup();

const browser = await chromium.launch({
  ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
});

try {
  /* --- 1. 파일이 없을 때 — 합성 곡이 돌아야 한다 ------------------- */
  const bare = await readState(browser);
  if (bare.bgm.source !== 'synth') {
    fail(`파일이 없는데 곡 출처가 ${bare.bgm.source} 입니다 (합성이어야 합니다)`);
  } else {
    pass('파일이 하나도 없어도 곡이 돈다 (합성)');
  }

  /* --- 2·3·4. 파일을 넣으면 갈아탄다 ------------------------------- */
  mkdirSync('public/bgm', { recursive: true });
  mkdirSync('public/sfx', { recursive: true });
  writeFileSync('public/bgm/menu.wav', makeWav(0.5, 440));
  writeFileSync('public/bgm/battle.wav', makeWav(0.5, 330));
  writeFileSync('public/bgm/battle_hot.wav', makeWav(0.5, 660));
  writeFileSync('public/sfx/uiConfirm.wav', makeWav(0.1, 880));

  const withFiles = await readState(browser);

  if (withFiles.bgm.source !== 'file') {
    fail(
      `파일을 넣었는데 여전히 ${withFiles.bgm.source} 입니다 — ` +
        `받은 파일: ${JSON.stringify(withFiles.files)}`,
    );
  } else {
    pass(`곡 파일이 쓰인다 (${withFiles.bgm.track})`);
  }

  if (!withFiles.files.sfx.includes('uiConfirm')) {
    fail(`효과음 파일이 안 잡혔습니다 — ${JSON.stringify(withFiles.files.sfx)}`);
  } else {
    pass('효과음 파일도 쓰인다');
  }

  /*
   * 뜨거운 판 층 — menu 곡에는 _hot 을 안 넣었으므로 한 줄이 정상이다.
   * 두 줄이 되는지는 battle 곡에서 확인해야 하는데, 여기서는 목록에
   * 잡혔는지까지만 본다 (전투까지 몰고 가는 것은 스모크의 일이다).
   */
  if (!withFiles.files.bgm.includes('battle_hot')) {
    fail(`뜨거운 판 층(battle_hot)이 안 잡혔습니다 — ${JSON.stringify(withFiles.files.bgm)}`);
  } else {
    pass('뜨거운 판 층(_hot)도 받아 둔다');
  }
} finally {
  await browser.close();
  cleanup();
}

/* --- 5. 뒷정리 ------------------------------------------------------ */
const left = PLANTED.filter((p) => existsSync(p));
if (left.length) fail(`검사가 넣은 파일이 남았습니다: ${left.join(', ')}`);
else pass('검사가 넣은 파일이 남지 않는다');

console.log(failed ? `\n실패 ${failed}건` : '\n통과 — 넣으면 쓰이고, 없으면 합성으로 돈다');
process.exit(failed ? 1 : 0);
