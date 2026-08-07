/**
 * 이미지 생성 제공자 — 어디에 그림을 시킬 것인가.
 *
 * 나노바나나(Gemini)만으로 시작했는데, 이미지 생성에는 무료 티어가 없다.
 * 그래서 공짜로 쓸 수 있는 곳들도 같은 방식으로 부를 수 있게 나눠 뒀다.
 *
 * ── 고르는 기준 ────────────────────────────────────────────────────
 * 배경·타이틀처럼 **그림 한 장**은 무료 모델로도 충분하다.
 * 캐릭터 시트는 다르다. "같은 인물이 여섯 칸에 서로 다른 자세로, 칸이 정확히
 * 여섯 개, 배경은 마젠타" 를 지켜야 하는데 이건 그림 실력이 아니라
 * **지시를 따르는 능력**이다. FLUX·SD 계열은 글 → 그림 모델이라 칸을 세지
 * 못하고, 묶음마다 다른 사람을 그린다. 참조 이미지를 함께 넣어 인물을
 * 고정하는 것도 Gemini 쪽이 훨씬 낫다.
 *
 * 요약: 배경은 무료로, 캐릭터 시트는 Gemini로.
 */

import { generateImage as geminiGenerate, resolveModel } from './gemini.mjs';

/** 비율 → 픽셀. 무료 제공자들은 비율이 아니라 크기를 받는다 */
const SIZE = {
  '21:9': [1344, 576],
  '16:9': [1280, 720],
  '4:3': [1024, 768],
  '1:1': [1024, 1024],
};

function sizeFor(aspectRatio) {
  return SIZE[aspectRatio] ?? SIZE['1:1'];
}

/* ------------------------------------------------------------------ */

export const PROVIDERS = {
  gemini: {
    label: 'Gemini (나노바나나)',
    free: false,
    /** 참조 이미지를 함께 넣을 수 있는가 — 시트 일관성에 결정적이다 */
    reference: true,
    needs: 'GEMINI_API_KEY',
    note: '지시를 가장 잘 따른다. 캐릭터 시트는 사실상 이것만 쓸 만하다',
  },
  pollinations: {
    label: 'Pollinations (FLUX)',
    free: true,
    reference: false,
    needs: null,
    note: '키가 필요 없다. 배경 한 장짜리에 적합. 느리고 가끔 실패한다',
  },
  cloudflare: {
    label: 'Cloudflare Workers AI (FLUX.1-schnell)',
    free: true,
    reference: false,
    needs: 'CF_ACCOUNT_ID + CF_API_TOKEN',
    note: '하루 무료 할당량이 있다. 빠르고 안정적인 편',
  },
  huggingface: {
    label: 'Hugging Face Inference (FLUX.1-schnell)',
    free: true,
    reference: false,
    needs: 'HF_TOKEN',
    note: '무료 한도가 있다. 모델이 잠들어 있으면 첫 요청이 오래 걸린다',
  },
};

export function resolveProvider() {
  const p = process.env.ART_PROVIDER ?? 'gemini';
  if (!PROVIDERS[p]) {
    console.error(
      `ART_PROVIDER=${p} 는 없는 이름입니다.\n` +
        `쓸 수 있는 것: ${Object.keys(PROVIDERS).join(', ')}`,
    );
    process.exit(1);
  }
  return p;
}

/** 이 제공자를 쓰려면 무엇이 있어야 하는지 확인한다 */
export function checkProvider(name) {
  const p = PROVIDERS[name];

  const need = (key) => {
    if (process.env[key]) return true;
    console.error(
      `${p.label} 을(를) 쓰려면 ${p.needs} 가 필요합니다.\n` +
        `.env.local 에 넣어 주세요 (커밋되지 않습니다).`,
    );
    process.exit(1);
  };

  switch (name) {
    case 'gemini':
      return need('GEMINI_API_KEY');
    case 'cloudflare':
      need('CF_ACCOUNT_ID');
      return need('CF_API_TOKEN');
    case 'huggingface':
      return need('HF_TOKEN');
    default:
      return true;
  }
}

