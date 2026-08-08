import type Peer from 'peerjs';
import type { DataConnection } from 'peerjs';
import type { CharacterId } from '../types';
import type { StageId } from '../config/stages';

/**
 * 온라인 대전 — 회선.
 *
 * ── 왜 이 구조인가 ─────────────────────────────────────────────────
 * 격투 게임의 정석은 롤백 넷코드다. 그런데 롤백은 **결정론적 시뮬레이션**을
 * 요구한다 — 같은 입력이면 어느 기계에서든 한 프레임도 어긋나지 않아야 한다.
 * 이 게임은 무작위와 물리에 기대고 있어서 그 조건을 못 맞추고, 맞추려면
 * 전투를 처음부터 다시 써야 한다.
 *
 * 그래서 **호스트가 판 전체를 계산한다.** 참가자는 자기 입력만 보내고
 * 돌아온 상태를 그린다. 참가자 쪽 입력에는 왕복 시간만큼 지연이 생기지만,
 * 어긋나는 일은 절대 없다 — 판이 한 군데에서만 계산되기 때문이다.
 *
 * 이 구조의 좋은 점은 **사람이 늘어도 구조가 그대로**라는 것이다.
 * 호스트는 이미 넷을 다 계산하고 있고, 보내는 상태에는 파이터 목록이 통째로
 * 들어간다. 봇 자리를 사람으로 바꾸는 것은 "그 자리의 입력을 어디서
 * 받는가"만 달라지는 일이라, 둘이든 넷이든 같은 코드가 돈다.
 *
 * ── 왜 서버가 없는가 ───────────────────────────────────────────────
 * 배포가 GitHub Pages(정적)라 우리 서버를 둘 수 없다. PeerJS 공개 브로커로
 * **연결만** 맺어 주고, 그 뒤 오가는 것은 전부 브라우저끼리 직접(P2P)이다.
 * 브로커가 죽어 있어도 게임은 로컬 모드로 멀쩡히 돌아간다.
 */

/** 한 판에 설 수 있는 인원 */
export const MAX_PLAYERS = 4;

/** 방 코드 길이 — 사람이 불러 주기 좋은 만큼 */
const CODE_LEN = 5;
/** 헷갈리는 글자(0/O, 1/I/L)를 뺀 코드용 글자 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/** 브로커에 등록할 때 붙이는 접두어 — 남의 방과 부딪히지 않게 */
const ROOM_PREFIX = 'delisting-brawl-';
/** 이 시간 안에 연결되지 않으면 실패로 본다 */
const CONNECT_TIMEOUT = 15000;

export type NetRole = 'host' | 'guest';

/** 호스트가 판을 열며 알려주는 것 — 참가자는 이걸로 같은 판을 세운다 */
export interface NetStart {
  /** 자리 순서대로의 캐릭터 (0번이 호스트) */
  chars: CharacterId[];
  /** 빈자리를 메우는 봇들 */
  bots: CharacterId[];
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
  /** 프롬프트 오브 [x, y, 남은체력 0~100]. 없으면 오브가 없다 */
  orb?: number[];
  /** 떨어져 있는 아이템들 [x, y, 종류번호] */
  item?: number[][];
  /** 판이 끝났으면 이긴 자리 번호 (-1 = 전원 탈락) */
  over?: number;
}

/** 로비 현황 — 누가 들어와 있고 누가 골랐는가 */
export interface NetLobby {
  /** 자리별 고른 캐릭터 (아직 안 골랐으면 null, 빈자리는 undefined) */
  picks: (CharacterId | null)[];
}

type Message =
  | { t: 'hello' }
  /** 오브를 깬 사람이 문장을 입력할 차례다 — 전원이 멈추고 지켜본다 */
  | { t: 'ask'; slot: number; who: string; accent: number }
  /** 입력한 문장 (참가자 → 호스트) */
  | { t: 'said'; text: string }
  /** 걸린 기믹 — 참가자는 이걸 받아 같은 화면을 그린다 */
  | { t: 'gimmick'; ids: string[]; text: string; who: string; note: string }
  | { t: 'welcome'; slot: number }
  | { t: 'full' }
  | { t: 'pick'; slot: number; c: CharacterId }
  | { t: 'lobby'; d: NetLobby }
  | { t: 'start'; d: NetStart }
  | { t: 'in'; slot: number; h: number; k: number }
  | { t: 'snap'; d: NetSnapshot }
  | { t: 'bye'; slot: number };

