#!/usr/bin/env node
/**
 * 스프라이트 시트 자동 생성 (나노바나나 / Gemini 이미지 API)
 *
 * 프롬프트 작성 → 이미지 생성 → 배경 제거·크롭까지 한 번에 처리한다.
 * docs/art-spec.md 의 규격과 캐릭터별 무기·엽기 포인트가 코드로 들어가 있어
 * 매번 프롬프트를 다시 쓰지 않아도 된다.
 *
 * 준비 — https://aistudio.google.com/apikey 에서 키를 발급받아 둘 중 하나로 전달한다.
 *
 *   (A) 프로젝트 루트에 .env.local 파일 (권장)
 *         GEMINI_API_KEY=발급받은키
 *       .gitignore에 걸려 있어 커밋되지 않는다.
 *
 *   (B) 환경변수
 *         PowerShell:  $env:GEMINI_API_KEY = "발급받은키"
 *         bash:        export GEMINI_API_KEY=발급받은키
 *
 * 사용법:
 *   node tools/gen-sheet.mjs gates          # 생성 + 전처리까지
 *   node tools/gen-sheet.mjs gates --dry    # 프롬프트만 출력 (수동으로 붙여넣을 때)
 *   node tools/gen-sheet.mjs --all          # 5명 전부
 *
 * 결과물:
 *   art-source/<key>_sheet.png   원본 (출처 보관용 — 대회 제출 문서에 필요)
 *   public/sprites/<key>.png     게임에서 쓰는 시트
 *   public/sprites/<key>.json    프레임 규격
 *
 * 생성이 마음에 안 들면 그냥 다시 돌리면 된다. 같은 프롬프트라도 매번 다르게 나온다.
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

/**
 * .env.local 에서 키를 읽는다.
 *
 * 셸 환경변수는 터미널을 새로 열 때마다 다시 넣어야 하고,
 * 명령줄에 직접 적으면 키가 셸 기록에 남는다. 파일 쪽이 안전하다.
 * 의존성을 늘리지 않으려고 필요한 만큼만 직접 파싱한다.
 */
function loadEnvFile(file = '.env.local') {
  if (!existsSync(file)) return;

  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq < 0) continue;

    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    // 따옴표로 감싼 값 허용
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    // 이미 셸에 있는 값이 우선
    if (key && process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvFile();

/* ------------------------------------------------------------------ */
/* 캐릭터 정의 — 무기는 실제 전투 수치(리치·발동속도·위력)와 맞췄다      */
/* ------------------------------------------------------------------ */

const CHARACTERS = {
  gates: {
    key: 'billgates',
    name: '빌 게이츠',
    look: '파란 스웨터, 갈색 가르마 머리, 금테 둥근 안경',
    weapon:
      '지폐 뭉치를 철사로 감아 만든 거대한 해머를 어깨에 걸쳤다',
    wild:
      '안경 렌즈에 파란 블루스크린 오류 화면이 번쩍이고, 스웨터 주머니에서 지폐가 삐져나온다. 세상을 다 사버린 듯한 능글맞은 미소',
  },
  jobs: {
    key: 'stevejobs',
    name: '스티브 잡스',
    look: '검은 터틀넥, 청바지, 회색 수염, 검은 둥근 안경',
    weapon:
      '흰 알루미늄 손잡이에서 무지개빛 광선 칼날이 뻗어 나오는 광선검',
    wild:
      '몸 뒤로 후광이 비치고, 눈은 광신도처럼 번뜩인다. 배경에 무지개 사과 잔상',
  },
  musk: {
    key: 'elonmusk',
    name: '일론 머스크',
    look: '빨간 티셔츠, 짧고 뒤로 넘긴 짙은 갈색 머리',
    weapon: '양손에 작은 로켓이 장전된 쌍권총',
    wild:
      '등에 부스터를 매달고 불꽃을 뿜는다. 두 눈이 도지코인 모양이고 항상 씩 웃고 있다',
  },
  linus: {
    key: 'linustorvalds',
    name: '리누스 토발즈',
    look: '회색 후드티, 부스스한 갈색 머리, 갈색 수염, 사각 안경',
    weapon: '자기 키만 한 거대한 양손 대검, 칼날에 초록 터미널 글자가 흐른다',
    wild: '펭귄 모자를 쓰고 잔뜩 인상 쓴 채 이빨을 드러낸다',
  },
  pepe: {
    key: 'pepe',
    name: '개구리 페페 밈 캐릭터',
    look: '초록 피부, 빨간 입술',
    weapon: '자기 몸보다 큰 양날 대형 도끼',
    wild:
      '완전한 개구리 얼굴. 얼굴을 가로지르는 거대한 입, 툭 튀어나온 흰 눈알',
  },
};

/* ------------------------------------------------------------------ */
/* 프롬프트 — docs/art-spec.md 와 같은 규격                            */
/* ------------------------------------------------------------------ */

function buildPrompt(c) {
  return `2D 대전 격투 게임용 스프라이트 시트를 만들어줘.

[캐릭터] ${c.name}을(를) 극단적으로 과장한 SD 도트 캐릭터.
${c.look}
무기: ${c.weapon}
${c.wild}

[아트 스타일 — 가장 중요]
- 2~2.5등신. 머리가 몸 전체만큼 크게. 실사 비율 절대 금지
- 표정을 극단적으로 과장할 것 (부릅뜬 눈, 드러낸 이빨, 광기)
- 굵고 진한 검은 외곽선. 어두운 배경에서 실루엣이 확실히 분리될 것
- 채도 높고 대비 강한 색
- 액션 프레임은 만화처럼 과장 (늘어난 팔다리, 스피드선, 임팩트)
- 귀엽고 얌전한 캐리커처가 아니라, 시끄럽고 우스꽝스러운 게임 캐릭터

[필수 규칙]
- 배경: 순수 마젠타 #FF00FF 단색. 캐릭터에는 이 색을 절대 쓰지 말 것
- 글자 금지: 프레임 이름/라벨/워터마크를 이미지에 넣지 말 것
- 3행 x 5열 격자. 프레임 사이 간격은 캐릭터 폭의 20% 이상 확보
- 모든 프레임에서 캐릭터가 오른쪽을 향할 것
- 모든 프레임 크기·비율 동일, 발끝을 같은 높이에 맞출 것
- 이펙트가 옆 프레임을 침범하지 않게 할 것
- 무기를 들지 않은 손은 비워두고, 손목 높이를 프레임마다 일정하게 유지

[프레임 15개, 이 순서로]
1행: IDLE(대기), WALK(걷기), RUN-A(달리기1), RUN-B(달리기2), JUMP(점프)
2행: ATTACK_J(짧은 견제 공격), ATTACK_K(크게 휘두르는 강공격, 궤적 잔상),
     SKILL_L(무기가 빛나며 기 모으기), SKILL_L2(방출된 에너지 이펙트만, 캐릭터 없이),
     HIT(피격)
3행: KNOCKBACK(날아감), GUARD(무기를 세워 막기), DASH(질주),
     WIN(무기를 치켜든 승리), LOSE(무기를 떨어뜨린 패배)`;
}

/* ------------------------------------------------------------------ */
/* Gemini 이미지 API                                                   */
/* ------------------------------------------------------------------ */

const MODEL = process.env.GEMINI_IMAGE_MODEL ?? 'gemini-3.1-flash-image';
const API = 'https://generativelanguage.googleapis.com/v1beta';

/** 응답에서 base64 이미지를 꺼낸다 (엔드포인트별 형식 차이를 흡수) */
function extractImage(json) {
  // interactions 형식: steps[].content[].data
  for (const step of json.steps ?? []) {
    for (const part of step.content ?? []) {
      if (part.type === 'image' && part.data) return part.data;
    }
  }
  if (json.output_image?.data) return json.output_image.data;

  // generateContent 형식: candidates[].content.parts[].inlineData.data
  for (const cand of json.candidates ?? []) {
    for (const part of cand.content?.parts ?? []) {
      if (part.inlineData?.data) return part.inlineData.data;
      if (part.inline_data?.data) return part.inline_data.data;
    }
  }
  return null;
}

async function generate(prompt, apiKey) {
  const res = await fetch(`${API}/interactions`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      input: [{ type: 'text', text: prompt }],
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`API ${res.status}\n${text.slice(0, 600)}`);
  }

  const json = JSON.parse(text);
  const b64 = extractImage(json);
  if (!b64) {
    throw new Error(
      `응답에서 이미지를 찾지 못했습니다.\n${JSON.stringify(json).slice(0, 600)}`,
    );
  }
  return Buffer.from(b64, 'base64');
}

