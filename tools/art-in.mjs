#!/usr/bin/env node
/**
 * 프롬프트를 클립보드에 넣어 주고, 받은 그림을 알아서 제자리에 넣는다.
 *
 *   npm run art:in                남은 자리를 순서대로 (기본: 지켜보기 모드)
 *   npm run art:in -- scenes      배경·UI만
 *   npm run art:in -- gates       빌 게이츠맨 묶음 7장
 *   npm run art:in -- --list      어디까지 채웠는지 보기
 *
 * ── 사람이 하는 일 ────────────────────────────────────────────────
 *   Ctrl+V → 받기.  그게 전부다.
 *
 * 도구가 프롬프트를 클립보드에 넣어 두고 다운로드 폴더를 지켜보다가,
 * 새 그림이 떨어지면 정해진 이름으로 정해진 자리에 옮기고 **다음 프롬프트를
 * 클립보드에 채워 넣는다.** 터미널로 돌아올 필요가 없다.
 *
 * 없애려는 것: 프롬프트 파일 열기 → 전체 선택 → 복사 → 붙여넣기 → 받기 →
 * 내려받은 파일 찾기 → 이름 바꾸기 → 폴더 찾아 옮기기.
 * 46장이면 이 여덟 단계를 46번 반복하게 된다. 어느 순간 한 칸 밀린다.
 *
 * 찾는 곳은 ART_INBOX 환경변수 → art-source/inbox → 다운로드 폴더 순이다.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { emitKeypressEvents } from 'node:readline';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { buildCatalog } from './art-catalog.mjs';
import { CHARACTERS } from './art-characters.mjs';
import { copyToClipboard } from './clipboard.mjs';

/** 이미지로 볼 확장자 (.crdownload 같은 받는 중 파일은 자연히 걸러진다) */
const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;
/** 이보다 오래된 파일은 "방금 받은 것"으로 보지 않는다 (시간) */
const RECENT_HOURS = 12;
/** 폴더를 얼마나 자주 들여다볼까 */
const POLL_MS = 400;

/* ------------------------------------------------------------------ */
/* 받은 그림 찾기                                                       */
/* ------------------------------------------------------------------ */

function inboxDirs() {
  const dirs = [];
  if (process.env.ART_INBOX) dirs.push(process.env.ART_INBOX);
  dirs.push('art-source/inbox');

  const home = homedir();
  dirs.push(join(home, 'Downloads'), join(home, '다운로드'));

  return dirs.filter((d) => existsSync(d));
}

/** 최근에 생긴 이미지들, 새 것부터 */
function recentImages() {
  const cutoff = Date.now() - RECENT_HOURS * 3600 * 1000;
  const found = [];

  for (const dir of inboxDirs()) {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!IMAGE_EXT.test(name)) continue;
      const path = join(dir, name);
      let st;
      try {
        st = statSync(path);
      } catch {
        continue;
      }
      if (!st.isFile() || st.mtimeMs < cutoff) continue;
      found.push({ path, name, mtime: st.mtimeMs, size: st.size });
    }
  }

  return found.sort((a, b) => b.mtime - a.mtime);
}

/** PNG 인가 — 게임이 읽는 경로가 .png 로 고정돼 있다 */
function isPng(path) {
  try {
    const head = readFileSync(path).subarray(0, 8);
    return head.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  } catch {
    return false;
  }
}

/**
 * 다 받아졌는가.
 *
 * 브라우저는 파일을 조금씩 쓴다. 받는 중에 집어 가면 잘린 그림이 들어간다.
 * 크기가 두 번 연속 그대로면 다 받은 것으로 본다.
 *
 * "몇 KB 이상"으로 거르지 않는다. 그렇게 하면 그 문턱보다 작은 그림이
 * 영영 "받는 중"으로 남아 아무 말 없이 멈춰 선다 —
 * 실제로 그렇게 만들었다가 걸렸다. 자라기를 멈췄는지만 본다.
 */
async function isSettled(file) {
  let last = -1;
  let stable = 0;

  // 최대 12초쯤 기다린다. 그 안에 안 멎으면 다음 차례에 다시 본다
  for (let i = 0; i < 30 && stable < 2; i++) {
    await sleep(POLL_MS);
    let now;
    try {
      now = statSync(file.path).size;
    } catch {
      return false; // 받다 취소돼 사라진 경우
    }
    stable = now === last ? stable + 1 : 0;
    last = now;
  }
  return stable >= 2 && last > 0;
}

