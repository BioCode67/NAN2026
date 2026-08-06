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
 *   node tools/gen-sheet.mjs gates --save   # 프롬프트를 파일로 저장 (웹 UI에 붙여넣을 때)
 *   node tools/gen-sheet.mjs --all          # 5명 전부
 *
 * 결과물:
 *   art-source/<key>_sheet.png   원본 (출처 보관용 — 대회 제출 문서에 필요)
 *   art-source/<key>_prompt.txt  프롬프트 (--save 일 때)
 *   public/sprites/<key>.png     게임에서 쓰는 시트
 *   public/sprites/<key>.json    프레임 규격
 *
 * 생성이 마음에 안 들면 그냥 다시 돌리면 된다. 같은 프롬프트라도 매번 다르게 나온다.
 *
 * ── 양식에 대하여 ─────────────────────────────────────────────────
 * 프롬프트는 "고정 뼈대 + 캐릭터별 빈칸"으로 되어 있다.
 * 아트 스타일·격자 규격·프레임 순서는 전 캐릭터가 글자 하나까지 동일하고,
 * 아래 CHARACTERS 표의 항목만 갈아 끼우면 같은 화풍의 시트가 찍혀 나온다.
 * 캐릭터를 늘릴 때 손댈 곳은 그 표 하나뿐이다.
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { generateImage, loadEnvFile, resolveModel } from './gemini.mjs';

/**
 * 받침 유무에 맞는 목적격 조사를 고른다.
 * "일론 머스크을(를)" 같은 표기를 그대로 보내면 생성기가 괄호를 글자로
 * 그려 넣는 일이 실제로 있다.
 */
function objectParticle(word) {
  const code = word.trim().slice(-1).charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return '를';
  return (code - 0xac00) % 28 === 0 ? '를' : '을';
}

loadEnvFile();

/* ------------------------------------------------------------------ */
/* 캐릭터 정의 — 여기만 갈아 끼우면 같은 양식으로 시트가 찍혀 나온다     */
/* ------------------------------------------------------------------ */

/*
 * moves 의 키는 src/config/characters.ts 의 커맨드 슬롯과 1:1로 대응한다.
 * 그림과 게임 안 기술이 어긋나면 "왜 이 모션에서 이 판정이 나오지?"가 되므로,
 * 기술 이름을 바꿀 때는 반드시 양쪽을 함께 고친다.
 *
 *   j2     = J J 연속기 2타  (1타에서 이어지는 반대 손)
 *   j3     = J J J 마무리    (크게 쳐올려 띄우는 동작)
 *   k2     = K K 마무리      (온 힘을 실어 앞으로 밀어내는 동작)
 *   jUp    = W+J 상단 견제   (위로 쳐올리는 짧은 동작)
 *   jDown  = S+J 하단 견제   (몸을 낮춘 저공 동작)
 *   kUp    = W+K 상승 강타   (자기도 솟구치는 대공기)
 *   kDown  = S+K 내려찍기    (지면을 때리는 광역기)
 *   dive   = 공중 S+K 급강하 (머리부터 내리꽂는 낙하 공격)
 */
