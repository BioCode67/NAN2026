/**
 * 문장 → 그림.
 *
 * ── 이게 왜 있는가 ──────────────────────────────────────────────────
 * 프롬프트 오브를 깨면 플레이어가 문장을 쓰고, 그 문장이 판을 바꾼다.
 * 그런데 바뀌는 것이 "아이템이 떨어진다 · 중력이 낮아진다"처럼 **얌전한
 * 것들뿐**이면, 문장을 쓰는 행위가 버튼 하나를 고르는 것과 다를 게 없다.
 * 무엇을 써도 결과가 표 안에 있다는 걸 알아채는 순간 쓰는 재미가 끝난다.
 *
 * 그래서 같은 문장을 그림 생성 서버에도 보낸다. 돌아온 그림은 **그 판의
 * 배경이 된다** — 내가 쓴 한 줄이 세계를 통째로 다시 칠한다. 이건 표에
 * 없는 결과라 다음 판에 무엇을 쓸지 실제로 궁금해진다.
 *
 * ── 없으면 어떻게 되는가 ────────────────────────────────────────────
 * 서버 주소가 없으면 아무 일도 안 일어난다. 기믹은 그대로 걸리고 게임은
 * 멀쩡히 돌아간다. 심사자가 키 없이 켜도 되어야 하므로 이쪽이 기본값이다.
 *
 * ── 어디에 연결하는가 ───────────────────────────────────────────────
 * 세 갈래를 안다. 주소만 주면 어느 쪽인지 스스로 짚는다.
 *
 *   a1111    로컬 Stable Diffusion WebUI (AUTOMATIC1111 / Forge)
 *            POST {url}/sdapi/v1/txt2img  →  { images: [base64] }
 *            띄울 때 --api --cors-allow-origins=* 를 꼭 준다
 *   stability api.stability.ai v1
 *            POST /v1/generation/{engine}/text-to-image
 *            →  { artifacts: [{ base64 }] }
 *   generic  직접 만든 중계 서버
 *            POST {url}  { prompt, seed, width, height }
 *            →  { image } 또는 { images: [...] } (base64 또는 URL)
 *
 * 설정은 빌드 때(.env) 또는 브라우저에서 그 자리에서 할 수 있다.
 * 시연 중에 주소를 바꿔야 하는 일이 실제로 생기기 때문이다:
 *
 *   localStorage.setItem('sd.url', 'http://127.0.0.1:7860')
 *   location.reload()
 */

export type ImageGenMode = 'auto' | 'a1111' | 'stability' | 'generic' | 'off';

/** 저장해 둔 값을 읽는다 — 브라우저가 아닌 곳에서도 안전하게 */
function stored(name: string): string {
  try {
    return localStorage.getItem(name)?.trim() ?? '';
  } catch {
    return '';
  }
}

function envOf(name: string): string {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env;
  return (env?.[name] ?? '').trim();
}

export interface ImageGenConfig {
  url: string;
  key: string;
  mode: ImageGenMode;
  /** stability 전용 — 어느 모델로 그릴지 */
  engine: string;
  width: number;
  height: number;
  steps: number;
  /** 이 시간 안에 안 오면 포기한다 (ms) */
  timeoutMs: number;
}

/**
 * 지금 설정.
 *
 * 저장해 둔 값이 .env 보다 세다 — 시연 중에 브라우저에서 바꾼 것이
 * 빌드할 때 넣어 둔 것에 지는 것은 말이 안 된다.
 */
export function imageGenConfig(): ImageGenConfig {
  const url = stored('sd.url') || envOf('VITE_SD_URL');
  const key = stored('sd.key') || envOf('VITE_SD_KEY');
  const mode = (stored('sd.mode') || envOf('VITE_SD_MODE') || 'auto') as ImageGenMode;

  return {
    url: url.replace(/\/+$/, ''),
    key,
    mode,
    engine: envOf('VITE_SD_ENGINE') || 'stable-diffusion-xl-1024-v1-0',
    width: Number(envOf('VITE_SD_WIDTH')) || 1024,
    height: Number(envOf('VITE_SD_HEIGHT')) || 576,
    steps: Number(envOf('VITE_SD_STEPS')) || 18,
    timeoutMs: Number(envOf('VITE_SD_TIMEOUT')) || 25000,
  };
}

/** 주소가 있고 꺼 두지 않았는가 */
export function imageGenReady(cfg = imageGenConfig()): boolean {
  return !!cfg.url && cfg.mode !== 'off';
}

/** 주소만 보고 어느 서버인지 짚는다 */
function detectMode(cfg: ImageGenConfig): Exclude<ImageGenMode, 'auto' | 'off'> {
  if (cfg.mode !== 'auto') return cfg.mode as Exclude<ImageGenMode, 'auto' | 'off'>;
  if (/stability\.ai/i.test(cfg.url)) return 'stability';
  if (/7860|sdapi|automatic|forge/i.test(cfg.url)) return 'a1111';
  return 'generic';
}

/* ------------------------------------------------------------------ */
/* 무엇을 그리라고 할 것인가                                            */
/* ------------------------------------------------------------------ */

/**
 * 그림의 결.
 *
 * "예쁘게"가 아니라 **판이 뒤집힌 것처럼** 나와야 한다. 얌전한 배경이
 * 돌아오면 애써 부른 보람이 없다 — 문장을 쓴 사람이 "내가 이걸 만들었다"고
 * 느끼려면 화면이 확 달라져야 한다.
 */
