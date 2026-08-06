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
import {
  PRICE_PER_IMAGE,
  generateImage,
  loadEnvFile,
  requireApiKey,
  resolveModel,
} from './gemini.mjs';
import { STAGES, UI_ARTS } from './art-scenes.mjs';
import { BATCHES, CHARACTERS } from './art-characters.mjs';

loadEnvFile();

/* ------------------------------------------------------------------ */
/* 무엇을 어디에 만드는가                                               */
/* ------------------------------------------------------------------ */

/**
 * 비율은 프롬프트 글로도 적혀 있지만, 모델이 받아주면 지정하는 쪽이 훨씬 잘 맞는다.
 * 지원하지 않는 모델이면 gemini.mjs 가 알아서 빼고 다시 건다.
 */
const RATIO = {
  stage: '21:9', // 월드가 1920x720(8:3)이라 가장 가까운 표준 비율
  bg: '16:9',
  logo: '21:9', // 3:1 로고. 표준 비율 중 가장 가로로 긴 것
  strip: '21:9', // 가로로 이어 붙인 칸 (아이콘 6칸 · 오브 4칸 · 캐릭터 6칸)
};

/** 만들 수 있는 것 전체 목록 */
function buildCatalog() {
  const items = [];

  for (const st of STAGES) {
    items.push({
      id: st.id,
      group: 'scenes',
      label: `배경 · ${st.name}`,
      prompt: `art-source/prompts/scenes/${st.id}-${st.name}.txt`,
      out: `public/bg/${st.key}.png`,
      ratio: RATIO.stage,
    });
  }

  for (const ui of UI_ARTS) {
    items.push({
      id: ui.id,
      group: 'scenes',
      label: `UI · ${ui.name}`,
      prompt: `art-source/prompts/scenes/${ui.id}-${ui.name}.txt`,
      out: `public/ui/${ui.key}.png`,
      ratio: ui.kind === 'logo' ? RATIO.logo : ui.kind === 'sheet' ? RATIO.strip : RATIO.bg,
    });
  }

  for (const [charId, c] of Object.entries(CHARACTERS)) {
    for (const b of BATCHES) {
      items.push({
        id: `${charId}-b${b.id}`,
        group: charId,
        label: `${c.inGameName} · ${b.id}묶음 ${b.title}`,
        prompt: `art-source/prompts/${charId}/${b.id}-${b.title}.txt`,
        // merge-sheets 가 찾는 이름 그대로 (art-source/<key>_b<n>.png)
        out: `art-source/${c.key}_b${b.id}.png`,
        ratio: RATIO.strip,
      });
    }
  }

  return items;
}

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

const model = resolveModel();
const price = PRICE_PER_IMAGE[model];

console.log(`모델: ${model}`);
if (skipped) console.log(`이미 있어서 건너뜀: ${skipped}장 (다시 뽑으려면 --force)`);

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

const apiKey = requireApiKey();

let done = 0;
const failed = [];

console.log('');
for (const item of todo) {
  const prompt = readFileSync(item.prompt, 'utf8');
  process.stdout.write(`[${done + failed.length + 1}/${todo.length}] ${item.label} … `);

  try {
    const bytes = await generateImage(prompt, {
      apiKey,
      model,
      aspectRatio: item.ratio,
    });

    mkdirSync(dirname(item.out), { recursive: true });
    writeFileSync(item.out, bytes);
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