/* ------------------------------------------------------------------ */

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const all = args.includes('--all');
const ids = all
  ? Object.keys(CHARACTERS)
  : args.filter((a) => !a.startsWith('--'));

if (!ids.length) {
  console.error(
    `사용법: node tools/gen-sheet.mjs <${Object.keys(CHARACTERS).join('|')}> [--dry]\n` +
      `        node tools/gen-sheet.mjs --all`,
  );
  process.exit(1);
}

const apiKey = process.env.GEMINI_API_KEY;
if (!dry && !apiKey) {
  console.error(
    'GEMINI_API_KEY 가 없습니다.\n\n' +
      '  1) https://aistudio.google.com/apikey 에서 키 발급\n' +
      '  2) 프로젝트 루트에 .env.local 파일을 만들고 아래 한 줄:\n' +
      '       GEMINI_API_KEY=발급받은키\n\n' +
      '  (.gitignore에 걸려 있어 커밋되지 않습니다)\n\n' +
      '키 없이 프롬프트만 보려면 --dry 를 붙이세요.',
  );
  process.exit(1);
}

mkdirSync('art-source', { recursive: true });
let failed = 0;

for (const id of ids) {
  const c = CHARACTERS[id];
  if (!c) {
    console.error(`알 수 없는 캐릭터: ${id}`);
    failed++;
    continue;
  }

  const prompt = buildPrompt(c);

  if (dry) {
    console.log(`\n${'='.repeat(60)}\n${id} (${c.name})\n${'='.repeat(60)}`);
    console.log(prompt);
    continue;
  }

  const raw = `art-source/${c.key}_sheet.png`;
  const out = `public/sprites/${c.key}.png`;

  try {
    console.log(`\n[${id}] 생성 중… (모델 ${MODEL})`);
    const png = await generate(prompt, apiKey);
    writeFileSync(raw, png);
    console.log(`  원본 저장: ${raw} (${(png.length / 1024 / 1024).toFixed(1)}MB)`);

    console.log(`  전처리 중…`);
    const r = spawnSync(process.execPath, ['tools/process-sheet.mjs', raw, out], {
      stdio: 'inherit',
    });
    if (r.status !== 0) throw new Error('전처리 실패');

    console.log(`  완료: ${out}`);
    if (!existsSync(out)) throw new Error('출력 파일이 없습니다');
  } catch (err) {
    console.error(`  [${id}] 실패: ${err instanceof Error ? err.message : err}`);
    failed++;
  }
}

if (!dry && ids.length) {
  console.log(
    `\n다음 단계: 전처리 로그의 프레임 순서를 보고\n` +
      `src/config/spriteSheets.ts 의 poses 에 매핑하세요.\n` +
      `(자세한 절차는 docs/art-spec.md)`,
  );
}

process.exit(failed ? 1 : 0);
