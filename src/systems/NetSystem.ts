import Peer from 'peerjs';
import type { DataConnection } from 'peerjs';
import type { CharacterId } from '../types';
import type { StageId } from '../config/stages';

/**
 * 온라인 1:1 결투 — 회선.
 *
 * ── 왜 이 구조인가 ─────────────────────────────────────────────────
 * 격투 게임의 정석은 롤백 넷코드다. 그런데 롤백은 **결정론적 시뮬레이션**을
 * 요구한다 — 같은 입력이면 어느 기계에서든 한 프레임도 어긋나지 않아야 한다.
 * 이 게임은 무작위와 물리에 기대고 있어서 그 조건을 못 맞추고, 맞추려면
 * 전투를 처음부터 다시 써야 한다.
 *
 * 그래서 **호스트가 판 전체를 계산한다.** 게스트는 자기 입력만 보내고
 * 돌아온 상태를 그린다. 게스트 쪽 입력에는 왕복 시간만큼 지연이 생기지만,
 * 어긋나는 일은 절대 없다 — 판이 한 군데에서만 계산되기 때문이다.
 * 3일 안에 "가끔 두 화면이 다른 게임을 하는" 것보다 이쪽이 낫다.
 *
 * ── 왜 서버가 없는가 ───────────────────────────────────────────────
 * 배포가 GitHub Pages(정적)라 우리 서버를 둘 수 없다. PeerJS 공개 브로커로
 * **연결만** 맺어 주고, 그 뒤 오가는 것은 전부 브라우저끼리 직접(P2P)이다.
 * 브로커가 죽어 있어도 게임은 로컬 모드로 멀쩡히 돌아간다 —
 * 온라인은 있으면 좋은 것이지 없으면 안 되는 것이 아니다.
 */

/** 방 코드 길이 — 사람이 불러 주기 좋은 만큼 */
const CODE_LEN = 5;
/** 헷갈리는 글자(0/O, 1/I/L)를 뺀 코드용 글자 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/** 브로커에 등록할 때 붙이는 접두어 — 남의 방과 부딪히지 않게 */
const ROOM_PREFIX = 'delisting-brawl-';
/** 이 시간 안에 연결되지 않으면 실패로 본다 */
const CONNECT_TIMEOUT = 15000;
/** 상대 소식이 이만큼 끊기면 연결이 끊긴 것으로 본다 */
export const NET_TIMEOUT = 6000;

export type NetRole = 'host' | 'guest';

/**
 * 회선의 실체.
 *
 * 인터넷 너머(PeerJS)와 같은 컴퓨터의 다른 탭(BroadcastChannel)을
 * 같은 껍데기로 다룬다. 위쪽 게임 코드는 어느 쪽인지 알 필요가 없다.
 */
interface Transport {
  send(msg: unknown): void;
  close(): void;
  readonly open: boolean;
  onMessage?: (m: unknown) => void;
  onClose?: (reason: string) => void;
}

/**
 * 같은 컴퓨터의 탭 두 개를 잇는다.
 *
 * ── 왜 이게 필요한가 ───────────────────────────────────────────────
 * 온라인은 상대가 있어야 시험할 수 있다. 혼자 확인할 방법이 없으면
 * "되는 것 같다"에서 멈추고, 정작 사람 앞에서 안 되는 것을 그때 안다.
 *
 * 같은 컴퓨터에서 탭 두 개를 붙이면 인터넷도 상대도 없이 전 과정을
 * 그대로 밟을 수 있다. 검사도 이 길로 돌리고, 보여 줄 때도 이 길이면
 * 회선 사정에 기대지 않는다. 회선 종류만 다를 뿐 위의 게임 코드는 같다.
 */
class LocalTransport implements Transport {
  private ch: BroadcastChannel;
  private readonly me = Math.random().toString(36).slice(2);
  private peerSeen = false;

  open = true;
  onMessage?: (m: unknown) => void;
  onClose?: (reason: string) => void;

  constructor(
    room: string,
    private readonly role: NetRole,
    private readonly onLink: () => void,
  ) {
    this.ch = new BroadcastChannel(`delisting-brawl-local-${room}`);
    this.ch.onmessage = (e) => this.receive(e.data as LocalEnvelope);

    // 들어온 쪽이 먼저 손을 든다. 방 주인은 그 소리를 듣고 답한다
    if (role === 'guest') this.announce('knock');
    else this.announce('here');
  }

  private announce(kind: 'knock' | 'here' | 'bye'): void {
    this.ch.postMessage({ from: this.me, role: this.role, kind });
  }

  private receive(env: LocalEnvelope): void {
    // 내가 보낸 것은 나에게도 돌아온다 — 그건 무시한다
    if (env.from === this.me) return;
    // 같은 역할끼리는 상대가 아니다 (탭 셋을 열었을 때)
    if (env.role === this.role) return;

    if (env.kind === 'knock') {
      this.link();
      this.announce('here');
      return;
    }
    if (env.kind === 'here') {
      this.link();
      return;
    }
    if (env.kind === 'bye') {
      this.open = false;
      this.onClose?.('상대가 나갔습니다.');
      return;
    }
    if (env.kind === 'msg') this.onMessage?.(env.body);
  }