const CHARACTERS = {
  gates: {
    key: 'billgates',
    name: '빌 게이츠',
    look: '파란 스웨터, 갈색 가르마 머리, 금테 둥근 안경',
    weapon:
      '지폐 뭉치를 철사로 감아 만든 거대한 해머를 어깨에 걸쳤다',
    wild:
      '안경 렌즈에 파란 블루스크린 오류 화면이 번쩍이고, 스웨터 주머니에서 지폐가 삐져나온다. 세상을 다 사버린 듯한 능글맞은 미소',
    moves: {
      j2: '"더블 클릭" — 반대 손으로 허공을 두 번 찍듯 내지른다',
      j3: '"강제 종료" — 창을 닫아버리듯 크게 쳐올려 상대를 띄운다',
      k2: '"인수 합병" — 계약서를 든 채 해머를 온 힘으로 밀어낸다',
      jUp: '"강제 업데이트" — 파란 업데이트 팝업창을 위로 쳐올린다',
      jDown: '"기부금 살포" — 몸을 낮추고 바닥에 지폐를 흩뿌린다',
      kUp: '"Ctrl+Alt+Del" — 세 손가락을 치켜들며 함께 솟구친다',
      kDown: '"반독점 소송" — 거대한 판사봉을 지면에 내려찍는다',
      dive: '"강제 재부팅" — 해머를 앞세워 머리부터 내리꽂는다',
      skill: '"블루스크린" — 안경에서 파란 오류 화면 에너지가 뿜어져 나온다',
    },
  },
  jobs: {
    key: 'stevejobs',
    name: '스티브 잡스',
    look: '검은 터틀넥, 청바지, 회색 수염, 검은 둥근 안경',
    weapon:
      '흰 알루미늄 손잡이에서 무지개빛 광선 칼날이 뻗어 나오는 광선검',
    wild:
      '몸 뒤로 후광이 비치고, 눈은 광신도처럼 번뜩인다. 배경에 무지개 사과 잔상',
    moves: {
      j2: '"스트레이트" — 반대 손으로 광선검을 곧게 내지른다',
      j3: '"슬라이드 넘기기" — 발표 슬라이드를 넘기듯 크게 쳐올린다',
      k2: '"단종 선언" — 광선검을 양손으로 잡고 앞으로 밀어낸다',
      jUp: '"원 모어 씽" — 검지를 하늘로 치켜든다',
      jDown: '"씬 앤 라이트" — 몸을 낮춰 광선검으로 얇게 베어낸다',
      kUp: '"키노트 어퍼" — 무대 조명 기둥과 함께 솟구쳐 올려친다',
      kDown: '"심사 반려" — 거대한 반려 도장을 지면에 내려찍는다',
      dive: '"가격 인하" — 광선검을 아래로 겨누고 급강하한다',
      skill: '"스포트라이트 펀치" — 무대 조명이 한 점에 모이며 주먹이 빛난다',
    },
  },
  musk: {
    key: 'elonmusk',
    name: '일론 머스크',
    look: '빨간 티셔츠, 짧고 뒤로 넘긴 짙은 갈색 머리',
    weapon: '양손에 작은 로켓이 장전된 쌍권총',
    wild:
      '등에 부스터를 매달고 불꽃을 뿜는다. 두 눈이 도지코인 모양이고 항상 씩 웃고 있다',
    moves: {
      j2: '"리트윗" — 반대 손 권총으로 한 발 더 갈긴다',
      j3: '"커뮤니티 노트" — 두 권총을 위로 겨눠 크게 쏘아 올린다',
      k2: '"단수 분리" — 부스터를 터뜨리며 앞으로 밀어낸다',
      jUp: '"스타링크 발사" — 작은 위성을 하늘로 쏘아 올린다',
      jDown: '"보링 컴퍼니" — 몸을 낮추고 바닥에 터널을 뚫으며 파고든다',
      kUp: '"팰컨 이륙" — 등 부스터를 최대로 점화해 수직으로 솟구친다',
      kDown: '"착륙 실패" — 로켓이 지면에 처박히며 폭발한다',
      dive: '"대기권 재진입" — 온몸에 불이 붙은 채 머리부터 낙하한다',
      skill: '"로켓 드롭" — 쌍권총에서 거대한 로켓이 발사된다',
    },
  },
  linus: {
    key: 'linustorvalds',
    name: '리누스 토발즈',
    look: '회색 후드티, 부스스한 갈색 머리, 갈색 수염, 사각 안경',
    weapon: '자기 키만 한 거대한 양손 대검, 칼날에 초록 터미널 글자가 흐른다',
    wild: '펭귄 모자를 쓰고 잔뜩 인상 쓴 채 이빨을 드러낸다',
    moves: {
      j2: '"변경 요청" — 대검을 반대로 되돌려 다시 벤다',
      j3: '"전면 재작성" — 대검을 아래에서 위로 크게 올려 벤다',
      k2: '"메인라인 병합" — 대검을 양손으로 잡고 앞으로 밀어낸다',
      jUp: '"머지 리퀘스트" — 대검을 하늘로 곧게 세워 찌른다',
      jDown: '"rm -rf" — 몸을 낮춰 대검으로 바닥을 길게 쓸어버린다',
      kUp: '"force push" — 대검을 아래에서 위로 밀어 올리며 솟구친다',
      kDown: '"롤백 슬램" — 대검을 양손으로 지면에 내려찍는다',
      dive: '"커널 강림" — 대검 끝을 아래로 겨누고 수직 낙하한다',
      skill: '"커널 패닉" — 칼날의 초록 터미널 글자가 폭주해 뿜어져 나온다',
    },
  },
  pepe: {
    key: 'pennywise',
    name: '무서운 광대',
    look:
      '창백한 흰 분칠 얼굴, 붉게 솟구친 머리, 이마부터 눈을 지나 입꼬리까지 그어진 붉은 줄, 주름진 은색 광대 옷에 붉은 방울',
    weapon: '자기 몸보다 큰 양날 대형 도끼',
    wild:
      '입이 귀까지 찢어지도록 웃으며 뾰족한 이빨을 드러낸다. 노란 눈이 번뜩이고, 한 손에는 붉은 풍선을 쥐었다. 발밑에서 하수구 물이 새어 나온다',
    moves: {
      j2: '"저글링" — 도끼를 공중에 던졌다 받으며 이어 친다',
      j3: '"풍선 터뜨리기" — 붉은 풍선을 터뜨리며 크게 쳐올린다',
      k2: '"광대의 초대" — 도끼를 양손으로 잡고 온 힘으로 밀어낸다',
      jUp: '"붉은 풍선" — 붉은 풍선을 머리 위로 띄워 올린다',
      jDown: '"하수구의 손" — 발밑 하수구에서 창백한 손이 튀어나온다',
      kUp: '"점프 스케어" — 하수구 뚜껑을 뚫고 튀어 오르며 도끼를 올려친다',
      kDown: '"하수구 개봉" — 도끼로 맨홀 뚜껑을 통째로 깨부순다',
      dive: '"떠내려가기" — 도끼를 아래로 든 채 하수구 물살과 함께 낙하한다',
      skill: '"리츠고!" — 도끼가 붉게 타오르며 광기의 에너지를 뿜는다',
    },
  },
};

