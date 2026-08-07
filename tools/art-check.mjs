#!/usr/bin/env node
/**
 * 아트 검수 — 넣은 그림이 게임에 제대로 붙었는지 확인한다.
 *
 *   npm run art:check              전원 진행표 + 문제 목록 + 검수 페이지
 *   npm run art:check -- whale     한 명만 자세히
 *   npm run art:check -- --fix     고칠 수 있는 것은 고친다 (다시 합치기·webp 갱신)
 *
 * ── 왜 필요한가 ────────────────────────────────────────────────────
 * 그림을 넣고 나면 확인할 방법이 게임을 켜서 그 캐릭터를 골라 스무 개 기술을
 * 하나씩 눌러 보는 것뿐이었다. 스무 명이면 그걸 스무 번 한다.
 *
 * 그리고 실제로 어긋나는 방식은 대부분 눈에 안 띈다.
 *
 *   · 생성기가 6칸 대신 5칸을 그렸다 → 그 묶음부터 **한 칸씩 밀린다**.
 *     걷기 자리에 대기 그림이 오고, 마지막 칸은 빈다.
 *   · 새 PNG를 넣었는데 낡은 webp가 남아 있다 → 게임은 **옛 그림을 쓴다**.
 *     파일은 분명히 새것인데 화면은 그대로다. 원인을 찾는 데 한참 걸린다.
 *   · 묶음을 다시 뽑고 합치기를 안 했다 → 소스만 새것이고 시트는 옛것이다.
 *
 * 셋 다 "그림이 이상하다"가 아니라 "게임이 고장났다"로 보인다.
 * 파일 시각과 픽셀을 보면 전부 기계가 판별할 수 있는 것들이다.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { PNG } from 'pngjs';
import { BATCHES, FRAME_LABELS } from './art-characters.mjs';

/* ------------------------------------------------------------------ */
/* 무엇을 검사할 것인가                                                 */
/* ------------------------------------------------------------------ */

const SRC = 'art-source';
const OUT = 'public/sprites';
/** 검수 페이지가 저장되는 곳 */
const PAGE = 'art-source/check.html';

/** 불투명 픽셀이 이 비율보다 적으면 빈 칸으로 본다 */
const EMPTY_RATIO = 0.005;
/**
 * 칸 안의 그림이 칸 높이의 이만큼도 안 되면 "너무 작다"로 본다.
 *
 * 생성기가 칸 수를 틀리면 process-sheet 가 엉뚱한 자리에서 칸을 나눠
 * 캐릭터가 반쯤 잘리거나 구석에 몰린다. 크기로 그걸 잡아낼 수 있다.
 */
const TINY_RATIO = 0.4;

const args = process.argv.slice(2);
const FIX = args.includes('--fix');
const only = args.find((a) => !a.startsWith('--'));

/* ------------------------------------------------------------------ */
/* 캐릭터 목록 — spriteSheets.ts 가 유일한 근거다                       */
/* ------------------------------------------------------------------ */

/**
 * 등록된 캐릭터와 시트 키를 코드에서 그대로 읽는다.
 *
 * 도구가 따로 목록을 갖고 있으면 캐릭터를 추가할 때 두 군데를 고쳐야 하고,
 * 한쪽을 잊으면 "검수는 통과했는데 게임에는 안 붙은" 상태가 된다.
 */
function readSheetKeys() {
  const src = readFileSync('src/config/spriteSheets.ts', 'utf8');
  const body = src.slice(src.indexOf('export const SPRITE_SHEETS'));
  const out = [];
  const re = /(\w+):\s*\{[^}]*?key:\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(body))) out.push({ id: m[1], key: m[2] });
  return out;
}

/** 캐릭터 한글 이름 — 표에 코드 이름만 뜨면 누구인지 알아보기 어렵다 */
function readNames() {
  const names = {};
  for (const file of readdirSync('src/config/characters')) {
    if (file === 'index.ts') continue;
    const src = readFileSync(`src/config/characters/${file}`, 'utf8');
    const id = /id:\s*'([^']+)'/.exec(src)?.[1];
    const name = /name:\s*'([^']+)'/.exec(src)?.[1];
    if (id && name) names[id] = name;
  }
  return names;
}

/* ------------------------------------------------------------------ */
/* 한 캐릭터의 현재 상태                                                */
/* ------------------------------------------------------------------ */