const STYLE =
  'chaotic 2D game splash art, wide cinematic background, ' +
  'korean stock market apocalypse, exploding candlestick charts, neon red and green, ' +
  'dramatic dutch angle, heavy rim light, thick painterly strokes, high contrast, ' +
  'no text, no watermark, no characters in foreground';

const NEGATIVE =
  'text, letters, watermark, signature, ui, hud, logo, blurry, low contrast, ' +
  'flat lighting, boring, empty, plain sky';

/**
 * 보낼 문장을 만든다.
 *
 * 플레이어가 쓴 말을 그대로만 보내면 잘 안 나온다 — 한국어 한 줄에는
 * 장면이 부족하고, 모델은 대부분 영어로 학습돼 있다. 그래서 **해석기가
 * 짚어 낸 기믹의 장면 설명(영어)** 을 앞에 세우고 플레이어의 말을 뒤에
 * 붙인다. 무슨 일이 벌어졌는지는 앞이 책임지고, "내가 쓴 그 말"은 뒤가
 * 책임진다.
 */
export function buildImagePrompt(text: string, scenes: string[]): string {
  const scene = scenes.filter(Boolean).join(', ');
  return [STYLE, scene, text].filter(Boolean).join(', ');
}

/**
 * 같은 문장이면 어디서 돌려도 같은 그림이 나오게 하는 씨앗.
 *
 * 온라인에서 그림을 회선으로 실어 보내지 않는 이유가 이것이다 — 문장은
 * 이미 모두에게 전달되므로, 각자 같은 씨앗으로 부르면 같은 그림이 나온다.
 * 수십~수백 KB 를 데이터 채널로 밀어 넣는 것보다 이쪽이 훨씬 안전하다.
 */
export function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 2147483647;
}

/* ------------------------------------------------------------------ */
/* 부르기                                                              */
/* ------------------------------------------------------------------ */

/** 돌아온 것을 화면에 붙일 수 있는 주소로 바꾼다 */
function toSrc(v: string): string {
  if (!v) return '';
  if (v.startsWith('data:') || v.startsWith('http') || v.startsWith('blob:')) return v;
  return `data:image/png;base64,${v}`;
}

/** 응답 어디에 그림이 들어 있든 찾아낸다 */
function pickImage(body: unknown): string {
  const b = body as Record<string, unknown>;
  if (!b || typeof b !== 'object') return '';

  if (Array.isArray(b.images) && typeof b.images[0] === 'string') {
    return toSrc(b.images[0]);
  }
  if (Array.isArray(b.artifacts)) {
    const first = b.artifacts[0] as Record<string, unknown> | undefined;
    if (first && typeof first.base64 === 'string') return toSrc(first.base64);
  }
  for (const k of ['image', 'url', 'output', 'data']) {
    const v = b[k];
    if (typeof v === 'string') return toSrc(v);
    if (Array.isArray(v) && typeof v[0] === 'string') return toSrc(v[0]);
  }
  return '';
}

/**
 * 그림을 받아 온다. 못 받으면 null — **던지지 않는다**.
 *
 * 여기서 예외가 새어 나가면 판이 멈춘다. 그림은 있으면 좋은 것이지
 * 없으면 못 노는 것이 아니므로, 실패는 조용히 없던 일이 되어야 한다.
 */
export async function generateBattleImage(
  prompt: string,
  seed: number,
  signal?: AbortSignal,
): Promise<string | null> {
  const cfg = imageGenConfig();
  if (!imageGenReady(cfg)) return null;

  const mode = detectMode(cfg);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
  signal?.addEventListener('abort', () => ctrl.abort());

  try {
    let url = cfg.url;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    let body: unknown;

    if (mode === 'a1111') {
      url = `${cfg.url}/sdapi/v1/txt2img`;
      body = {
        prompt,
        negative_prompt: NEGATIVE,
        seed,
        steps: cfg.steps,
        width: cfg.width,
        height: cfg.height,
        cfg_scale: 7,
        sampler_name: 'Euler a',
      };
    } else if (mode === 'stability') {
      url = `${cfg.url}/v1/generation/${cfg.engine}/text-to-image`;
      headers.Accept = 'application/json';
      if (cfg.key) headers.Authorization = `Bearer ${cfg.key}`;
      body = {
        text_prompts: [
          { text: prompt, weight: 1 },
          { text: NEGATIVE, weight: -1 },
        ],
        seed,
        steps: cfg.steps,
        width: cfg.width,
        height: cfg.height,
        cfg_scale: 7,
        samples: 1,
      };
    } else {
      if (cfg.key) headers.Authorization = `Bearer ${cfg.key}`;
      body = {
        prompt,
        negative_prompt: NEGATIVE,
        seed,
        width: cfg.width,
        height: cfg.height,
        steps: cfg.steps,
      };
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;

    const json = (await res.json()) as unknown;
    return pickImage(json) || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 진단용 — 콘솔에서 지금 어디에 붙어 있는지 본다 */
export function imageGenDebug(): {
  ready: boolean;
  mode: string;
  url: string;
  hasKey: boolean;
} {
  const cfg = imageGenConfig();
  return {
    ready: imageGenReady(cfg),
    mode: imageGenReady(cfg) ? detectMode(cfg) : 'off',
    url: cfg.url,
    hasKey: !!cfg.key,
  };
}