  private link(): void {
    if (this.peerSeen) return;
    this.peerSeen = true;
    this.onLink();
  }

  send(msg: unknown): void {
    if (!this.open) return;
    this.ch.postMessage({ from: this.me, role: this.role, kind: 'msg', body: msg });
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.announce('bye');
    this.ch.close();
  }
}

interface LocalEnvelope {
  from: string;
  role: NetRole;
  kind: 'knock' | 'here' | 'bye' | 'msg';
  body?: unknown;
}

/** 호스트가 판을 열며 알려주는 것 — 게스트는 이걸로 같은 판을 세운다 */
export interface NetStart {
  hostChar: CharacterId;
  guestChar: CharacterId;
  stageId: StageId;
}

/** 호스트가 매 전송마다 보내는 판 상태 */
export interface NetSnapshot {
  /** 몇 번째 전송인가 — 늦게 도착한 옛 상태를 버리는 데 쓴다 */
  n: number;
  /** 파이터별 [x, y, vx, vy, facing, 살아있음, 주가, 포즈번호] */
  f: number[][];
  /** 이번 구간에 일어난 타격 [x, y, 색, 마무리인가] */
  hit?: number[][];
  /** 판이 끝났으면 이긴 쪽 (0=호스트, 1=게스트, -1=무승부) */
  over?: number;
}

type Message =
  | { t: 'pick'; c: CharacterId }
  | { t: 'start'; d: NetStart }
  | { t: 'in'; h: number; k: number }
  | { t: 'snap'; d: NetSnapshot }
  | { t: 'bye' };

export class NetSystem {
  private peer?: Peer;
  private conn?: DataConnection;
  /** 같은 컴퓨터의 다른 탭과 이어졌을 때 쓰는 회선 */
  private local?: LocalTransport;

  role: NetRole = 'host';
  /** 방 코드 (호스트가 만들어 알려준다) */
  code = '';
  /** 연결이 살아 있는가 */
  connected = false;
  /** 마지막으로 상대 소식을 들은 시각 */
  lastHeard = 0;

  /* --- 바깥에서 꽂는 처리기 --------------------------------------- */
  onPick?: (c: CharacterId) => void;
  onStart?: (d: NetStart) => void;
  onInput?: (held: number, taps: number) => void;
  onSnapshot?: (d: NetSnapshot) => void;
  onClose?: (reason: string) => void;

  /* ================================================================ */

  /**
   * 방을 연다. 돌아오는 코드를 상대에게 불러 주면 된다.
   * 상대가 들어올 때까지 기다리지 않고 코드부터 돌려준다.
   */
  async host(): Promise<string> {
    this.role = 'host';
    this.code = randomCode();

    await this.openPeer(ROOM_PREFIX + this.code);

    this.peer!.on('connection', (conn) => {
      // 이미 한 명 들어와 있으면 더 받지 않는다 (1:1이다)
      if (this.conn) {
        conn.close();
        return;
      }
      this.bind(conn);
    });

    return this.code;
  }

