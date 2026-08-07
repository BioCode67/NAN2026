/**
 * 사운드 시스템 — Web Audio API 실시간 합성.
 *
 * 외부 음원 파일을 쓰지 않는 이유:
 *  - 저작권/라이선스 문서화 부담이 없다 (대회 제출물 요건)
 *  - 로딩 시간이 0이고 빌드 용량이 늘지 않는다
 *  - 타격 강도에 따라 피치/길이를 실시간으로 바꿀 수 있다
 *
 * 브라우저 자동재생 정책상 AudioContext는 첫 사용자 입력 이후에 생성한다.
 */

export type SfxName =
  | 'hitLight'
  | 'hitHeavy'
  | 'hitSkill'
  | 'finisher'
  | 'whiff'
  | 'jump'
  | 'doubleJump'
  | 'land'
  | 'ko'
  | 'surge'
  | 'skill'
  | 'gambleWin'
  | 'gambleLose'
  | 'uiMove'
  | 'uiConfirm';

/** 오실레이터 1개짜리 톤 파라미터 */
interface ToneOpts {
  freq: number;
  /** 목표 주파수 (스윕) */
  to?: number;
  type?: OscillatorType;
  dur: number;
  gain: number;
  delay?: number;
}

/** 노이즈 버스트 파라미터 */
interface NoiseOpts {
  dur: number;
  gain: number;
  /** 밴드패스 중심 주파수 */
  freq: number;
  to?: number;
  q?: number;
  delay?: number;
}

/** 스케줄러 선행 시간 (초) */
const BGM_LOOKAHEAD = 0.25;

/* ------------------------------------------------------------------ */
/* 곡 구조                                                             */
/* ------------------------------------------------------------------ */

/**
 * ── 왜 다시 짰는가 ────────────────────────────────────────────────
 * 처음에는 16스텝 한 마디를 무한히 반복했다. 30초쯤 들으면 같은 마디가
 * 60번 돌았다는 것을 귀가 알아채고, 그때부터는 음악이 아니라 소음이 된다.
 * 게임이 3분이면 360번이다.
 *
 * 음악이 음악으로 들리려면 두 가지가 필요하다.
 *   1. 화음이 움직인다 — 마디마다 코드가 바뀌어야 "진행"이 생긴다
 *   2. 구간이 나뉜다   — A → B → 브레이크 → A' 처럼 밀도가 오르내려야 한다
 * 여기에 하나 더, 격투 게임이므로
 *   3. 판이 뜨거워지면 곡도 뜨거워진다 (setIntensity)
 */

/** 미디 노트 번호 → 주파수 */
const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

/** 화음 — 베이스 음과 그 위에 쌓는 3화음 */
interface Chord {
  bass: number;
  tri: [number, number, number];
}

const CHORDS: Record<string, Chord> = {
  Am: { bass: 45, tri: [57, 60, 64] },
  F: { bass: 41, tri: [53, 57, 60] },
  C: { bass: 48, tri: [55, 60, 64] },
  G: { bass: 43, tri: [55, 59, 62] },
  Em: { bass: 40, tri: [55, 59, 64] },
  Dm: { bass: 38, tri: [57, 62, 65] },
};

/** 드럼 밀도 */
type DrumKit = 'none' | 'soft' | 'full' | 'break';

interface Section {
  /** 코드 진행 — 한 칸이 한 마디다 */
  chords: (keyof typeof CHORDS)[];
  drums: DrumKit;
  /** 멜로디를 얹을 것인가 */
  lead: boolean;
  /** 아르페지오를 깔 것인가 */
  arp: boolean;
}

interface Track {
  bpm: number;
  sections: Section[];
  /** 리드가 쓸 멜로디 — 마디(16스텝) 단위. 0은 쉼표 */
  melody: number[][];
}

/**
 * 멜로디는 A단조 펜타토닉(A C D E G)에서 고른다.
 * 아래 코드 진행(Am–F–C–G) 어디에 얹어도 어긋나지 않는 음들이라,
 * 마디마다 멜로디를 옮겨 적을 필요가 없다.
 */
