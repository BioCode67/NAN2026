import { DEFAULT_STAGE_ART } from './artAssets';

/**
 * 스테이지.
 *
 * ── 왜 여러 개가 필요한가 ─────────────────────────────────────────
 * 캐릭터가 스무 명인데 싸우는 곳이 하나면, 스무 번째 판도 첫 판과 똑같이
 * 생겼다. 캐릭터를 바꾸는 것은 "내가 뭘 누르는가"를 바꾸지만,
 * 맵을 바꾸는 것은 **어디서 싸우는가**를 바꾼다. 둘은 다른 종류의 변화다.
 *
 * 발판 배치 하나만 달라져도 판이 통째로 달라진다 — 발판이 낮고 촘촘하면
 * 도망칠 데가 없어 계속 붙어 싸우게 되고, 높고 성기면 이동 자체가 위험해져
 * 한 번의 실수가 장외로 이어진다.
 *
 * ── 무엇을 바꾸고 무엇을 고정하는가 ───────────────────────────────
 * 지면 높이·좌우 끝·장외선은 **고정한다.** 봇의 절벽 판단, 아이템 낙하 위치,
 * 투사체 소멸 범위가 전부 그 값을 기준으로 잡혀 있어서, 맵마다 바꾸면
 * 맵 하나 늘릴 때마다 시스템 네 개를 같이 손봐야 한다.
 *
 * 대신 **발판·중력·색·배경**을 바꾼다. 이 넷이 체감의 대부분이고,
 * 넷 다 다른 시스템이 알 필요가 없는 값들이다.
 */

export type StageId = 'exchange' | 'rooftop' | 'server' | 'moon';

export interface StagePlatform {
  x: number;
  y: number;
  w: number;
}

export interface StageConfig {
  id: StageId;
  /** 전투 시작 배너에 뜨는 이름 */
  name: string;
  /** 이름 아래 한 줄 — 무엇이 다른지 플레이어에게 알린다 */
  desc: string;
  /** artAssets 의 배경 키. 그림이 없으면 도형 배경이 그대로 보인다 */
  art: string;
  /** 발판·바닥의 발광 색. 맵마다 화면 온도가 달라진다 */
  accent: number;
  /** 중력 배율 (1 = 기본) */
  gravityMul: number;
  /**
   * 이 무대에서 곡을 어떻게 비틀 것인가.
   *
   * 곡을 무대마다 따로 쓰지 않는 이유 — 네 곡을 쓰면 넷 다 어중간해진다.
   * 같은 곡을 조를 옮기고 템포를 바꾸는 것만으로도 "다른 곳에 왔다"는
   * 인상은 충분히 나고, 곡 자체의 완성도는 하나에 몰아줄 수 있다.
   */
  music: {
    /** 반음 단위 이조. 음수면 낮아진다 */
    transpose: number;
    /** 템포 배율 */
    bpmMul: number;
  };
  platforms: StagePlatform[];
}

/**
 * 발판을 배치할 때의 기준.
 *
 * 지면은 y=590, 1단 점프로 약 111px, 2단까지 약 196px 오른다.
 * 즉 지면에서 한 번에 닿는 높이는 y≈394 근처가 한계이고, 그보다 높은 발판은
 * 아래 발판을 밟고 올라가야 한다. 사다리처럼 이어 두면 오르는 길이 생기고,
 * 뚝 떨어뜨려 두면 그 발판은 "위에서 내려오는 사람만 쓰는 자리"가 된다.
 */
export const STAGES: StageConfig[] = [
  {
    id: 'exchange',
    name: '증권 거래소',
    desc: '표준 — 사다리처럼 이어진 다섯 발판',
    art: DEFAULT_STAGE_ART,
    accent: 0x60a5fa,
    gravityMul: 1,
    // 기준 — 다른 무대는 이 곡을 비튼 것으로 들린다
    music: { transpose: 0, bpmMul: 1 },
    platforms: [
      { x: 330, y: 440, w: 250 },
      { x: 1590, y: 440, w: 250 },
      { x: 700, y: 330, w: 230 },
      { x: 1220, y: 330, w: 230 },
      { x: 960, y: 215, w: 200 },
    ],
  },

  {
    id: 'rooftop',
    name: '옥상 헬리패드',
    // 발판이 셋뿐이고 사이가 멀다 — 이동 자체가 도박이 된다
    desc: '고공전 — 발판이 셋뿐, 사이가 멀다',
    art: 'stage_storm',
    accent: 0x94a3b8,
    gravityMul: 1,
    // 높고 위태로운 곳 — 조를 올리고 조금 몰아친다
    music: { transpose: 3, bpmMul: 1.05 },
    platforms: [
      { x: 300, y: 420, w: 210 },
      { x: 1620, y: 420, w: 210 },
      // 가운데 헬리패드는 넓지만 오르려면 좌우를 거쳐야 한다
      { x: 960, y: 300, w: 270 },
    ],
  },

  {
    id: 'server',
    name: '서버실',
    // 낮고 촘촘해서 어디로 도망쳐도 상대가 따라온다
    desc: '난전 — 낮고 촘촘해 도망칠 데가 없다',
    art: 'stage_server',
    accent: 0x4ade80,
    gravityMul: 1,
    // 좁은 데서 계속 붙어 싸운다 — 낮게 깔고 가장 빠르게
    music: { transpose: -2, bpmMul: 1.09 },
    platforms: [
      { x: 450, y: 470, w: 200 },
      { x: 1470, y: 470, w: 200 },
      { x: 760, y: 468, w: 170 },
      { x: 1160, y: 468, w: 170 },
      { x: 600, y: 355, w: 240 },
      { x: 1320, y: 355, w: 240 },
    ],
  },

  {
    id: 'moon',
    name: '달 표면',
    // 중력이 낮아 점프가 길어진다 — 공중전 비중이 확 올라간다
    desc: '저중력 — 오래 뜨고 천천히 떨어진다',
    art: 'stage_moon',
    accent: 0xa5b4fc,
    gravityMul: 0.62,
    // 천천히 떠다니는 곳 — 가장 낮고 가장 느리게
    music: { transpose: -5, bpmMul: 0.88 },
    platforms: [
      { x: 380, y: 395, w: 150 },
      { x: 1540, y: 395, w: 150 },
      { x: 760, y: 265, w: 140 },
      { x: 1160, y: 265, w: 140 },
      { x: 960, y: 150, w: 180 },
    ],
  },
];

export const STAGE_BY_ID = Object.fromEntries(
  STAGES.map((s) => [s.id, s]),
) as Record<StageId, StageConfig>;

/** 기본 스테이지 — 스테이지를 지정하지 않고 들어왔을 때 */
export const DEFAULT_STAGE: StageConfig = STAGES[0]!;

/**
 * 이번 판의 스테이지를 고른다.
 *
 * 바로 앞 판과는 다른 곳으로 보낸다. 무작위로만 두면 같은 맵이 두 번,
 * 세 번 연달아 나오는 일이 흔하고, 그러면 "맵이 여러 개"라는 사실 자체가
 * 플레이어에게 전달되지 않는다.
 */
export function pickStage(previous?: StageId): StageConfig {
  const pool = STAGES.filter((s) => s.id !== previous);
  return pool[Math.floor(Math.random() * pool.length)] ?? DEFAULT_STAGE;
}