/* ------------------------------------------------------------------ */
/* 실제 호출                                                            */
/* ------------------------------------------------------------------ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 그림 한 장을 만든다.
 *
 * @param opts.provider  gemini | pollinations | cloudflare | huggingface
 * @param opts.aspectRatio '16:9' 등
 * @param opts.reference  참조 이미지 바이트 (지원하는 제공자만 씀)
 */
export async function generate(prompt, opts = {}) {
  const provider = opts.provider ?? resolveProvider();

  switch (provider) {
    case 'gemini':
      return geminiGenerate(prompt, {
        apiKey: process.env.GEMINI_API_KEY,
        model: resolveModel(),
        aspectRatio: opts.aspectRatio,
        reference: opts.reference,
      });
    case 'pollinations':
      return pollinations(prompt, opts);
    case 'cloudflare':
      return cloudflare(prompt, opts);
    case 'huggingface':
      return huggingface(prompt, opts);
    default:
      throw new Error(`알 수 없는 제공자: ${provider}`);
  }
}

/** 응답이 정말 이미지인지 확인한다 — 오류 페이지를 PNG로 저장하면 나중에 헤맨다 */
function assertImage(buf, where) {
  const png = buf[0] === 0x89 && buf[1] === 0x50;
  const jpg = buf[0] === 0xff && buf[1] === 0xd8;
  const webp = buf.subarray(0, 4).toString() === 'RIFF';
  if (png || jpg || webp) return buf;

  throw new Error(
    `${where}: 이미지가 아닌 응답이 왔습니다\n${buf.subarray(0, 200).toString()}`,
  );
}

/* --- 키 없이 쓰는 곳 ------------------------------------------------ */

async function pollinations(prompt, opts) {
  const [w, h] = sizeFor(opts.aspectRatio);
  const url =
    `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}` +
    `?width=${w}&height=${h}&model=flux&nologo=true&safe=false`;

  /*
   * 생성에 시간이 걸리고 붐빌 때 502가 잦다. 넉넉히 기다렸다 몇 번 다시 건다.
   * 무료로 얻는 대가다.
   */
  for (let i = 0; i < 4; i++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(180_000) }).catch(
      (e) => ({ ok: false, status: 0, statusText: e.message }),
    );
    if (res.ok) {
      return assertImage(Buffer.from(await res.arrayBuffer()), 'pollinations');
    }
    if (i < 3) await sleep(3000 * (i + 1));
    else throw new Error(`pollinations ${res.status} ${res.statusText ?? ''}`);
  }
  throw new Error('pollinations: 실패');
}

/* --- 무료 할당량이 있는 곳 ------------------------------------------ */

async function cloudflare(prompt, opts) {
  const [w, h] = sizeFor(opts.aspectRatio);
  const url =
    `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}` +
    `/ai/run/@cf/black-forest-labs/flux-1-schnell`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.CF_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prompt, width: w, height: h, steps: 6 }),
    signal: AbortSignal.timeout(120_000),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`cloudflare ${res.status}\n${text.slice(0, 300)}`);

  const json = JSON.parse(text);
  const b64 = json.result?.image;
  if (!b64) throw new Error(`cloudflare: 이미지가 없습니다\n${text.slice(0, 300)}`);

  return assertImage(Buffer.from(b64, 'base64'), 'cloudflare');
}

async function huggingface(prompt, opts) {
  const [w, h] = sizeFor(opts.aspectRatio);
  const model = process.env.HF_IMAGE_MODEL ?? 'black-forest-labs/FLUX.1-schnell';

  for (let i = 0; i < 3; i++) {
    const res = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.HF_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inputs: prompt,
        parameters: { width: w, height: h },
      }),
      signal: AbortSignal.timeout(180_000),
    });

    // 모델이 잠들어 있으면 503 + 예상 대기 시간을 준다
    if (res.status === 503) {
      const body = await res.json().catch(() => ({}));
      const wait = Math.min(90, Math.ceil(body.estimated_time ?? 25));
      console.log(`    모델을 깨우는 중… ${wait}초 기다립니다`);
      await sleep(wait * 1000);
      continue;
    }

    if (!res.ok) {
      throw new Error(`huggingface ${res.status}\n${(await res.text()).slice(0, 300)}`);
    }
    return assertImage(Buffer.from(await res.arrayBuffer()), 'huggingface');
  }
  throw new Error('huggingface: 모델이 깨어나지 않았습니다');
}