const MELODY_A = [
  [69, 0, 72, 0, 76, 0, 74, 0, 72, 0, 0, 69, 0, 0, 0, 0],
  [67, 0, 72, 0, 74, 0, 76, 0, 79, 0, 76, 0, 74, 0, 0, 0],
  [69, 0, 72, 0, 76, 0, 79, 0, 81, 0, 79, 0, 76, 74, 0, 0],
  [72, 0, 71, 0, 69, 0, 67, 0, 69, 0, 0, 0, 0, 0, 0, 0],
];

const MELODY_MENU = [
  [69, 0, 0, 0, 72, 0, 0, 0, 76, 0, 0, 0, 0, 0, 74, 0],
  [72, 0, 0, 0, 69, 0, 0, 0, 67, 0, 0, 0, 0, 0, 0, 0],
];

/**
 * 전투 곡 — 네 구간 64마디 한 바퀴.
 * A(주제) → B(리드 등장) → 브레이크(비운다) → C(가장 두껍다)
 * 브레이크를 넣는 이유는 그 다음 구간이 세게 들리게 하기 위해서다.
 * 계속 세면 아무것도 세지 않다.
 */
const TRACKS: Record<BgmTrack, Track> = {
  battle: {
    bpm: 138,
    melody: MELODY_A,
    sections: [
      { chords: ['Am', 'Am', 'F', 'F'], drums: 'full', lead: false, arp: false },
      { chords: ['C', 'G', 'Am', 'Am'], drums: 'full', lead: true, arp: true },
      { chords: ['Dm', 'Dm', 'Em', 'Em'], drums: 'break', lead: false, arp: true },
      { chords: ['F', 'G', 'Am', 'G'], drums: 'full', lead: true, arp: true },
    ],
  },
  menu: {
    bpm: 96,
    melody: MELODY_MENU,
    sections: [
      { chords: ['Am', 'F'], drums: 'soft', lead: false, arp: true },
      { chords: ['C', 'G'], drums: 'soft', lead: true, arp: true },
      { chords: ['Am', 'Em'], drums: 'none', lead: true, arp: true },
      { chords: ['F', 'G'], drums: 'soft', lead: false, arp: true },
    ],
  },
};

/** 어느 곡을 트느냐 */
export type BgmTrack = 'menu' | 'battle';

class SoundSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private bgmBus: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;

  private muted = false;
  private bgmTimer: number | null = null;
  /** 곡 시작부터 흐른 16분음표 수 — 마디·구간이 전부 여기서 나온다 */
  private bgmStep = 0;
  private bgmNextTime = 0;
  private bgmTrack: BgmTrack | null = null;
  /** unlock 전에 들어온 재생 요청 */
  private pendingTrack: BgmTrack | null = null;
  /**
   * 무대가 곡을 비트는 정도 — 이조(반음)와 템포 배율.
   *
   * 무대마다 곡을 따로 쓰지 않는 이유: 네 곡을 쓰면 넷 다 어중간해진다.
   * 같은 곡을 조만 옮겨도 "다른 곳에 왔다"는 인상은 충분히 나고,
   * 곡 자체의 완성도는 하나에 몰아줄 수 있다.
   */
  private transpose = 0;
  private bpmMul = 1;
  /*
   * 곡의 열기는 두 축에서 따로 올라온다.
   *   - 경기 진행(넷 → 둘 남음)
   *   - 판의 규칙(서든데스 기믹)
   * 둘을 한 변수에 담으면 서든데스가 끝나는 순간 "둘 남음"까지 같이 꺼진다.
   * 따로 두고 큰 쪽을 쓴다.
   */
  private matchHeat: 0 | 1 | 2 = 0;
  private ruleHeat: 0 | 1 | 2 = 0;

  /* ================================================================ */
  /* 초기화                                                           */
  /* ================================================================ */

  /**
   * 첫 사용자 입력 시점에 호출한다.
   * 이미 초기화됐으면 suspended 상태만 해제한다.
   */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }

    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return;

    this.ctx = new Ctor();

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.34;
    this.master.connect(this.ctx.destination);

    this.bgmBus = this.ctx.createGain();
    this.bgmBus.gain.value = 0.5;
    this.bgmBus.connect(this.master);

    // 화이트 노이즈 버퍼 — 타격/착지음에 재사용
    const len = this.ctx.sampleRate * 0.5;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    // 소리를 켤 수 없던 동안 들어온 요청을 이제 처리한다
    if (this.pendingTrack) {
      const t = this.pendingTrack;
      this.pendingTrack = null;
      this.startBgm(t);
    }
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** 음소거 토글 — M 키에 연결한다 */
  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master) {
      this.master.gain.value = this.muted ? 0 : 0.34;
    }
    return this.muted;
  }

  /* ================================================================ */
  /* 효과음                                                           */
  /* ================================================================ */

  /**
   * 효과음 재생.
   * @param intensity 0~1. 타격 강도에 따라 피치와 두께가 달라진다.
   */
  play(name: SfxName, intensity = 0.5): void {
    if (!this.ctx || this.muted) return;
    const i = Math.max(0, Math.min(1, intensity));

    switch (name) {
      /*
       * 약공격 — 짧고 건조한 타격.
       * 연타가 쌓일수록(i가 커질수록) 피치가 올라가 몰아치는 느낌을 만든다.
       */
      case 'hitLight':
        this.noise({ dur: 0.07, gain: 0.5, freq: 1500 + i * 900, to: 600, q: 1.2 });
        this.tone({
          freq: 200 + i * 130,
          to: 90,
          type: 'square',
          dur: 0.09,
          gain: 0.28,
        });
        break;

      // 강공격 — 저역이 두껍고 피치가 크게 떨어진다
      case 'hitHeavy':
        this.noise({ dur: 0.14, gain: 0.62, freq: 1200 + i * 700, to: 260, q: 0.9 });
        this.tone({ freq: 150 + i * 60, to: 45, type: 'square', dur: 0.18, gain: 0.42 });
        this.tone({ freq: 80, to: 34, type: 'sine', dur: 0.24, gain: 0.5 });
        break;

      /*
       * 연속기 마무리 — 저역을 크게 깔고 금속성 배음을 얹는다.
       * 앞선 타들과 확실히 다른 소리라야 "끝냈다"가 귀로 전달된다.
       */
      case 'finisher':
        this.noise({ dur: 0.24, gain: 0.75, freq: 3200, to: 200, q: 0.6 });
        this.tone({ freq: 130, to: 32, type: 'square', dur: 0.3, gain: 0.5 });
        this.tone({ freq: 55, to: 26, type: 'sine', dur: 0.44, gain: 0.62 });
        this.tone({
          freq: 880,
          to: 260,
          type: 'triangle',
          dur: 0.36,
          gain: 0.22,
          delay: 0.03,
        });
        break;

      // 스킬 적중 — 강공격 + 금속성 배음
      case 'hitSkill':
        this.noise({ dur: 0.2, gain: 0.6, freq: 2600, to: 300, q: 0.7 });
        this.tone({ freq: 180, to: 40, type: 'sawtooth', dur: 0.26, gain: 0.4 });
        this.tone({ freq: 660, to: 220, type: 'triangle', dur: 0.3, gain: 0.24, delay: 0.02 });
        this.tone({ freq: 70, to: 30, type: 'sine', dur: 0.34, gain: 0.55 });
        break;

      // 헛스윙 — 바람 소리
      case 'whiff':
        this.noise({ dur: 0.12, gain: 0.16, freq: 900, to: 2400, q: 3 });
        break;

      case 'jump':
        this.tone({ freq: 240, to: 620, type: 'square', dur: 0.11, gain: 0.16 });
        break;

      // 2단 점프 — 한 옥타브 위
      case 'doubleJump':
        this.tone({ freq: 420, to: 980, type: 'square', dur: 0.12, gain: 0.16 });
        this.tone({ freq: 840, to: 1500, type: 'sine', dur: 0.1, gain: 0.1, delay: 0.03 });
        break;

      case 'land':
        this.noise({ dur: 0.08, gain: 0.2 + i * 0.2, freq: 420, to: 130, q: 1 });
        break;

      // 상장폐지 — 아래로 무너지는 스윕
      case 'ko':
        this.tone({ freq: 520, to: 48, type: 'sawtooth', dur: 0.8, gain: 0.36 });
        this.tone({ freq: 260, to: 32, type: 'square', dur: 0.9, gain: 0.26, delay: 0.06 });
        this.noise({ dur: 0.6, gain: 0.34, freq: 900, to: 120, q: 0.6, delay: 0.05 });
        break;

      // 떡상 — 위로 솟는 아르페지오
      case 'surge':
        [392, 523.25, 659.25, 880].forEach((f, n) => {
          this.tone({
            freq: f,
            type: 'triangle',
            dur: 0.22,
            gain: 0.2,
            delay: n * 0.055,
          });
        });
        break;

      // 스킬 시전 — 차오르는 소리
      case 'skill':
        this.tone({ freq: 180, to: 720, type: 'sawtooth', dur: 0.28, gain: 0.2 });
        this.tone({ freq: 360, to: 1440, type: 'sine', dur: 0.3, gain: 0.14, delay: 0.04 });
        break;

      case 'gambleWin':
        [523.25, 659.25, 783.99, 1046.5].forEach((f, n) => {
          this.tone({ freq: f, type: 'square', dur: 0.13, gain: 0.17, delay: n * 0.06 });
        });
        break;

      case 'gambleLose':
        [440, 349.23, 261.63].forEach((f, n) => {
          this.tone({ freq: f, type: 'square', dur: 0.17, gain: 0.17, delay: n * 0.08 });
        });
        break;

      case 'uiMove':
        this.tone({ freq: 660, type: 'square', dur: 0.05, gain: 0.12 });
        break;

      case 'uiConfirm':
        this.tone({ freq: 523.25, type: 'square', dur: 0.08, gain: 0.16 });
        this.tone({ freq: 1046.5, type: 'square', dur: 0.16, gain: 0.14, delay: 0.08 });
        break;
    }
  }

  /* ================================================================ */
  /* BGM — 16스텝 시퀀서                                              */
  /* ================================================================ */

  /**
   * 곡을 튼다.
   *
   * 같은 곡이 이미 돌고 있으면 아무것도 하지 않는다 — 씬을 옮길 때마다
   * 처음부터 다시 시작하면 곡이 늘 첫 마디만 들리게 되기 때문이다.
   * (제목 → 선택은 같은 menu 곡이므로 끊기지 않고 이어진다)
   */
  startBgm(track: BgmTrack = 'battle'): void {
    /*
     * 소리는 첫 입력 이후에만 켤 수 있다(브라우저 자동재생 정책). 제목 화면은
     * 그보다 먼저 뜨므로, 여기서 그냥 돌아가면 제목·선택 화면은 영영 조용하다.
     * 요청을 기억해 뒀다가 unlock 시점에 튼다.
     */
    if (!this.ctx) {
      this.pendingTrack = track;
      return;
    }
    if (this.bgmTrack === track && this.bgmTimer !== null) return;

    this.stopBgm();
    this.bgmTrack = track;
    this.matchHeat = 0;
    this.ruleHeat = 0;
    // 무대 색은 곡을 새로 틀 때 초기화한다 (메뉴로 나가면 기준 조로 돌아온다)
    this.transpose = 0;
    this.bpmMul = 1;
    this.bgmStep = 0;
    this.bgmNextTime = this.ctx.currentTime + 0.1;

    // 오디오 스레드보다 앞서 스케줄을 채워 끊김을 막는다
    this.bgmTimer = window.setInterval(() => this.scheduleBgm(), 40);
  }

  stopBgm(): void {
    if (this.bgmTimer !== null) {
      window.clearInterval(this.bgmTimer);
      this.bgmTimer = null;
    }
    this.bgmTrack = null;
  }

  /**
   * 판이 얼마나 뜨거운지 알려 준다.
   *
   * 0 평시 · 1 누군가 벼랑 끝 · 2 서든데스.
   * 곡을 바꾸는 것이 아니라 같은 곡 위에 층을 얹는다 — 곡이 갈아엎히면
   * 방금까지 듣던 흐름이 끊기고, 그러면 "긴장이 올랐다"가 아니라
   * "노래가 바뀌었다"로 들린다.
   */
  setIntensity(level: 0 | 1 | 2): void {
    this.matchHeat = level;
  }

  /** 기믹처럼 "지금 이 판의 규칙"이 만드는 열기 — 끝나면 0으로 되돌린다 */
  setRuleIntensity(level: 0 | 1 | 2): void {
    this.ruleHeat = level;
  }

  /**
   * 무대의 색을 곡에 입힌다.
   *
   * 곡이 도는 중에 바꿔도 된다 — 다음 스텝부터 반영되고, 화음 진행과
   * 마디 구조는 그대로라 흐름이 끊기지 않는다.
   */
  setStageTone(transpose = 0, bpmMul = 1): void {
    this.transpose = transpose;
    this.bpmMul = bpmMul;
  }

  private get heat(): number {
    return Math.max(this.matchHeat, this.ruleHeat);
  }

  /**
   * 스모크 테스트가 들여다보는 창.
   *
   * 소리는 스크린샷에 안 찍힌다. 시퀀서가 멈춰 있어도 화면은 멀쩡하므로,
   * "곡이 실제로 돌고 있는가"는 이 값이 늘어나는지로만 확인할 수 있다.
   */
  get bgmDebug(): {
    track: BgmTrack | null;
    step: number;
    heat: number;
    transpose: number;
    bpmMul: number;
  } {
    return {
      track: this.bgmTrack,
      step: this.bgmStep,
      heat: this.heat,
      transpose: this.transpose,
      bpmMul: this.bpmMul,
    };
  }

  private scheduleBgm(): void {
    const ctx = this.ctx;
    const track = this.bgmTrack ? TRACKS[this.bgmTrack] : null;
    if (!ctx || !track) return;

    // 뜨거워지면 조금 빨라진다. 크게 올리면 박자가 어긋난 것처럼 들린다
    const bpm = track.bpm * this.bpmMul * (1 + this.heat * 0.045);
    const stepDur = 60 / bpm / 4;

    while (this.bgmNextTime < ctx.currentTime + BGM_LOOKAHEAD) {
      this.scheduleStep(track, this.bgmNextTime - ctx.currentTime, stepDur);
      this.bgmNextTime += stepDur;
      this.bgmStep++;
    }
  }

  /** 16분음표 한 칸에 울릴 것들을 전부 예약한다 */
  private scheduleStep(track: Track, delay: number, stepDur: number): void {
    const bus = this.bgmBus;
    const bar = Math.floor(this.bgmStep / 16);
    const s = this.bgmStep % 16;

    /* 지금 어느 구간의 몇 번째 마디인가 */
    let acc = 0;
    let section = track.sections[0]!;
    let barInSection = 0;
    const cycle = track.sections.reduce((n, sec) => n + sec.chords.length, 0);
    const barInCycle = bar % cycle;
    for (const sec of track.sections) {
      if (barInCycle < acc + sec.chords.length) {
        section = sec;
        barInSection = barInCycle - acc;
        break;
      }
      acc += sec.chords.length;
    }

    const chord = CHORDS[section.chords[barInSection]!]!;
    const hot = this.heat;

    /* --- 드럼 ----------------------------------------------------- */
    this.scheduleDrums(section.drums, s, delay, hot);

    /* --- 베이스 --------------------------------------------------- */
    if (section.drums !== 'none') {
      // 8분음표 베이스. 뜨거우면 16분으로 쪼개 몰아친다
      const beat = hot >= 2 ? true : s % 2 === 0;
      if (beat) {
        // 마디 끝 두 칸은 한 옥타브 올려 다음 마디로 밀어 넣는다
        const note = s >= 14 ? chord.bass + 12 : chord.bass;
        this.tone({
          freq: mtof(note + this.transpose),
          type: 'sawtooth',
          dur: stepDur * 1.5,
          gain: 0.15,
          delay,
          bus,
        });
      }
    }

    /* --- 아르페지오 ----------------------------------------------- */
    if (section.arp && s % 2 === 0) {
      const note = chord.tri[(s / 2) % 3]!;
      this.tone({
        freq: mtof(note + 12 + this.transpose),
        type: 'square',
        dur: stepDur * 0.9,
        gain: 0.035 + hot * 0.008,
        delay,
        bus,
      });
    }

    /* --- 멜로디 --------------------------------------------------- */
    if (section.lead || hot >= 2) {
      const phrase = track.melody[bar % track.melody.length]!;
      const note = phrase[s];
      if (note) {
        this.tone({
          freq: mtof((hot >= 2 ? note + 12 : note) + this.transpose),
          type: 'triangle',
          dur: stepDur * 2.2,
          gain: 0.075,
          delay,
          bus,
        });
      }
    }
  }

  private scheduleDrums(kit: DrumKit, s: number, delay: number, hot: number): void {
    if (kit === 'none') return;
    const bus = this.bgmBus;

    const kick = (gain: number) =>
      this.tone({ freq: 125, to: 42, type: 'sine', dur: 0.15, gain, delay, bus });
    const hat = (gain: number) =>
      this.noise({ dur: 0.03, gain, freq: 8200, q: 2.2, delay, bus });
    const snare = () => {
      this.noise({ dur: 0.11, gain: 0.16, freq: 1900, q: 0.8, delay, bus });
      this.tone({ freq: 210, to: 150, type: 'triangle', dur: 0.08, gain: 0.1, delay, bus });
    };

    if (kit === 'soft') {
      if (s === 0 || s === 8) kick(0.34);
      if (s === 4 || s === 12) hat(0.05);
      return;
    }

    if (kit === 'break') {
      // 킥·스네어를 빼고 하이햇만 남긴다. 다음 구간이 세게 들리게 하는 자리다
      if (s % 2 === 1) hat(0.06);
      if (s === 15) snare(); // 다음 마디로 넘기는 한 방
      return;
    }

    /* full */
    if (s === 0 || s === 8 || s === 11) kick(s === 11 ? 0.3 : 0.5);
    if (s === 4 || s === 12) snare();
    if (hot >= 1 ? true : s % 2 === 1) hat(s % 2 === 1 ? 0.09 : 0.05);
    // 서든데스 — 매 마디 첫 칸에 크래시를 얹어 압박을 만든다
    if (hot >= 2 && s === 0) {
      this.noise({ dur: 0.45, gain: 0.12, freq: 6000, to: 2500, q: 0.5, delay, bus });
    }
  }

  /* ================================================================ */
  /* 합성 프리미티브                                                  */
  /* ================================================================ */

  private tone(o: ToneOpts & { bus?: GainNode | null }): void {
    const ctx = this.ctx;
    const dest = o.bus ?? this.master;
    if (!ctx || !dest) return;

    const t = ctx.currentTime + Math.max(0, o.delay ?? 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();

    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.to) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t + o.dur);
    }

    // 어택 3ms, 이후 지수 감쇠 — 클릭 노이즈를 피한다
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.gain, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);

    osc.connect(g);
    g.connect(dest);
    osc.start(t);
    osc.stop(t + o.dur + 0.03);
  }

  private noise(o: NoiseOpts & { bus?: GainNode | null }): void {
    const ctx = this.ctx;
    const dest = o.bus ?? this.master;
    if (!ctx || !dest || !this.noiseBuf) return;

    const t = ctx.currentTime + Math.max(0, o.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;

    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.Q.value = o.q ?? 1;
    filt.frequency.setValueAtTime(o.freq, t);
    if (o.to) {
      filt.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + o.dur);
    }

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.gain, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);

    src.connect(filt);
    filt.connect(g);
    g.connect(dest);
    src.start(t);
    src.stop(t + o.dur + 0.03);
  }
}

/** 전역 싱글턴 */
export const sound = new SoundSystem();