const mtime = (p) => (existsSync(p) ? statSync(p).mtimeMs : 0);

function inspect({ id, key }) {
  const state = { id, key, batches: [], problems: [], notes: [] };

  /* 받은 묶음 — art-source/<key>_b<N>.png */
  for (let i = 1; i <= 7; i++) {
    const path = `${SRC}/${key}_b${i}.png`;
    if (existsSync(path)) state.batches.push({ index: i, path, at: mtime(path) });
  }

  const sheetPng = `${OUT}/${key}.png`;
  const sheetJson = `${OUT}/${key}.json`;
  const sheetWebp = `${OUT}/${key}.webp`;

  state.hasSheet = existsSync(sheetPng) && existsSync(sheetJson);
  if (!state.hasSheet) {
    if (state.batches.length) {
      state.problems.push({
        level: 'todo',
        text: `묶음 ${state.batches.length}개가 있는데 시트가 없습니다`,
        fix: ['sheet:merge', key],
      });
    }
    return state;
  }

  state.meta = JSON.parse(readFileSync(sheetJson, 'utf8'));
  state.sheetAt = mtime(sheetPng);

  /* 소스가 시트보다 새로우면 다시 합쳐야 한다 */
  const newer = state.batches.filter((b) => b.at > state.sheetAt);
  if (newer.length) {
    state.problems.push({
      level: 'stale',
      text: `묶음 ${newer.map((b) => `b${b.index}`).join(', ')} 을 다시 뽑았는데 합치지 않았습니다`,
      fix: ['sheet:merge', key],
    });
  }

  /*
   * webp 가 낡았다 — 이것이 가장 위험하다.
   *
   * 게임은 가벼운 webp 를 먼저 집는다(artAssets.ts). 새 PNG 를 넣어도
   * 낡은 webp 가 남아 있으면 화면은 그대로다. 파일은 새것인데 그림이
   * 안 바뀌니 원인이 코드에 있다고 착각하게 된다.
   */
  if (existsSync(sheetWebp) && mtime(sheetWebp) < state.sheetAt) {
    state.problems.push({
      level: 'stale',
      text: 'webp 가 낡았습니다 — 게임은 아직 옛 그림을 씁니다',
      fix: ['art:opt'],
    });
  }

  /* 시트가 어느 묶음을 담았다고 말하는가 */
  state.declared = state.meta.batches ?? null;

  /*
   * 묶음당 6칸인가 — 이것이 가장 자주, 가장 조용히 어긋난다.
   *
   * 생성기가 6칸을 그리라고 해도 5칸이나 7칸을 그릴 때가 있다. 그러면
   * 그 묶음부터 **포즈가 통째로 한 칸씩 밀린다** — 걷기 자리에 대기 그림이
   * 오고, 마지막 포즈는 빈다. 그림 자체는 멀쩡해서 눈으로는 잘 안 보이고,
   * 게임에서는 "이 캐릭터만 동작이 이상하다"로 나타난다.
   */
  if (state.declared) {
    const counts = state.meta.batchCounts;
    const off = counts
      ? Object.entries(counts).filter(([, n]) => n !== 6)
      : state.meta.count === state.declared.length * 6
        ? []
        : [['?', state.meta.count]];

    if (off.length) {
      state.problems.push({
        level: 'broken',
        text: counts
          ? `묶음당 6칸이 아닙니다 — ${off.map(([b, n]) => `b${b}(${n}칸)`).join(', ')}`
          : `묶음 ${state.declared.length}개면 ${state.declared.length * 6}칸이어야 하는데 ${state.meta.count}칸입니다`,
        hint: '그 묶음부터 포즈가 한 칸씩 밀립니다. 해당 묶음만 다시 뽑아 합치세요',
      });
    }
  }
  if (state.declared && state.batches.length) {
    const have = state.batches.map((b) => b.index).join(',');
    if (state.declared.join(',') !== have) {
      state.notes.push(`시트에 적힌 묶음(${state.declared.join(', ')})과 소스(${have})가 다릅니다`);
    }
  }

  analyseFrames(state, sheetPng);
  return state;
}

/* ------------------------------------------------------------------ */
/* 픽셀 검사 — 칸이 비었는가, 밀렸는가                                  */
/* ------------------------------------------------------------------ */