/* ------------------------------------------------------------------ */
/* 프롬프트 — docs/art-spec.md 와 같은 규격                            */
/* ------------------------------------------------------------------ */

/*
 * 프롬프트 뼈대는 전 캐릭터 공통이다.
 * 갈아 끼우는 곳은 ${...} 자리뿐이며, 나머지 글자는 한 글자도 바뀌지 않는다.
 * 같은 지시문을 받아야 화풍·비율·격자가 캐릭터끼리 어긋나지 않는다.
 */
function buildPrompt(c) {
  const m = c.moves;
  return `2D 대전 격투 게임용 스프라이트 시트를 만들어줘.

[캐릭터] ${c.name}${objectParticle(c.name)} 극단적으로 과장한 SD 도트 캐릭터.
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
- 30장 전부 같은 캐릭터로 보여야 한다. 옷 색·머리 모양·무기 형태를 프레임마다 바꾸지 말 것

[필수 규칙]
- 배경: 순수 마젠타 #FF00FF 단색. 캐릭터에는 이 색을 절대 쓰지 말 것
- 글자 금지: 프레임 이름/라벨/워터마크를 이미지에 넣지 말 것
- 5행 x 6열 격자, 총 30칸. 칸 구분선을 그리지 말 것
- 프레임 사이 간격은 캐릭터 폭의 20% 이상 확보
- 모든 프레임에서 캐릭터가 오른쪽을 향할 것
- 모든 프레임 크기·비율 동일, 발끝을 같은 높이에 맞출 것
- 이펙트가 옆 프레임을 침범하지 않게 할 것
- 무기를 들지 않은 손은 비워두고, 손목 높이를 프레임마다 일정하게 유지

[동작 방향 규칙 — 이게 게임 조작과 직결된다]
- 위(UP) 계열은 시선·무기·팔이 명확히 위를 향할 것
- 아래(DOWN) 계열은 몸을 확실히 낮추고 무기가 지면 쪽을 향할 것
- 공중(AIR) 계열은 두 발이 지면에서 떨어져 있을 것
- 같은 버튼의 위/아래 동작이 서로 구분되게, 자세를 확실히 다르게 그릴 것

[연속기 규칙 — 3행이 한 동작의 흐름이다]
- ATTACK_J → J2 → J3 은 한 사람이 몰아치는 3연타다. 자세가 이어져 보일 것
- J3(마무리)는 상대를 위로 쳐올리는 큰 동작. 몸이 확실히 젖혀질 것
- K2(마무리)는 온 힘을 실어 앞으로 밀어내는 동작

[프레임 30개, 이 순서로]
1행 이동: IDLE(대기), WALK(걷기), RUN_A(달리기1), RUN_B(달리기2),
         RUN_C(달리기3), DASH(질주)
2행 공중: JUMP(솟아오르는 중, 무릎 접음), FALL(떨어지는 중, 다리 뻗음),
         LAND(착지 직후 무릎을 굽힌 자세),
         AIR_J(공중에서 앞으로 내지르는 짧은 공격),
         AIR_K(공중에서 몸을 회전시키며 크게 휘두름),
         AIR_DIVE(${m.dive})
3행 연속기: ATTACK_J(짧은 견제 공격 1타),
           ATTACK_J2(${m.j2}),
           ATTACK_J3(${m.j3}),
           ATTACK_K(크게 휘두르는 강공격, 궤적 잔상),
           ATTACK_K2(${m.k2}),
           GUARD(무기를 세워 막기)
4행 방향기·스킬: ATTACK_J_UP(${m.jUp}),
                ATTACK_J_DOWN(${m.jDown}),
                ATTACK_K_UP(${m.kUp}),
                ATTACK_K_DOWN(${m.kDown}),
                SKILL_L(${m.skill} — 기를 모으는 순간),
                SKILL_L2(같은 기술을 방출하는 순간, 캐릭터 포함)
5행 피격·결과: SKILL_FX(방출된 에너지 이펙트만. 캐릭터를 그리지 말 것),
              HIT(지상 피격), HIT_AIR(공중에 뜬 채로 맞아 젖혀진 자세),
              KNOCKBACK(크게 날아감), WIN(무기를 치켜든 승리),
              LOSE(무기를 떨어뜨린 패배)`;
}