  /**
   * 같은 컴퓨터의 다른 탭과 잇는다 (인터넷·상대 없이 시험·시연).
   *
   * 코드는 고정이라 외울 것이 없다. 탭 하나에서 "이 컴퓨터에서 둘이"를
   * 호스트로, 다른 탭에서 게스트로 고르면 그대로 붙는다.
   */
  connectLocal(role: NetRole, room = 'demo'): Promise<void> {
    this.role = role;
    this.code = room.toUpperCase();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.local?.close();
        this.local = undefined;
        reject(
          new Error(
            role === 'host'
              ? '다른 탭이 들어오지 않았습니다. 같은 주소를 새 탭에서 열고 "참가"를 눌러 주세요.'
              : '방을 연 탭이 없습니다. 다른 탭에서 먼저 "방 만들기"를 눌러 주세요.',
          ),
        );
      }, 30000);

      this.local = new LocalTransport(room, role, () => {
        clearTimeout(timer);
        this.connected = true;
        this.lastHeard = Date.now();
        resolve();
      });

      this.local.onMessage = (m) => {
        this.lastHeard = Date.now();
        this.handle(m as Message);
      };
      this.local.onClose = (reason) => {
        this.connected = false;
        this.onClose?.(reason);
      };
    });
  }

  /** 코드로 방에 들어간다 */
  async join(code: string): Promise<void> {
    this.role = 'guest';
    this.code = code.trim().toUpperCase();

    // 게스트는 아무 이름으로나 등록해도 된다 — 남이 찾아올 일이 없다
    await this.openPeer();

    const conn = this.peer!.connect(ROOM_PREFIX + this.code, {
      reliable: true,
      metadata: { game: 'delisting-brawl' },
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('상대를 찾지 못했습니다. 코드를 다시 확인해 주세요.')),
        CONNECT_TIMEOUT,
      );
      conn.on('open', () => {
        clearTimeout(timer);
        this.bind(conn);
        resolve();
      });
      conn.on('error', (err) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
  }

  /** 상대가 들어올 때까지 기다린다 (호스트) */
  waitForGuest(timeoutMs = 120000): Promise<void> {
    if (this.connected) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('아무도 들어오지 않았습니다.')),
        timeoutMs,
      );
      const tick = setInterval(() => {
        if (!this.connected) return;
        clearInterval(tick);
        clearTimeout(timer);
        resolve();
      }, 120);
    });
  }

  /* --- 보내기 ------------------------------------------------------ */

  /** 내가 고른 캐릭터를 알린다 (선택 화면) */
  sendPick(c: CharacterId): void {
    this.send({ t: 'pick', c });
  }

  sendStart(d: NetStart): void {
    this.send({ t: 'start', d });
  }

  /** 게스트 → 호스트. 누르고 있는 것과 스쳐 간 눌림을 함께 보낸다 */
  sendInput(held: number, taps: number): void {
    this.send({ t: 'in', h: held, k: taps });
  }

  /** 호스트 → 게스트. 판 전체의 현재 모습 */
  sendSnapshot(d: NetSnapshot): void {
    this.send({ t: 'snap', d });
  }

  close(): void {
    try {
      this.send({ t: 'bye' });
    } catch {
      /* 이미 끊겼으면 그만이다 */
    }
    this.connected = false;
    this.local?.close();
    this.conn?.close();
    this.peer?.destroy();
    this.local = undefined;
    this.conn = undefined;
    this.peer = undefined;
  }

  /** 상대 소식이 끊긴 지 오래됐는가 */
  isStale(now: number): boolean {
    return this.connected && this.lastHeard > 0 && now - this.lastHeard > NET_TIMEOUT;
  }

  /* ================================================================ */

  private send(msg: Message): void {
    if (this.local?.open) {
      this.local.send(msg);
      return;
    }
    if (!this.conn?.open) return;
    this.conn.send(msg);
  }

  private openPeer(id?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      /*
       * PeerJS 기본값은 공개 브로커다. 여기서 하는 일은 "코드로 서로를
       * 찾아 주는 것"뿐이고, 연결이 맺어진 뒤의 통신은 브로커를 거치지 않는다.
       */
      const peer = id ? new Peer(id) : new Peer();
      this.peer = peer;

      const timer = setTimeout(() => {
        reject(new Error('연결 서버에 닿지 못했습니다. 잠시 뒤 다시 시도해 주세요.'));
      }, CONNECT_TIMEOUT);

      peer.on('open', () => {
        clearTimeout(timer);
        resolve();
      });

      peer.on('error', (err) => {
        clearTimeout(timer);
        const msg = String((err as { type?: string }).type ?? err);
        // 같은 코드가 이미 쓰이고 있으면 다른 코드로 다시 열면 된다
        reject(new Error(friendlyError(msg)));
      });

      peer.on('disconnected', () => {
        this.connected = false;
        this.onClose?.('연결이 끊어졌습니다.');
      });
    });
  }

  /** 어느 회선으로 왔든 받은 것은 여기서 갈린다 */
  private handle(msg: Message): void {
    switch (msg.t) {
      case 'pick':
        this.onPick?.(msg.c);
        break;
      case 'start':
        this.onStart?.(msg.d);
        break;
      case 'in':
        this.onInput?.(msg.h, msg.k);
        break;
      case 'snap':
        this.onSnapshot?.(msg.d);
        break;
      case 'bye':
        this.connected = false;
        this.onClose?.('상대가 나갔습니다.');
        break;
    }
  }

  private bind(conn: DataConnection): void {
    this.conn = conn;
    this.connected = true;
    this.lastHeard = Date.now();

    conn.on('data', (raw) => {
      this.lastHeard = Date.now();
      this.handle(raw as Message);
    });

    conn.on('close', () => {
      this.connected = false;
      this.onClose?.('연결이 끊어졌습니다.');
    });

    conn.on('error', () => {
      this.connected = false;
      this.onClose?.('연결에 문제가 생겼습니다.');
    });
  }
}

/* ------------------------------------------------------------------ */

function randomCode(): string {
  let out = '';
  for (let i = 0; i < CODE_LEN; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

/** PeerJS 오류 문자열을 사람이 읽을 말로 바꾼다 */
function friendlyError(type: string): string {
  if (type.includes('unavailable-id')) {
    return '같은 코드의 방이 이미 있습니다. 다시 만들어 주세요.';
  }
  if (type.includes('peer-unavailable')) {
    return '그런 방이 없습니다. 코드를 확인해 주세요.';
  }
  if (type.includes('network') || type.includes('server-error')) {
    return '연결 서버에 닿지 못했습니다. 인터넷 상태를 확인해 주세요.';
  }
  if (type.includes('browser-incompatible')) {
    return '이 브라우저는 P2P 연결을 지원하지 않습니다.';
  }
  return '연결에 실패했습니다.';
}

/** 씬끼리 넘겨 쓰는 하나짜리 회선 */
export const net = new NetSystem();