/** 옮긴다. 드라이브가 다르면 rename이 안 되므로 복사 후 지운다 */
function moveInto(from, to, keep) {
  mkdirSync(dirname(to), { recursive: true });
  if (keep) {
    copyFileSync(from, to);
    return;
  }
  try {
    renameSync(from, to);
  } catch {
    copyFileSync(from, to);
    unlinkSync(from);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ago = (ms) => {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return `${s}초 전`;
  if (s < 3600) return `${Math.round(s / 60)}분 전`;
  return `${Math.round(s / 3600)}시간 전`;
};

/* ------------------------------------------------------------------ */
/* 인자                                                                */
/* ------------------------------------------------------------------ */

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const picks = argv.filter((a) => !a.startsWith('--'));

const KEEP = flags.has('--keep'); // 원본을 남긴다
const FORCE = flags.has('--force');
const NO_CLIP = flags.has('--no-clip');

const catalog = buildCatalog();

function slotsFor(names) {
  if (!names.length) return catalog;
  const out = [];
  for (const name of names) {
    const hit = catalog.filter((i) => i.group === name || i.id === name);
    if (!hit.length) {
      console.error(
        `"${name}" 을(를) 찾지 못했습니다.\n` +
          `쓸 수 있는 이름: scenes, ${Object.keys(CHARACTERS).join(', ')}\n` +
          `또는 낱장 id: ${catalog
            .filter((i) => i.group === 'scenes')
            .map((i) => i.id)
            .join(', ')}`,
      );
      process.exit(1);
    }
    out.push(...hit);
  }
  return [...new Map(out.map((i) => [i.id, i])).values()];
}

const slots = slotsFor(picks);
const pending = FORCE ? slots : slots.filter((i) => !existsSync(i.out));

/* --- 목록만 보기 ---------------------------------------------------- */

if (flags.has('--list')) {
  const filledCount = slots.length - pending.length;
  console.log(`전체 ${slots.length}자리 · 채움 ${filledCount} · 남음 ${pending.length}\n`);
  for (const i of slots) {
    console.log(`  ${existsSync(i.out) ? '✓' : '·'} ${i.id.padEnd(12)} ${i.label}`);
  }
  process.exit(0);
}

if (!pending.length) {
  console.log('빈 자리가 없습니다. 다시 넣으려면 --force');
  process.exit(0);
}

/* ------------------------------------------------------------------ */
/* 키 입력                                                             */
/* ------------------------------------------------------------------ */

/** 눌린 키를 모아 두고 루프가 가져간다 */
const keyQueue = [];
const interactive = process.stdin.isTTY;

if (interactive) {
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('keypress', (str, key) => {
    if (key?.ctrl && key.name === 'c') finish(true);
    keyQueue.push(key?.name ?? str);
  });
}

function takeKey() {
  return keyQueue.shift();
}

/* ------------------------------------------------------------------ */
/* 진행                                                                */
/* ------------------------------------------------------------------ */

let filled = 0;
/** 시작 시점에 이미 있던 파일 — 이건 "방금 받은 것"이 아니다 */
const seen = new Set(recentImages().map((f) => f.path));

console.log(`받은 그림을 찾는 곳: ${inboxDirs().join(' , ') || '(없음)'}`);
console.log(`채울 자리 ${pending.length}개`);
console.log(
  interactive
    ? '\n붙여넣고 → 받기. 그러면 알아서 들어갑니다.  [s 건너뛰기 · q 끝내기]\n'
    : '\n(대화형 터미널이 아니라 키 입력은 받지 않습니다)\n',
);

for (let n = 0; n < pending.length; n++) {
  const slot = pending[n];
  const prompt = readFileSync(slot.prompt, 'utf8');

  console.log(`[${n + 1}/${pending.length}] ${slot.label}`);

  const copied = NO_CLIP ? false : copyToClipboard(prompt, slot.prompt);
  console.log(
    copied
      ? '   프롬프트를 클립보드에 넣었습니다. 나노바나나에 Ctrl+V 하고 받으세요.'
      : `   프롬프트: ${slot.prompt}  (열어서 복사하세요)`,
  );

  const got = await waitForImage();

  if (got === 'quit') break;
  if (got === 'skip') {
    console.log('   건너뜀\n');
    continue;
  }

  moveInto(got.path, slot.out, KEEP);
  seen.add(got.path);
  filled++;
  console.log(`   ✓ ${got.name} → ${slot.out}\n`);
}

finish(false);

/* ------------------------------------------------------------------ */

/**
 * 새 그림이 떨어질 때까지 지켜본다.
 * @returns 파일 정보 · 'skip' · 'quit'
 */
async function waitForImage() {
  const spin = ['·  ', ' · ', '  ·'];
  let tick = 0;

  while (true) {
    const key = takeKey();
    if (key === 'q' || key === 'escape') return 'quit';
    if (key === 's') return 'skip';

    const fresh = recentImages().filter((f) => !seen.has(f.path));

    for (const file of fresh) {
      // 아직 받는 중일 수 있다 — 크기가 멎을 때까지 기다린다
      if (!(await isSettled(file))) continue;

      if (!isPng(file.path)) {
        console.log(`   ${file.name} 은 PNG가 아닙니다. PNG로 받아 주세요.`);
        seen.add(file.path);
        continue;
      }
      // 기다림 표시를 지우고 결과 줄로 넘어간다
      if (interactive) process.stdout.write('\r' + ' '.repeat(60) + '\r');
      return { ...file, size: statSync(file.path).size };
    }

    /*
     * 오래 기다리면 어디를 보고 있는지 알려준다.
     * 다운로드 폴더가 다른 데로 잡혀 있으면 영문도 모르고 앉아 있게 된다.
     */
    const waited = ((tick + 1) * POLL_MS) / 1000;
    if (interactive) {
      const hint =
        waited > 45 ? `  (${inboxDirs().join(' , ')} 를 보고 있습니다)` : '';
      process.stdout.write(
        `\r   ${spin[tick++ % spin.length]} 기다리는 중${hint}`,
      );
    } else {
      tick++;
    }
    await sleep(POLL_MS);
  }
}

function finish(aborted) {
  if (interactive) {
    process.stdout.write('\r                    \r');
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }

  console.log(`\n${filled}장 넣었습니다.${aborted ? ' (중단)' : ''}`);

  const rest = pending.length - filled;
  if (rest > 0) console.log(`남은 자리 ${rest}개 — 다시 실행하면 이어서 합니다.`);

  const charGroups = [...new Set(pending.map((i) => i.group))].filter((g) => g !== 'scenes');
  if (filled && charGroups.length) {
    console.log('\n묶음을 시트 한 장으로 합치려면:');
    for (const g of charGroups) console.log(`  npm run sheet:merge -- ${CHARACTERS[g].key}`);
  }
  if (filled && pending.some((i) => i.group === 'scenes')) {
    console.log('\n배경·UI는 전처리가 필요 없습니다. 새로고침하면 바로 보입니다.');
  }

  process.exit(0);
}