/* ------------------------------------------------------------------ */
/* Gemini 이미지 API                                                   */
/* ------------------------------------------------------------------ */

const MODEL = resolveModel();

/*
 * 이미지 생성은 tools/gemini.mjs 하나로 모았다.
 * 예전에는 여기에 따로 호출부가 있었는데 엔드포인트가 실제 API와 달랐고,
 * 같은 일을 하는 코드가 두 벌 있으면 한쪽만 고쳐지기 마련이다.
 */
const generate = (prompt, apiKey) =>
  generateImage(prompt, { apiKey, model: MODEL, aspectRatio: '21:9' });

/* ------------------------------------------------------------------ */

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const save = args.includes('--save');
const all = args.includes('--all');
const ids = all
  ? Object.keys(CHARACTERS)
  : args.filter((a) => !a.startsWith('--'));

if (!ids.length) {
  console.error(
    `사용법: node tools/gen-sheet.mjs <${Object.keys(CHARACTERS).join('|')}> [--dry|--save]\n` +
      `        node tools/gen-sheet.mjs --all`,
  );
  process.exit(1);
}

const apiKey = process.env.GEMINI_API_KEY;
// --save 는 프롬프트만 만들어 두는 모드라 키가 필요 없다
if (!dry && !save && !apiKey) {
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

  // 웹 UI에 직접 붙여넣는 사람을 위해 파일로도 남긴다
  if (save) {
    const file = `art-source/${c.key}_prompt.txt`;
    writeFileSync(file, prompt, 'utf8');
    console.log(`프롬프트 저장: ${file}`);
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

if (!dry && !save && ids.length) {
  console.log(
    `\n다음 단계: 전처리 로그에 "총 30개"가 찍혔는지 확인하고\n` +
      `src/config/spriteSheets.ts 에 아래처럼 한 줄로 등록하세요.\n\n` +
      `  <id>: { key: '<key>', displayHeight: 116, frameRate: 10,\n` +
      `          explosionFrame: LAYOUT_V2_FX_FRAME, poses: LAYOUT_V2 },\n\n` +
      `프레임 수가 30이 아니면 시트를 다시 뽑는 편이 빠릅니다.\n` +
      `(자세한 절차는 docs/art-spec.md)`,
  );
}

process.exit(failed ? 1 : 0);