/**
 * 회선의 실체.
 *
 * 인터넷 너머(PeerJS)와 같은 컴퓨터의 다른 창(BroadcastChannel)을
 * 같은 껍데기로 다룬다. 위쪽 게임 코드는 어느 쪽인지 알 필요가 없다.
 */
interface Transport {
  /** to 를 주면 그 사람에게만, 없으면 전원에게 */
  send(msg: Message, to?: string): void;
  close(): void;
  readonly open: boolean;
  onMessage?: (m: Message, from: string) => void;
  /** 누군가 들어왔다 (호스트에서만) */
  onJoin?: (id: string) => void;
  onLeave?: (id: string, reason: string) => void;
}

/* ================================================================== */
/* 같은 컴퓨터 — 창 여러 개를 잇는다                                    */
/* ================================================================== */

interface LocalEnvelope {
  from: string;
  to?: string;
  role: NetRole;
  kind: 'knock' | 'here' | 'bye' | 'msg';
  body?: Message;
}

/**
 * 같은 컴퓨터의 창 여러 개를 잇는다.
 *
 * ── 왜 이게 필요한가 ───────────────────────────────────────────────
 * 온라인은 상대가 있어야 시험할 수 있다. 혼자 확인할 방법이 없으면
 * "되는 것 같다"에서 멈추고, 정작 사람 앞에서 안 되는 것을 그때 안다.
 *
 * 창 여러 개를 붙이면 인터넷도 상대도 없이 전 과정을 그대로 밟을 수 있다.
 * 검사도 이 길로 돌리고, 보여 줄 때도 이 길이면 회선 사정에 기대지 않는다.
 * 회선 종류만 다를 뿐 위의 게임 코드는 완전히 같다.
 */
class LocalTransport implements Transport {
  private ch: BroadcastChannel;
  private readonly me = Math.random().toString(36).slice(2);
  /** 호스트가 본 참가자들 / 참가자가 본 호스트 */
  private known = new Set<string>();

  open = true;
  onMessage?: (m: Message, from: string) => void;
  onJoin?: (id: string) => void;
  onLeave?: (id: string, reason: string) => void;

  constructor(
    room: string,
    private readonly role: NetRole,
  ) {
    this.ch = new BroadcastChannel(`delisting-brawl-local-${room}`);
    this.ch.onmessage = (e) => this.receive(e.data as LocalEnvelope);

    // 들어온 쪽이 먼저 손을 든다. 방 주인은 그 소리를 듣고 답한다
    this.announce(role === 'guest' ? 'knock' : 'here');
  }

  private announce(kind: 'knock' | 'here' | 'bye', to?: string): void {
    this.ch.postMessage({ from: this.me, to, role: this.role, kind });
  }

  private receive(env: LocalEnvelope): void {
    // 내가 보낸 것은 나에게도 돌아온다 — 그건 무시한다
    if (env.from === this.me) return;
    // 같은 역할끼리는 상대가 아니다 (참가자끼리는 직접 말하지 않는다)
    if (env.role === this.role) return;
    // 누구에게 보낸 것인지 적혀 있으면 그 사람만 받는다
    if (env.to && env.to !== this.me) return;

    if (env.kind === 'knock') {
      // 새로 들어온 사람에게만 답한다 — 이미 있던 사람에게 또 보내면 중복이다
      this.announce('here', env.from);
      this.link(env.from);
      return;
    }
    if (env.kind === 'here') {
      this.link(env.from);
      return;
    }
    if (env.kind === 'bye') {
      if (!this.known.delete(env.from)) return;
      this.onLeave?.(env.from, '상대가 나갔습니다.');
      return;
    }
    if (env.kind === 'msg' && env.body) this.onMessage?.(env.body, env.from);
  }

  private link(id: string): void {
    if (this.known.has(id)) return;
    this.known.add(id);
    this.onJoin?.(id);
  }

  send(msg: Message, to?: string): void {
    if (!this.open) return;
    this.ch.postMessage({ from: this.me, to, role: this.role, kind: 'msg', body: msg });
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.announce('bye');
    this.ch.close();
  }
}

