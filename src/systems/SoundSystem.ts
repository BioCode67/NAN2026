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

/** BGM 한 스텝(16분음표) 길이 계산용 BPM */
const BGM_BPM = 132;
/** 스케줄러 선행 시간 (초) */
const BGM_LOOKAHEAD = 0.25;

/** 마이너 펜타토닉 (A) — 어둡고 긴장감 있는 분위기 */
const BASS_PATTERN = [55, 55, 0, 55, 0, 73.42, 0, 55, 65.41, 0, 55, 0, 49, 0, 55, 0];
const LEAD_PATTERN = [440, 0, 523.25, 0, 587.33, 0, 523.25, 0, 440, 0, 392, 0, 440, 493.88, 0, 0];

class SoundSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private bgmBus: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;

  private muted = false;
  private bgmTimer: number | null = null;
  private bgmStep = 0;
  private bgmNextTime = 0;

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

  startBgm(): void {
    if (!this.ctx || this.bgmTimer !== null) return;

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
  }

  private scheduleBgm(): void {
    const ctx = this.ctx;
    if (!ctx) return;

    const stepDur = 60 / BGM_BPM / 4; // 16분음표

    while (this.bgmNextTime < ctx.currentTime + BGM_LOOKAHEAD) {
      const t = this.bgmNextTime;
      const s = this.bgmStep % 16;

      // 킥 — 4분음표마다
      if (s % 4 === 0) {
        this.tone({ freq: 120, to: 42, type: 'sine', dur: 0.14, gain: 0.5, delay: t - ctx.currentTime, bus: this.bgmBus });
      }

      // 하이햇 — 8분음표 뒤박
      if (s % 2 === 1) {
        this.noise({ dur: 0.03, gain: 0.09, freq: 8000, q: 2, delay: t - ctx.currentTime, bus: this.bgmBus });
      }

      // 베이스
      const bass = BASS_PATTERN[s];
      if (bass) {
        this.tone({ freq: bass, type: 'sawtooth', dur: stepDur * 1.6, gain: 0.16, delay: t - ctx.currentTime, bus: this.bgmBus });
      }

      // 리드 — 2마디마다 한 번씩만 등장시켜 단조로움을 던다
      const lead = LEAD_PATTERN[s];
      if (lead && Math.floor(this.bgmStep / 16) % 2 === 1) {
        this.tone({ freq: lead, type: 'triangle', dur: stepDur * 1.2, gain: 0.07, delay: t - ctx.currentTime, bus: this.bgmBus });
      }

      this.bgmNextTime += stepDur;
      this.bgmStep++;
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
