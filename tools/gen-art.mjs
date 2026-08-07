#!/usr/bin/env node
/**
 * 프롬프트 → 그림 → 제자리. 한 번에.
 *
 *   npm run art                  아직 없는 것 전부 (배경 5 + UI 6)
 *   npm run art -- scenes        배경·UI만
 *   npm run art -- gates         빌 게이츠맨 묶음 7장
 *   npm run art -- --all         스테이지·UI + 캐릭터 다섯 명 전부
 *   npm run art -- exchange --force   한 장만 다시
 *   npm run art -- --dry         뭘 만들지만 보여주고 끝
 *
 * ── 왜 만들었나 ────────────────────────────────────────────────────
 * 프롬프트 파일을 열어 복사하고, 웹에 붙여넣고, 기다리고, 내려받고, 이름을
 * 바꾸고, 맞는 폴더에 옮긴다. 한 장에 여섯 단계다. 배경·UI만 11장이고
 * 캐릭터 시트까지 하면 46장이니 270단계쯤 된다. 그중 다섯 단계는 기계가 해도
 * 결과가 같다 — 사람이 판단할 것은 "이 그림이 마음에 드는가" 하나뿐이다.
 *
 * 프롬프트는 gen-prompts.mjs 가 이미 파일로 만들어 뒀으므로, 이 도구는
 * 그 파일을 읽어 보내고 받아서 정해진 경로에 쓰는 일만 한다.
 * 프롬프트를 손보고 싶으면 art-scenes.mjs / art-characters.mjs 를 고치고
 * `npm run prompts` 를 다시 돌리면 된다 — 이 도구는 손댈 필요가 없다.
 *
 * 마음에 안 드는 것만 --force 로 다시 돌리면 되므로, 한 장씩 확인하며
 * 진행할 수 있다.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { PRICE_PER_IMAGE, loadEnvFile, resolveModel } from './gemini.mjs';
import {
  PROVIDERS,
  checkProvider,
  generate,
  resolveProvider,
} from './image-providers.mjs';
import { buildCatalog } from './art-catalog.mjs';
import { CHARACTERS } from './art-characters.mjs';

loadEnvFile();

/* ------------------------------------------------------------------ */
/* 무엇을 어디에 만드는가                                               */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* 인자 해석                                                            */
/* ------------------------------------------------------------------ */

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const picks = argv.filter((a) => !a.startsWith('--'));

const DRY = flags.has('--dry');
const FORCE = flags.has('--force');
const ALL = flags.has('--all');

const catalog = buildCatalog();

/** 이름 하나가 무엇을 가리키는가 — 묶음 이름(scenes·gates)이거나 낱장 id */
function select() {
  if (ALL) return catalog;
  if (picks.length === 0) return catalog.filter((i) => i.group === 'scenes');

  const out = [];
  for (const name of picks) {
    const hit = catalog.filter((i) => i.group === name || i.id === name);
    if (!hit.length) {
      console.error(
        `"${name}" 을(를) 찾지 못했습니다.\n` +
          `쓸 수 있는 이름: scenes, ${Object.keys(CHARACTERS).join(', ')}\n` +
          `또는 낱장 id: ${catalog.filter((i) => i.group === 'scenes').map((i) => i.id).join(', ')}`,
      );
      process.exit(1);
    }
    out.push(...hit);
  }
  // 같은 것을 두 번 적었어도 한 번만
  return [...new Map(out.map((i) => [i.id, i])).values()];
}

const selected = select();

/* 프롬프트 파일이 없으면 먼저 만들어야 한다 */
const missingPrompt = selected.filter((i) => !existsSync(i.prompt));
if (missingPrompt.length) {
  console.error(
    `프롬프트 파일이 없습니다 (${missingPrompt.length}개). 먼저 만들어 주세요:\n` +
      `  npm run prompts\n\n` +
      missingPrompt.slice(0, 5).map((i) => `  ${i.prompt}`).join('\n'),
  );
  process.exit(1);
}

/*
 * 이미 있는 그림은 건너뛴다.
 * 한 장씩 확인하며 진행할 때, 어제 마음에 들어 남겨둔 그림을 다시 돌려
 * 다른 그림으로 덮어쓰는 일이 없어야 한다. 다시 뽑고 싶으면 --force.
 */
const todo = FORCE ? selected : selected.filter((i) => !existsSync(i.out));
const skipped = selected.length - todo.length;

/* ------------------------------------------------------------------ */
/* 보여주기                                                            */
/* ------------------------------------------------------------------ */

const provider = resolveProvider();
const info = PROVIDERS[provider];
const model = resolveModel();
const price = info.free ? 0 : PRICE_PER_IMAGE[model];