/* ================================================================== */

export class NetSystem {
  private peer?: Peer;
  /** 인터넷 너머 회선들. 호스트는 여럿, 참가자는 하나 */
  private conns = new Map<string, DataConnection>();
  private local?: LocalTransport;

  role: NetRole = 'host';
  /** 방 코드 */
  code = '';
  /** 내 자리 번호 (0 = 호스트) */
  slot = 0;
  /** 연결이 살아 있는가 */
  connected = false;
  /** 마지막으로 상대 소식을 들은 시각 */
  lastHeard = 0;

  /** 호스트만: 자리 번호 → 회선 상대 id */
  private slots: (string | null)[] = [];
  /** 자리별 고른 캐릭터 */
  private picks: (CharacterId | null)[] = [];
  /**
   * 자리별로 마지막 소식을 들은 시각.
   *
   * 창을 그냥 닫으면 아무 인사도 오지 않는 회선이 있다(같은 컴퓨터 경로가
   * 그렇다). 그러면 남은 사람들은 서 있는 허수아비를 상대로 남은 판을 치른다.
   * 참가자는 매 프레임 자기 입력을 보내므로, **조용해진 자리 = 사라진 사람**이다.
   */
  private heardAt = new Map<number, number>();
  /**
   * 들어가려다 거절당한 이유.
   *
   * 자리를 받을 때까지 기다리는 쪽은 "아직 안 온 것"과 "영영 안 올 것"을
   * 구별할 수 없다. 거절을 들으면 여기 적어 두고, 기다리던 쪽이 그걸 보고
   * 곧바로 그만둔다 — 안 그러면 30초를 기다린 끝에 엉뚱한 이유를 듣는다.
   */
  private refused?: string;

  /* --- 바깥에서 꽂는 처리기 --------------------------------------- */
  /** 로비 인원·선택이 바뀌었다 */
  onLobby?: (lobby: NetLobby) => void;
  onStart?: (d: NetStart) => void;
  onInput?: (slot: number, held: number, taps: number) => void;
  /** 누군가 문장을 입력할 차례가 됐다 */
  onAsk?: (slot: number, who: string, accent: number) => void;
  /** 참가자가 문장을 보냈다 (호스트에서만) */
  onSaid?: (text: string) => void;
  /** 기믹이 걸렸다 — 화면을 맞춘다 */
  onGimmick?: (ids: string[], text: string, who: string, note: string) => void;
  onSnapshot?: (d: NetSnapshot) => void;
  /**
   * 참가자 하나가 빠졌다 (호스트에서만).
   *
   * 방이 통째로 깨진 것이 아니라 넷 중 하나가 창을 닫은 것이다. 남은 사람들의
   * 판은 계속되어야 하고, 빠진 사람의 캐릭터는 **누군가 이어받아야 한다** —
   * 안 그러면 셋이 서 있는 허수아비를 상대로 남은 판을 치른다.
   */
  onLeft?: (slot: number, reason: string) => void;
  onClose?: (reason: string) => void;

  /** 지금 방에 들어와 있는 사람 수 (호스트 포함) */
  get playerCount(): number {
    if (this.role === 'guest') return 0;
    return 1 + this.slots.filter(Boolean).length;
  }

  /** 자리별 선택 현황 (로비 표시용) */
  get lobby(): NetLobby {
    return { picks: this.picks.slice() };
  }

  /* ================================================================ */
  /* 방 열기 · 들어가기                                                */
  /* ================================================================ */

  private resetRoom(role: NetRole): void {
    this.refused = undefined;
    this.role = role;
    this.slot = role === 'host' ? 0 : -1;
    this.slots = [];
    this.picks = [null];
    this.connected = role === 'host';
  }

