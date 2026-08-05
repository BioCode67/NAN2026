import type { GameEventMap, GameEventName } from '../types';

type Handler<T> = (payload: T) => void;

/**
 * 타입 안전 이벤트 버스.
 *
 * 시스템 간 결합도를 낮추기 위해 모든 도메인 이벤트는 이 버스를 통해 오간다.
 * (예: StockSystem이 주가를 바꾸면 HUD/파티클은 이벤트만 듣고 반응한다)
 */
export class EventBus {
  /** 이벤트명 → 핸들러 집합 */
  private readonly listeners = new Map<GameEventName, Set<Handler<never>>>();

  /**
   * 이벤트 구독.
   * @returns 구독 해제 함수
   */
  on<K extends GameEventName>(
    event: K,
    handler: Handler<GameEventMap[K]>,
  ): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler as Handler<never>);
    return () => this.off(event, handler);
  }

  /** 1회만 실행되는 구독 */
  once<K extends GameEventName>(
    event: K,
    handler: Handler<GameEventMap[K]>,
  ): () => void {
    const dispose = this.on(event, (payload) => {
      dispose();
      handler(payload);
    });
    return dispose;
  }

  /** 구독 해제 */
  off<K extends GameEventName>(
    event: K,
    handler: Handler<GameEventMap[K]>,
  ): void {
    this.listeners.get(event)?.delete(handler as Handler<never>);
  }

  /**
   * 이벤트 발행.
   * 핸들러 하나가 예외를 던져도 나머지 핸들러는 계속 실행된다.
   */
  emit<K extends GameEventName>(event: K, payload: GameEventMap[K]): void {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return;

    // 콜백 안에서 off()를 호출해도 안전하도록 복사본을 순회한다.
    for (const handler of [...set]) {
      try {
        (handler as Handler<GameEventMap[K]>)(payload);
      } catch (err) {
        console.error(`[EventBus] "${event}" 핸들러에서 오류 발생:`, err);
      }
    }
  }

  /** 특정 이벤트(또는 전체)의 구독을 모두 제거. 씬 전환 시 반드시 호출한다. */
  clear(event?: GameEventName): void {
    if (event) this.listeners.delete(event);
    else this.listeners.clear();
  }
}

/** 전역 싱글턴 인스턴스 */
export const eventBus = new EventBus();