/**
 * 칸마다 내용물의 크기를 잰다.
 *
 * 빈 칸과 지나치게 작은 칸을 찾는 것이 목적이다. 둘 다 원인은 대개 하나 —
 * 생성기가 6칸을 안 그려서 칸 나누기가 밀린 것이다. 그 묶음만 다시 뽑으면
 * 되는데, 게임을 켜서는 "이 기술만 이상하다"까지밖에 못 본다.
 */
function analyseFrames(state, sheetPng) {
  const png = PNG.sync.read(readFileSync(sheetPng));
  const { frameWidth: fw, frameHeight: fh, columns, count } = state.meta;

  state.frames = [];
  for (let i = 0; i < count; i++) {
    const x0 = (i % columns) * fw;
    const y0 = Math.floor(i / columns) * fh;

    let opaque = 0;
    let minY = fh;
    let maxY = -1;
    let minX = fw;
    let maxX = -1;

    for (let y = 0; y < fh; y++) {
      for (let x = 0; x < fw; x++) {
        const a = png.data[((y0 + y) * png.width + (x0 + x)) * 4 + 3];
        if (a < 40) continue;
        opaque++;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }

    const ratio = opaque / (fw * fh);
    state.frames.push({
      index: i,
      pose: poseOf(state, i),
      ratio,
      height: maxY < 0 ? 0 : (maxY - minY + 1) / fh,
      width: maxX < 0 ? 0 : (maxX - minX + 1) / fw,
    });
  }

  const empty = state.frames.filter((f) => f.ratio < EMPTY_RATIO);
  const tiny = state.frames.filter(
    (f) => f.ratio >= EMPTY_RATIO && f.height < TINY_RATIO,
  );

  if (empty.length) {
    state.problems.push({
      level: 'broken',
      text: `빈 칸 ${empty.length}개 — ${empty.map((f) => f.pose).join(', ')}`,
      hint: batchHint(state, empty),
    });
  }
  if (tiny.length) {
    state.problems.push({
      level: 'warn',
      text: `너무 작게 들어간 칸 ${tiny.length}개 — ${tiny.map((f) => f.pose).join(', ')}`,
      hint: batchHint(state, tiny),
    });
  }
}

/** 문제가 난 칸들이 어느 묶음인지 알려준다 — 그 묶음만 다시 뽑으면 된다 */
function batchHint(state, frames) {
  const batches = state.declared ?? [1, 2, 3, 4, 5, 6, 7];
  const hit = new Set();
  for (const f of frames) hit.add(batches[Math.floor(f.index / 6)]);
  const list = [...hit].filter(Boolean);
  if (!list.length) return null;
  return `${list.map((b) => `b${b}`).join(', ')} 묶음을 다시 뽑으세요`;
}

/**
 * 규격이 정해지기 전에 뽑은 15칸 시트(V1)의 칸 이름.
 * 지금 규격과 순서가 아예 다르므로 따로 둔다 — 여기서 헷갈리면
 * 멀쩡한 시트를 "칸이 밀렸다"고 잘못 읽는다.
 */
const V1_LABELS = [
  'IDLE', 'WALK', 'RUN_A', 'RUN_B', 'JUMP',
  'ATTACK_J', 'ATTACK_K', 'SKILL_L', 'SKILL_FX', 'HIT',
  'KNOCKBACK', 'GUARD', 'DASH', 'WIN', 'LOSE',
];

/** 프레임 번호 → 포즈 이름 (시트가 담았다고 말한 묶음 순서를 따른다) */
function poseOf(state, frame) {
  // 묶음을 안 밝히고 15칸이면 옛 규격이다
  if (!state.declared && state.meta.count <= 15) {
    return V1_LABELS[frame] ?? `#${frame}`;
  }
  const batches = state.declared ?? BATCHES.map((b) => b.id);
  const batch = batches[Math.floor(frame / 6)];
  const def = BATCHES.find((b) => b.id === batch);
  if (!def) return `#${frame}`;
  return FRAME_LABELS[def.keys[frame % 6]] ?? `#${frame}`;
}

/* ------------------------------------------------------------------ */
/* 표 출력                                                              */
/* ------------------------------------------------------------------ */

const pad = (s, n) => {
  // 한글은 폭이 두 배라 글자 수로 맞추면 표가 어긋난다
  const w = [...String(s)].reduce((n2, c) => n2 + (c.charCodeAt(0) > 0x2e80 ? 2 : 1), 0);
  return String(s) + ' '.repeat(Math.max(0, n - w));
};

function printTable(states, names) {
  console.log(
    `\n${pad('캐릭터', 16)}${pad('묶음 1234567', 14)}${pad('시트', 12)}${pad('상태', 10)}`,
  );
  console.log('─'.repeat(56));

  for (const s of states) {
    const have = new Set(s.batches.map((b) => b.index));
    const grid = [1, 2, 3, 4, 5, 6, 7].map((i) => (have.has(i) ? '●' : '·')).join('');

    const sheet = s.hasSheet ? `${s.meta.count}칸` : '—';
    const worst = s.problems[0]?.level;
    const mark =
      worst === 'broken'
        ? '✗ 깨짐'
        : worst === 'stale'
          ? '! 낡음'
          : worst === 'warn'
            ? '△ 확인'
            : worst === 'todo'
              ? '· 합치기'
              : s.hasSheet
                ? '✓'
                : '· 도형';

    console.log(
      `${pad(names[s.id] ?? s.id, 16)}${pad(grid, 14)}${pad(sheet, 12)}${mark}`,
    );
  }
}

/* ------------------------------------------------------------------ */
/* 검수 페이지 — 눈으로 봐야 아는 것들                                  */
/* ------------------------------------------------------------------ */

/**
 * 시트를 칸마다 잘라 포즈 이름과 함께 늘어놓은 페이지를 만든다.
 *
 * 기계가 잡을 수 있는 것은 "비었다·작다"까지다. 걷기 자리에 대기 그림이
 * 들어간 것이나 왼쪽을 보고 있는 것은 사람이 봐야 안다. 게임을 켜고
 * 그 캐릭터를 골라 기술을 하나씩 눌러 보는 대신, 이 페이지 한 장을 본다.
 */
function writePage(states, names) {
  const cards = states
    .filter((s) => s.hasSheet)
    .map((s) => {
      const { frameWidth: fw, frameHeight: fh, columns } = s.meta;
      // 칸이 커서 그대로 늘어놓으면 한 화면에 안 들어온다
      const scale = Math.min(1, 120 / fw, 150 / fh);

      const cells = s.frames
        .map((f) => {
          const x = -(f.index % columns) * fw * scale;
          const y = -Math.floor(f.index / columns) * fh * scale;
          const bad = f.ratio < EMPTY_RATIO;
          const warn = !bad && f.height < TINY_RATIO;
          return `<figure class="${bad ? 'bad' : warn ? 'warn' : ''}">
  <div class="f" style="width:${fw * scale}px;height:${fh * scale}px;
    background-image:url(../${OUT}/${s.key}.png);
    background-size:${s.meta.columns * fw * scale}px ${s.meta.rows * fh * scale}px;
    background-position:${x}px ${y}px"></div>
  <figcaption>${f.pose}</figcaption>
</figure>`;
        })
        .join('\n');

      const issues = s.problems
        .map((p) => `<li class="${p.level}">${p.text}${p.hint ? ` — ${p.hint}` : ''}</li>`)
        .join('');

      return `<section>
  <h2>${names[s.id] ?? s.id} <small>${s.key} · ${s.meta.count}칸 · ${
    s.declared
      ? `묶음 ${s.declared.join(', ')}`
      : s.meta.count <= 15
        ? '옛 규격(V1) — 다시 뽑으면 42칸 규격으로 갈린다'
        : '묶음 전체'
  }</small></h2>
  ${issues ? `<ul class="issues">${issues}</ul>` : ''}
  <div class="grid">${cells}</div>
</section>`;
    })
    .join('\n');

  const html = `<!doctype html>
<meta charset="utf-8">
<title>아트 검수 — 상장폐지 대난투</title>
<style>
  body { background:#0b1020; color:#e8eeff; font-family:"Malgun Gothic",sans-serif; margin:24px }
  h1 { font-size:20px }
  h2 { font-size:17px; margin:28px 0 8px; border-bottom:1px solid #24305a; padding-bottom:6px }
  small { color:#6c86c4; font-weight:normal; font-size:13px }
  .grid { display:flex; flex-wrap:wrap; gap:6px }
  figure { margin:0; text-align:center }
  .f { background-repeat:no-repeat; border:1px solid #24305a; border-radius:4px;
       image-rendering:pixelated;
       /* 어두운 배경에 어두운 캐릭터가 묻히지 않게 격자를 깐다 */
       background-color:#1b2440 }
  figcaption { font-size:10px; color:#8fa6d8; margin-top:2px }
  .bad .f { border-color:#ef4444; background-color:#3b1414 }
  .warn .f { border-color:#facc15 }
  .issues { margin:0 0 10px; padding-left:18px; font-size:14px }
  .issues .broken { color:#ef4444 }
  .issues .stale { color:#fb923c }
  .issues .warn { color:#facc15 }
  .issues .todo { color:#8fa6d8 }
</style>
<h1>아트 검수 <small>붉은 칸 = 비었음 · 노란 칸 = 너무 작음</small></h1>
${cards || '<p>아직 합친 시트가 없습니다.</p>'}
`;

  mkdirSync('art-source', { recursive: true });
  writeFileSync(PAGE, html);
}

/* ------------------------------------------------------------------ */
/* 고칠 수 있는 것은 고친다                                             */
/* ------------------------------------------------------------------ */

/**
 * --fix 로 자동 처리하는 것은 **판단이 필요 없는 것**뿐이다.
 * 다시 합치기와 webp 갱신은 결과가 하나로 정해져 있어 물어볼 것이 없다.
 * 그림이 마음에 드는가는 사람만 답할 수 있으므로 건드리지 않는다.
 */
function autoFix(states) {
  const merge = new Set();
  let needOpt = false;

  for (const s of states) {
    for (const p of s.problems) {
      if (p.fix?.[0] === 'sheet:merge') merge.add(p.fix[1]);
      if (p.fix?.[0] === 'art:opt') needOpt = true;
    }
  }

  for (const key of merge) {
    console.log(`\n▶ 다시 합칩니다 — ${key}`);
    const r = spawnSync(process.execPath, ['tools/merge-sheets.mjs', key], {
      stdio: 'inherit',
    });
    if (r.status === 0) needOpt = true;
  }

  if (needOpt) {
    console.log('\n▶ webp 갱신');
    spawnSync(process.execPath, ['tools/optimize-art.mjs'], { stdio: 'inherit' });
  }

  return merge.size > 0 || needOpt;
}

/* ------------------------------------------------------------------ */

const names = readNames();
let sheets = readSheetKeys();
if (only) {
  sheets = sheets.filter((s) => s.id === only || s.key === only);
  if (!sheets.length) {
    console.error(`"${only}" 를 찾지 못했습니다. (예: whale, whaleinvestor)`);
    process.exit(1);
  }
}

let states = sheets.map(inspect);

if (FIX && autoFix(states)) {
  console.log('\n다시 검사합니다.\n');
  states = sheets.map(inspect);
}

printTable(states, names);
writePage(states, names);

/* --- 요약 ----------------------------------------------------------- */

const withSheet = states.filter((s) => s.hasSheet);
const problems = states.flatMap((s) =>
  s.problems.map((p) => ({ ...p, who: names[s.id] ?? s.id })),
);
const notes = states.flatMap((s) => s.notes.map((t) => ({ text: t, who: names[s.id] ?? s.id })));

console.log(
  `\n시트 ${withSheet.length}/${states.length}명` +
    `  ·  받은 묶음 ${states.reduce((n, s) => n + s.batches.length, 0)}/${states.length * 7}장`,
);

if (problems.length) {
  console.log('\n손볼 것');
  for (const p of problems) {
    console.log(`  ${p.level === 'broken' ? '✗' : p.level === 'stale' ? '!' : '·'} ${p.who} — ${p.text}`);
    if (p.hint) console.log(`      ${p.hint}`);
  }
  const auto = problems.filter((p) => p.fix).length;
  if (auto && !FIX) console.log(`\n  ${auto}건은 자동으로 됩니다 — npm run art:check -- --fix`);
} else if (withSheet.length) {
  console.log('\n문제 없음 — 넣은 그림이 전부 제자리에 붙어 있습니다.');
}

if (notes.length) {
  console.log('\n참고');
  for (const n of notes) console.log(`  · ${n.who} — ${n.text}`);
}

console.log(`\n검수 페이지: ${PAGE}  (브라우저로 열면 칸마다 포즈 이름이 붙어 있습니다)`);