  /** 같은 컴퓨터의 다른 창과 잇는다 (인터넷·상대 없이 시험·시연) */
  connectLocal(role: NetRole, room = 'demo'): Promise<void> {
    this.resetRoom(role);
    this.code = room.toUpperCase();

    return new Promise((resolve, reject) => {
      const t = new LocalTransport(room, role);
      this.local = t;

      t.onMessage = (m, from) => {
        this.lastHeard = Date.now();
        this.handle(m, from);
      };
      t.onJoin = (id) => {
        if (role === 'host') {
          this.admit(id);
        } else {
          // 참가자는 호스트를 찾은 것이다 — 자리 배정을 요청한다
          this.connected = true;
          t.send({ t: 'hello' });
        }
      };
      t.onLeave = (id, reason) => this.dropGuest(id, reason);

      if (role === 'host') {
        // 방을 여는 것은 곧바로 끝난다 — 사람은 나중에 들어온다
        this.lastHeard = Date.now();
        resolve();
        return;
      }

      const timer = setTimeout(() => {
        t.close();
        this.local = undefined;
        reject(new Error('방을 연 창이 없습니다. 다른 창에서 먼저 "방 만들기"를 눌러 주세요.'));
      }, 30000);

      // 자리를 받아야 진짜로 들어간 것이다
      const tick = setInterval(() => {
        if (this.refused) {
          clearInterval(tick);
          clearTimeout(timer);
          const why = this.refused;
          t.close();
          this.local = undefined;
          reject(new Error(why));
          return;
        }
        if (this.slot < 0) return;
        clearInterval(tick);
        clearTimeout(timer);
        resolve();
      }, 80);
    });
  }

  /** 인터넷 너머로 방을 연다. 돌아오는 코드를 상대에게 알려주면 된다 */
  async host(): Promise<string> {
    this.resetRoom('host');
    this.code = randomCode();

    await this.openPeer(ROOM_PREFIX + this.code);

    this.peer!.on('connection', (conn) => {
      conn.on('open', () => {
        if (this.playerCount >= MAX_PLAYERS) {
          conn.send({ t: 'full' } satisfies Message);
          setTimeout(() => conn.close(), 200);
          return;
        }
        this.conns.set(conn.peer, conn);
        this.bindConn(conn);
        this.admit(conn.peer);
      });
    });

    return this.code;
  }