console.log(`제공자: ${info.label}${provider === 'gemini' ? ` · ${model}` : ''}`);
if (info.free) console.log('무료 — 대신 느리고 가끔 실패합니다');
if (skipped) console.log(`이미 있어서 건너뜀: ${skipped}장 (다시 뽑으려면 --force)`);

/*
 * 캐릭터 시트를 무료 모델로 뽑으려 하면 미리 말린다.
 * 여섯 칸을 세고 일곱 묶음 내내 같은 인물을 유지하는 것은 그림 실력이 아니라
 * 지시를 따르는 능력이라, 글→그림 모델은 거의 실패한다.
 * 모르고 열네 장을 버리는 것보다 지금 한 줄 읽는 편이 싸다.
 */
if (!info.reference && todo.some((i) => i.group !== 'scenes')) {
  console.log(
    '\n주의: 캐릭터 시트는 "같은 인물 · 정확히 여섯 칸"을 지켜야 하는데\n' +
      `      ${info.label} 은(는) 참조 이미지를 못 받아 묶음마다 다른 사람이 나옵니다.\n` +
      '      배경·UI(scenes)에만 쓰시길 권합니다.\n',
  );
}

if (!todo.length) {
  console.log('만들 것이 없습니다.');
  process.exit(0);
}

console.log(`\n만들 것 ${todo.length}장:`);
for (const i of todo) console.log(`  ${i.label}\n    → ${i.out}`);

if (price) {
  console.log(`\n예상 비용: 약 $${(price * todo.length).toFixed(2)} (장당 $${price})`);
}

if (DRY) {
  console.log('\n--dry 라 여기까지만 합니다.');
  process.exit(0);
}

/* ------------------------------------------------------------------ */
/* 생성                                                                */
/* ------------------------------------------------------------------ */

checkProvider(provider);

let done = 0;
const failed = [];

/**
 * 캐릭터별 기준 그림 — 1번 묶음 결과를 들고 있다가 2~7번에 함께 보낸다.
 *
 * 글로만 시키면 묶음마다 다른 사람이 나온다. 옷 색이 바뀌고 무기가 사라지고
 * 얼굴이 딴사람이 된다. 그걸 이어 붙이면 시트가 아니라 여러 명이 번갈아
 * 나오는 애니메이션이 된다.
 */
const anchors = new Map();

/** 이미 뽑아 둔 1번 묶음이 있으면 그것을 기준으로 쓴다 (이어서 돌릴 때) */
const anchorFor = (item) => {
  if (!info.reference || item.group === 'scenes') return undefined;
  if (anchors.has(item.group)) return anchors.get(item.group);

  const first = catalog.find((i) => i.group === item.group && i.id.endsWith('-b1'));
  if (first && existsSync(first.out)) {
    const bytes = readFileSync(first.out);
    anchors.set(item.group, bytes);
    return bytes;
  }
  return undefined;
};

console.log('');
for (const item of todo) {
  const prompt = readFileSync(item.prompt, 'utf8');
  const reference = anchorFor(item);
  const mark = reference ? ' (기준 그림 참조)' : '';
  process.stdout.write(
    `[${done + failed.length + 1}/${todo.length}] ${item.label}${mark} … `,
  );

  try {
    const bytes = await generate(prompt, {
      provider,
      aspectRatio: item.ratio,
      reference,
    });

    mkdirSync(dirname(item.out), { recursive: true });
    writeFileSync(item.out, bytes);

    // 1번 묶음은 이 캐릭터의 기준이 된다 — 뒤 묶음들이 이 그림을 보고 그린다
    if (item.id.endsWith('-b1')) anchors.set(item.group, bytes);

    done++;
    console.log(`${(bytes.length / 1024).toFixed(0)}KB → ${item.out}`);
  } catch (err) {
    failed.push({ item, message: err.message });
    console.log('실패');
    console.log(`    ${err.message.split('\n').join('\n    ')}`);
  }
}

/* ------------------------------------------------------------------ */

console.log(`\n완료 ${done}장${failed.length ? ` · 실패 ${failed.length}장` : ''}`);

if (failed.length) {
  console.log('\n실패한 것만 다시 하려면:');
  console.log(`  npm run art -- ${failed.map((f) => f.item.id).join(' ')} --force`);
}

/* 캐릭터 묶음을 만들었으면 다음에 뭘 해야 하는지 알려준다 */
const charGroups = [...new Set(todo.map((i) => i.group))].filter((g) => g !== 'scenes');
if (done && charGroups.length) {
  console.log('\n묶음을 시트 한 장으로 합치려면:');
  for (const g of charGroups) {
    console.log(`  npm run sheet:merge -- ${CHARACTERS[g].key}`);
  }
}
if (done && todo.some((i) => i.group === 'scenes')) {
  console.log('\n배경·UI는 전처리가 필요 없습니다. 새로고침하면 바로 보입니다.');
}

process.exit(failed.length ? 1 : 0);
