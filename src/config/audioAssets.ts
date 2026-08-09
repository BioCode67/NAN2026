import type { BgmTrack, SfxName } from '../systems/SoundSystem';

/**
 * 소리 파일 목록 — **없어도 되는** 것들이다.
 *
 * ── 왜 이런 파일이 따로 필요한가 ──────────────────────────────────
 * 이 게임의 소리는 전부 코드가 만든다(Web Audio 시퀀서). 그림이 없어도
 * 도형으로 돌아가는 것과 같은 이유다 — 에셋이 하나도 없는 상태에서도
 * 게임이 완성품으로 돌아가야 한다.
 *
 * 그런데 그림에는 "만든 것을 넣는 자리"(public/sprites, public/bg)가
 * 있었는데 **소리에는 없었다.** 곡을 만들어 와도 넣을 곳이 없으니
 * 코드를 고쳐야 했고, 그건 에셋을 받는 방식이 아니다.
 *
 * 그래서 그림과 똑같은 규칙을 소리에도 적용한다:
 *   파일이 있으면 그것을 쓰고, 없으면 지금까지처럼 코드가 만든다.
 * 넣는 사람은 파일 이름만 맞추면 되고, 게임 코드는 손댈 것이 없다.
 */

/** 확장자는 이 순서로 찾는다 — 먼저 찾은 것을 쓴다 */
const EXTS = ['ogg', 'mp3', 'm4a', 'wav'] as const;

/**
 * 곡.
 *
 *   public/bgm/menu.<ext>        제목·선택 화면
 *   public/bgm/battle.<ext>      전투
 *   public/bgm/battle_hot.<ext>  전투 — 뜨거운 판 (선택)
 *
 * `_hot` 은 있으면 서든데스·마지막 둘에서 **부드럽게 갈아탄다.** 없으면
 * 그냥 원래 곡이 계속 흐른다. 한 곡만 만들어 와도 게임은 완성이고,
 * 두 곡을 만들어 오면 판이 뜨거워지는 것이 귀로도 들린다.
 */
export const BGM_FILES: Array<{ track: BgmTrack; hot?: boolean }> = [
  { track: 'menu' },
  { track: 'battle' },
  { track: 'battle', hot: true },
];

/**
 * 효과음 — `public/sfx/<이름>.<ext>`.
 *
 * 열다섯 개를 다 만들 필요는 없다. 있는 것만 파일이 나가고 나머지는
 * 코드가 만든 소리가 그대로 쓰인다. 섞여 있어도 어색하지 않게,
 * 파일 소리도 같은 버스(master)를 타고 같은 음소거를 따른다.
 */
export const SFX_FILES: SfxName[] = [
  'hitLight',
  'hitHeavy',
  'hitSkill',
  'finisher',
  'whiff',
  'jump',
  'doubleJump',
  'land',
  'ko',
  'surge',
  'skill',
  'gambleWin',
  'gambleLose',
  'uiMove',
  'uiConfirm',
];

/** 곡 파일의 키 (내부 식별자) */
export function bgmKey(track: BgmTrack, hot = false): string {
  return hot ? `${track}_hot` : track;
}

/**
 * 이 경로에 파일이 있는가 — 확장자를 차례로 찔러 본다.
 *
 * HEAD 로 물어보는 이유는 그림 쪽(resolveArtPath)과 같다: 없는 파일을
 * 그냥 로더에 걸면 브라우저가 파일마다 콘솔에 빨간 오류를 찍는다.
 * 아직 안 만든 소리는 오류가 아니다.
 */
export async function resolveAudioPath(base: string): Promise<string | null> {
  for (const ext of EXTS) {
    const path = `${base}.${ext}`;
    try {
      const res = await fetch(new URL(path, document.baseURI), { method: 'HEAD' });
      if (!res.ok) continue;

      /*
       * 200 만 보고 믿으면 안 된다.
       *
       * dev 서버(Vite)와 대부분의 정적 호스팅은 **없는 경로에도 index.html 을
       * 200 으로 돌려준다**(SPA 폴백). 그래서 있지도 않은 .ogg 를 "찾았다"고
       * 판정하고, 받아 온 HTML 을 소리로 디코드하려다 조용히 실패한다.
       * 증상은 "파일을 넣었는데 합성 소리가 난다" — 원인이 하나도 안 닮았다.
       * 그림 쪽(jsonExists)이 같은 이유로 이미 content-type 을 본다.
       */
      const type = res.headers.get('content-type') ?? '';
      if (type.startsWith('audio/') || type === 'application/octet-stream') return path;
    } catch {
      /* 네트워크가 막힌 환경 — 없는 것으로 본다 */
    }
  }
  return null;
}

/** 있는 소리 파일만 골라 [키, 경로] 로 돌려준다 */
export async function probeAudio(): Promise<{
  bgm: Array<{ key: string; path: string }>;
  sfx: Array<{ key: SfxName; path: string }>;
}> {
  const bgm = await Promise.all(
    BGM_FILES.map(async (b) => {
      const key = bgmKey(b.track, b.hot);
      const path = await resolveAudioPath(`bgm/${key}`);
      return path ? { key, path } : null;
    }),
  );
  const sfx = await Promise.all(
    SFX_FILES.map(async (name) => {
      const path = await resolveAudioPath(`sfx/${name}`);
      return path ? { key: name, path } : null;
    }),
  );

  return {
    bgm: bgm.filter((b): b is { key: string; path: string } => b !== null),
    sfx: sfx.filter((s): s is { key: SfxName; path: string } => s !== null),
  };
}
