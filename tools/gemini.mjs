/**
 * Gemini 이미지 생성 클라이언트.
 *
 * 웹 UI에 프롬프트를 붙여넣고 → 생성되기를 기다리고 → 내려받고 → 이름을 바꾸고
 * → 맞는 폴더에 넣는 일을, 한 번에 한 장씩 마흔 번 넘게 반복해야 한다.
 * 그 반복을 없애는 것이 이 파일의 전부다. 프롬프트는 이미 파일로 있으므로,
 * 남은 것은 "보내고 받아서 제자리에 쓰기"뿐이다.
 *
 * 의존성을 늘리지 않으려고 SDK 대신 REST를 직접 부른다.
 */

import { existsSync, readFileSync } from 'node:fs';

/** 이미지 모델별 대략적인 장당 가격 (달러) — 시작 전에 알려주기 위한 값 */
export const PRICE_PER_IMAGE = {
  'gemini-2.5-flash-image': 0.039,
  'gemini-3.1-flash-image': 0.067,
  'gemini-3-pro-image': 0.134,
};

const API = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * .env.local 에서 키를 읽는다.
 *
 * 셸 환경변수는 터미널을 새로 열 때마다 다시 넣어야 하고, 명령줄에 직접 적으면
 * 키가 셸 기록에 남는다. 파일 쪽이 안전하다.
 */
export function loadEnvFile(file = '.env.local') {
  if (!existsSync(file)) return;

  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq < 0) continue;

    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (key && process.env[key] === undefined) process.env[key] = val;
  }
}

export function resolveModel() {
  return process.env.GEMINI_IMAGE_MODEL ?? 'gemini-3.1-flash-image';
}

/** 키가 없으면 무엇을 해야 하는지 알려주고 끝낸다 */
export function requireApiKey() {
  const key = process.env.GEMINI_API_KEY;
  if (key) return key;

  console.error(
    'GEMINI_API_KEY 가 없습니다.\n\n' +
      '  1) https://aistudio.google.com/apikey 에서 키를 발급받고\n' +
      '  2) 프로젝트 루트에 .env.local 파일을 만들어 아래 한 줄을 넣으세요:\n\n' +
      '       GEMINI_API_KEY=발급받은키\n\n' +
      '  (.env.local 은 .gitignore에 걸려 있어 커밋되지 않습니다)\n\n' +
      '키 없이 하려면 프롬프트를 손으로 붙여넣으면 됩니다:\n' +
      '  art-source/prompts/ 아래 .txt 파일들',
  );
  process.exit(1);
}

/** 응답에서 base64 이미지를 꺼낸다 */
function extractImage(json) {
  for (const cand of json.candidates ?? []) {
    for (const part of cand.content?.parts ?? []) {
      const data = part.inlineData?.data ?? part.inline_data?.data;
      if (data) return data;
    }
  }
  return null;
}

/** 이미지가 없을 때, 모델이 글로 뭐라고 했는지 꺼낸다 (거부 사유 등) */
function extractText(json) {
  const out = [];
  for (const cand of json.candidates ?? []) {
    if (cand.finishReason && cand.finishReason !== 'STOP') {
      out.push(`finishReason=${cand.finishReason}`);
    }
    for (const part of cand.content?.parts ?? []) {
      if (part.text) out.push(part.text.trim());
    }
  }
  if (json.promptFeedback?.blockReason) {
    out.push(`blockReason=${json.promptFeedback.blockReason}`);
  }
  return out.join(' / ');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 이미지 한 장을 만든다.
 *
 * @param prompt 보낼 문장
 * @param opts.aspectRatio '16:9' 같은 비율. 모델이 지원하지 않으면 알아서 뺀다
 * @param opts.reference 참조 이미지 바이트 — 이 그림과 같은 인물로 그리라는 뜻
 * @param opts.retries 429·5xx 재시도 횟수
 * @returns PNG/JPEG 바이트
 */
export async function generateImage(prompt, opts = {}) {
  const { apiKey, model = resolveModel(), aspectRatio, reference, retries = 3 } = opts;

  /*
   * 참조 이미지.
   *
   * 캐릭터 시트는 일곱 묶음으로 나눠 뽑는다. 글로만 시키면 묶음마다 다른
   * 사람이 나온다 — 옷 색이 바뀌고 무기가 사라지고 얼굴이 딴사람이 된다.
   * 그걸 이어 붙이면 시트가 아니라 다섯 명이 번갈아 나오는 애니메이션이 된다.
   *
   * 첫 묶음 결과를 함께 보내면 "이 사람"을 붙잡아 준다.
   * 프롬프트에도 사람 손으로 첨부하라고 적어 뒀는데, 자동으로 부를 때는
   * 그 안내를 읽을 사람이 없으므로 여기서 대신 붙인다.
   */
  const parts = [];
  if (reference) {
    parts.push({
      inlineData: { mimeType: 'image/png', data: Buffer.from(reference).toString('base64') },
    });
  }
  parts.push({ text: prompt });

  /*
   * 이미지 모델은 요청 형식이 세대마다 조금씩 다르다.
   * 지원하지 않는 필드를 보내면 400이 나므로, 붙였다가 거절당하면 떼고 다시 건다.
   * 처음부터 최소 형식으로 보내면 비율 지정을 못 써서 배경이 정사각형으로 나온다.
   */
  const variants = [];
  if (aspectRatio) {
    variants.push({
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: { aspectRatio },
      },
    });
  }
  variants.push({ generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } });
  variants.push({});

  let lastError = null;

  for (const extra of variants) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      let res;
      try {
        res = await fetch(`${API}/models/${model}:generateContent`, {
          method: 'POST',
          headers: {
            'x-goog-api-key': apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [{ role: 'user', parts }],
            ...extra,
          }),
        });
      } catch (err) {
        // 네트워크 오류 — 잠깐 쉬고 다시
        lastError = new Error(`네트워크 오류: ${err.message}`);
        await sleep(1500 * (attempt + 1));
        continue;
      }

      const body = await res.text();

      if (res.ok) {
        const json = JSON.parse(body);
        const b64 = extractImage(json);
        if (b64) return Buffer.from(b64, 'base64');

        // 200인데 이미지가 없다 = 모델이 글로 답했다 (대개 거부)
        throw new Error(`이미지가 오지 않았습니다. ${extractText(json) || body.slice(0, 300)}`);
      }

      /* 400 = 요청 형식 문제. 다음 변형으로 넘어간다 */
      if (res.status === 400) {
        lastError = new Error(`API 400\n${body.slice(0, 400)}`);
        break;
      }

      /* 혼잡·일시 오류만 재시도한다 */
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`API ${res.status}\n${body.slice(0, 300)}`);
        await sleep(2000 * (attempt + 1));
        continue;
      }

      /* 401/403/404 는 다시 걸어도 같다 — 바로 알린다 */
      throw new Error(
        `API ${res.status}\n${body.slice(0, 400)}\n\n` +
          (res.status === 404
            ? `모델 이름이 틀렸을 수 있습니다. 쓸 수 있는 모델 보기:\n` +
              `  curl -H "x-goog-api-key: $GEMINI_API_KEY" ${API}/models`
            : '키가 유효한지, 이미지 생성 권한이 있는지 확인하세요.'),
      );
    }
  }

  throw lastError ?? new Error('알 수 없는 실패');
}