  /** 코드로 방에 들어간다 */
  async join(code: string): Promise<void> {
    this.resetRoom('guest');
    this.code = code.trim().toUpperCase();

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
        this.conns.set(conn.peer, conn);
        this.bindConn(conn);
        this.connected = true;
        conn.send({ t: 'hello' } satisfies Message);

        // 자리를 받아야 진짜로 들어간 것이다
        const tick = setInterval(() => {
          if (this.refused) {
            clearInterval(tick);
            clearTimeout(timer);
            reject(new Error(this.refused));
            return;
          }
          if (this.slot < 0) return;
          clearInterval(tick);
          clearTimeout(timer);
          resolve();
        }, 60);
      });
      conn.on('error', (err) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
  }

  /** 호스트: 새 사람에게 자리를 준다 */
  private admit(id: string): void {
    if (this.slots.includes(id)) return;
    /*
     * 자리가 없으면 **말해 준다.**
     *
     * 전에는 그냥 무시했다. 그러면 들어가려던 사람 화면에는 아무 일도
     * 일어나지 않고, 한참 뒤에 "방을 연 창이 없습니다"라는 엉뚱한 말이 뜬다 —
     * 방은 있고 자리가 없었을 뿐인데. 못 들어가는 것보다 이유를 모르는 것이
     * 나쁘다.
     */
    if (this.playerCount >= MAX_PLAYERS) {
      this.transportSend({ t: 'full' }, id);
      return;
    }

    /*
     * 빈 자리를 먼저 채운다.
     *
     * 나간 자리는 null 로 남는다. 그때 길이만 보고 번호를 주면 1번이 비었는데도
     * 다음 사람이 4번을 받고, 그 다음 사람은 5번 — **자리 수보다 큰 번호**가
     * 나가서 화면에 없는 캐릭터를 조종하게 된다.
     */
    const free = this.slots.indexOf(null);
    const at = free >= 0 ? free : this.slots.length;
    this.slots[at] = id;
    const slot = at + 1;
    this.picks[slot] = null;
    // 막 들어온 사람이 곧바로 "조용한 자리"로 몰리면 안 된다
    this.heardAt.set(slot, Date.now());

    this.transportSend({ t: 'welcome', slot }, id);
    this.broadcastLobby();
  }

  private dropGuest(id: string, reason: string): void {
    if (this.role === 'guest') {
      this.connected = false;
      this.onClose?.(reason);
      return;
    }
    const i = this.slots.indexOf(id);
    if (i < 0) return;
    this.slots[i] = null;
    this.picks[i + 1] = null;
    this.heardAt.delete(i + 1);
    this.broadcastLobby();
    // 판이 도는 중이면 그 자리를 누군가 이어받아야 한다
    this.onLeft?.(i + 1, reason);
  }

  /**
   * 호스트: 일정 시간 아무 입력도 오지 않은 자리들.
   *
   * 창을 닫았는지, 노트북을 덮었는지, 회선이 끊겼는지는 구별할 수 없고
   * 구별할 필요도 없다 — 어느 쪽이든 그 자리는 지금 아무도 조종하지 않는다.
   */
  quietSlots(ms: number): number[] {
    if (this.role !== 'host') return [];
    const now = Date.now();
    const out: number[] = [];
    this.slots.forEach((id, i) => {
      if (!id) return;
      const at = this.heardAt.get(i + 1) ?? 0;
      if (now - at > ms) out.push(i + 1);
    });
    return out;
  }

  /** 호스트: 그 자리를 비운다 (조용해진 자리를 정리할 때) */
  dropSlot(slot: number, reason: string): void {
    const id = this.slots[slot - 1];
    if (id) this.dropGuest(id, reason);
  }

  private broadcastLobby(): void {
    const d = this.lobby;
    this.transportSend({ t: 'lobby', d });
    /*
     * 듣는 쪽이 터져도 회선 장부는 계속 정리돼야 한다.
     *
     * 이 알림을 듣는 것은 씬이고, 씬은 사라진다. 사라진 씬의 처리기가 죽은
     * 화면 요소를 만지면 예외가 나는데, 그것이 여기서 위로 튀면 **자리 정리
     * 자체가 중간에 멈춘다.** 실제로 그래서 "나간 사람의 자리가 그대로
     * 남는" 일이 있었다 — 나간 것은 회선이 아는데 판이 못 들었다.
     */
    try {
      this.onLobby?.(d);
    } catch (err) {
      console.warn('[net] 로비 알림을 듣던 쪽에서 오류', err);
    }
  }

  /* ================================================================ */
  /* 보내기                                                            */
  /* ================================================================ */

  /** 내가 고른 캐릭터를 알린다 */
  sendPick(c: CharacterId): void {
    if (this.role === 'host') {
      this.picks[0] = c;
      this.broadcastLobby();
      return;
    }
    this.transportSend({ t: 'pick', slot: this.slot, c });
  }

  /** 호스트: 판을 연다 */
  sendStart(d: NetStart): void {
    this.transportSend({ t: 'start', d });
  }

  /** 참가자 → 호스트. 누르고 있는 것과 스쳐 간 눌림을 함께 */
  sendInput(held: number, taps: number): void {
    this.transportSend({ t: 'in', slot: this.slot, h: held, k: taps });
  }

  /** 호스트 → 전원. 판 전체의 현재 모습 */
  sendSnapshot(d: NetSnapshot): void {
    this.transportSend({ t: 'snap', d });
  }

  /** 호스트 → 전원. 이 자리 사람이 문장을 입력할 차례다 */
  sendAsk(slot: number, who: string, accent: number): void {
    this.transportSend({ t: 'ask', slot, who, accent });
  }

  /** 참가자 → 호스트. 입력한 문장 */
  sendSaid(text: string): void {
    this.transportSend({ t: 'said', text });
  }

  /** 호스트 → 전원. 무엇이 걸렸는지 */
  sendGimmick(ids: string[], text: string, who: string, note: string): void {
    this.transportSend({ t: 'gimmick', ids, text, who, note });
  }

  close(): void {
    try {
      this.transportSend({ t: 'bye', slot: this.slot });
    } catch {
      /* 이미 끊겼으면 그만이다 */
    }
    this.connected = false;
    this.local?.close();
    for (const c of this.conns.values()) c.close();
    this.peer?.destroy();
    this.local = undefined;
    this.conns.clear();
    this.peer = undefined;
    this.slots = [];
    this.picks = [];
  }

  /* ================================================================ */

  private transportSend(msg: Message, to?: string): void {
    if (this.local?.open) {
      this.local.send(msg, to);
      return;
    }
    if (to) {
      const c = this.conns.get(to);
      if (c?.open) c.send(msg);
      return;
    }
    for (const c of this.conns.values()) {
      if (c.open) c.send(msg);
    }
  }

  private async openPeer(id?: string): Promise<void> {
    /*
     * PeerJS 는 이때 처음 불러온다.
     *
     * 통째로 얹어 두면 온라인을 한 번도 안 켜는 사람도 그 무게를 내려받는다.
     * 첫 화면이 뜨는 속도는 심사에서 가장 먼저 보이는 것이라, 안 쓰는 기능이
     * 그걸 늦추게 둘 이유가 없다. (같은 컴퓨터 경로는 이것 없이도 돈다)
     */
    const { default: PeerCtor } = await import('peerjs');

    return new Promise((resolve, reject) => {
      const peer = id ? new PeerCtor(id) : new PeerCtor();
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
        reject(new Error(friendlyError(String((err as { type?: string }).type ?? err))));
      });

      peer.on('disconnected', () => {
        this.connected = false;
        this.onClose?.('연결이 끊어졌습니다.');
      });
    });
  }

  private bindConn(conn: DataConnection): void {
    conn.on('data', (raw) => {
      this.lastHeard = Date.now();
      this.handle(raw as Message, conn.peer);
    });
    conn.on('close', () => {
      this.conns.delete(conn.peer);
      this.dropGuest(conn.peer, '연결이 끊어졌습니다.');
    });
    conn.on('error', () => {
      this.conns.delete(conn.peer);
      this.dropGuest(conn.peer, '연결에 문제가 생겼습니다.');
    });
  }

  /** 어느 회선으로 왔든 받은 것은 여기서 갈린다 */
  private handle(msg: Message, from: string): void {
    switch (msg.t) {
      case 'hello':
        // 인터넷 너머에서는 연결이 열린 뒤 이 인사로 자리를 요청한다
        if (this.role === 'host') this.admit(from);
        break;
      case 'welcome':
        this.slot = msg.slot;
        this.connected = true;
        break;
      case 'full':
        this.refused = `방이 가득 찼습니다 (최대 ${MAX_PLAYERS}명).`;
        this.onClose?.(this.refused);
        break;
      case 'pick':
        if (this.role !== 'host') break;
        this.picks[msg.slot] = msg.c;
        this.broadcastLobby();
        break;
      case 'lobby':
        this.picks = msg.d.picks;
        this.onLobby?.(msg.d);
        break;
      case 'start':
        this.onStart?.(msg.d);
        break;
      case 'in':
        this.heardAt.set(msg.slot, Date.now());
        this.onInput?.(msg.slot, msg.h, msg.k);
        break;
      case 'snap':
        this.onSnapshot?.(msg.d);
        break;
      case 'ask':
        this.onAsk?.(msg.slot, msg.who, msg.accent);
        break;
      case 'said':
        if (this.role === 'host') this.onSaid?.(msg.text);
        break;
      case 'gimmick':
        this.onGimmick?.(msg.ids, msg.text, msg.who, msg.note);
        break;
      case 'bye':
        this.dropGuest(from, '상대가 나갔습니다.');
        break;
    }
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

/*
 * 창을 닫을 때 인사하고 나간다.
 *
 * 침묵으로도 알아채기는 하지만 그건 4초 뒤다. 그동안 남은 사람들은 멈춰 선
 * 캐릭터를 상대한다. 닫히는 순간에 한 마디 보내 두면 그 4초가 없어진다.
 *
 * unload 가 아니라 pagehide 를 쓴다 — 요즘 브라우저는 뒤로 가기를 대비해
 * 페이지를 살려 두기도 해서 unload 가 아예 안 불리는 경우가 있다.
 */
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    if (net.connected) net.close();
  });
}

/*
 * 검사에서 회선을 들여다보는 통로.
 *
 * 창 여러 개를 실제로 붙여 보는 검사(smoke:online)는 "몇 자리가 살아 있는가"를
 * 물어볼 방법이 있어야 한다. 이미 한 개짜리로 만들어 둔 것을 가리키기만 하므로
 * 새로 드는 것은 없다.
 */
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__net = net;
}
