#!/usr/bin/env node
/**
 * 받아 온 그림을 제자리에 넣는다. 이름 바꾸기·폴더 찾기 없이.
 *
 *   npm run art:in                남은 것부터 하나씩 (대화형)
 *   npm run art:in -- exchange    "증권 거래소" 자리에 넣는다
 *   npm run art:in -- gates       빌 게이츠맨 묶음을 1번부터 차례로
 *   npm run art:in -- --list      아직 안 넣은 자리 보기
 *
 * ── 무엇을 없애는가 ────────────────────────────────────────────────
 * 웹에서 그림을 받는 것까지는 사람이 해야 한다(그게 공짜니까). 그런데 그 뒤가
 * 진짜 번거롭다 — 내려받은 Gemini_Generated_Image_xxx.png 를 찾아서,
 * stage_exchange.png 로 이름을 바꾸고, public/bg 를 찾아 들어가 옮긴다.
 * 그림마다 이걸 반복하면 어느 순간 한 칸 밀려서 엉뚱한 자리에 들어간다.
 *
 * 이 도구는 "방금 받은 그림"을 찾아 정해진 이름으로 정해진 자리에 옮겨 준다.
 * 사람이 하는 일은 프롬프트를 붙여넣고 받기 버튼을 누르는 것까지다.
 *
 * 찾는 곳은 순서대로: ART_INBOX 환경변수 → art-source/inbox → 다운로드 폴더.
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
import { createInterface } from 'node:readline/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { buildCatalog } from './art-catalog.mjs';
import { CHARACTERS } from './art-characters.mjs';

/** 이미지로 볼 확장자 */
const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;
/** 이보다 오래된 파일은 "방금 받은 것"으로 보지 않는다 (시간) */
const RECENT_HOURS = 12;

/* ------------------------------------------------------------------ */
/* 받은 그림 찾기                                                       */
/* ------------------------------------------------------------------ */

function inboxDirs() {
  const dirs = [];
  if (process.env.ART_INBOX) dirs.push(process.env.ART_INBOX);
  dirs.push('art-source/inbox');

  const home = homedir();
  // 윈도우·맥·리눅스에서 브라우저가 기본으로 받는 곳
  dirs.push(join(home, 'Downloads'), join(home, '다운로드'));

  return dirs.filter((d) => existsSync(d));
}

/** 최근에 생긴 이미지 파일들을 새 것부터 */
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

/** PNG 인가 (게임이 읽는 경로가 .png 로 고정돼 있다) */
function isPng(path) {
  const head = readFileSync(path).subarray(0, 8);
  return head.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
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
  const done = slots.length - pending.length;
  console.log(`전체 ${slots.length}자리 · 채움 ${done} · 남음 ${pending.length}\n`);
  for (const i of slots) {
    console.log(`  ${existsSync(i.out) ? '✓' : ' '} ${i.id.padEnd(12)} ${i.label}`);
    console.log(`      ${i.out}`);
  }
  process.exit(0);
}

if (!pending.length) {
  console.log('빈 자리가 없습니다. 다시 넣으려면 --force');
  process.exit(0);
}

/* ------------------------------------------------------------------ */
/* 진행                                                                */
/* ------------------------------------------------------------------ */

console.log(`받은 그림을 찾는 곳: ${inboxDirs().join(' , ') || '(없음)'}`);
console.log(`채울 자리 ${pending.length}개\n`);

const rl = createInterface({ input: process.stdin, output: process.stdout });

/*
 * 입력이 끊기면(Ctrl+D, 파이프 끝) 물음이 영영 안 끝난다.
 * 그대로 두면 프로세스가 멈춘 채 남으므로, 끊김을 "끝내기"로 받는다.
 */
const closing = new AbortController();
rl.on('close', () => closing.abort());
const ask = (q) => rl.question(q, { signal: closing.signal }).catch(() => 'q');

/** 이번 실행에서 이미 쓴 파일 — 같은 것을 두 자리에 넣지 않는다 */
const used = new Set();
let filled = 0;

for (const slot of pending) {
  console.log(`── ${slot.label}`);
  console.log(`   프롬프트: ${slot.prompt}`);
  console.log(`   들어갈 곳: ${slot.out}`);

  let answer = '';
  while (true) {
    const candidates = recentImages().filter((f) => !used.has(f.path));
    const top = candidates[0];

    if (!top) {
      answer = await ask(
        '   받은 그림이 안 보입니다. 내려받고 엔터 (s=건너뛰기, q=끝내기) > ',
      );
    } else {
      answer = await ask(
        `   "${top.name}" (${ago(top.mtime)}, ${(top.size / 1024).toFixed(0)}KB)\n` +
          '   이걸 넣을까요? 엔터=넣기 (r=다시찾기, s=건너뛰기, q=끝내기) > ',
      );
    }

    const cmd = answer.trim().toLowerCase();
    if (cmd === 'q') {
      rl.close();
      console.log(`\n${filled}장 넣었습니다.`);
      process.exit(0);
    }
    if (cmd === 's') break;
    if (cmd === 'r' || !top) continue;

    if (!isPng(top.path)) {
      console.log('   PNG가 아닙니다. 나노바나나에서 PNG로 내려받아 주세요.\n');
      used.add(top.path);
      continue;
    }

    moveInto(top.path, slot.out, KEEP);
    used.add(top.path);
    filled++;
    console.log(`   → ${slot.out}\n`);
    break;
  }
}

rl.close();
console.log(`${filled}장 넣었습니다.`);

const charGroups = [...new Set(pending.map((i) => i.group))].filter((g) => g !== 'scenes');
if (filled && charGroups.length) {
  console.log('\n묶음을 시트 한 장으로 합치려면:');
  for (const g of charGroups) console.log(`  npm run sheet:merge -- ${CHARACTERS[g].key}`);
}
if (filled && pending.some((i) => i.group === 'scenes')) {
  console.log('\n배경·UI는 전처리가 필요 없습니다. 새로고침하면 바로 보입니다.');
}
