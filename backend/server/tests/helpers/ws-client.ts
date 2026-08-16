// A deliberately dumb WebSocket client for the §11 tests.
//
// It answers nothing automatically — in particular it does *not* reply to
// `ping`, because the heartbeat test needs a peer that goes silent, and a
// helper that auto-ponged would make that test pass for the wrong reason. It
// keeps every frame it ever received, so tests can assert "exactly once"
// rather than "at least once".

import { WebSocket } from 'ws';

export interface WsFrame {
  type: string;
  [k: string]: unknown;
}

export interface CloseInfo {
  code: number;
  reason: string;
}

export class TestClient {
  readonly frames: WsFrame[] = [];
  close_: CloseInfo | null = null;
  private readonly waiters: {
    predicate: (f: WsFrame) => boolean;
    resolve: (f: WsFrame) => void;
    reject: (e: Error) => void;
    timer: NodeJS.Timeout;
  }[] = [];
  private readonly closeWaiters: { resolve: (c: CloseInfo) => void; timer: NodeJS.Timeout }[] = [];

  private constructor(private readonly socket: WebSocket) {
    socket.on('message', (data) => {
      const frame = JSON.parse(data.toString('utf8')) as WsFrame;
      this.frames.push(frame);
      for (let i = this.waiters.length - 1; i >= 0; i--) {
        const w = this.waiters[i]!;
        if (w.predicate(frame)) {
          clearTimeout(w.timer);
          this.waiters.splice(i, 1);
          w.resolve(frame);
        }
      }
    });
    socket.on('close', (code, reason) => {
      this.close_ = { code, reason: reason.toString('utf8') };
      for (const w of this.closeWaiters.splice(0)) {
        clearTimeout(w.timer);
        w.resolve(this.close_);
      }
    });
    socket.on('error', () => {
      /* surfaced through `close` */
    });
  }

  static open(url: string): Promise<TestClient> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      const client = new TestClient(socket);
      socket.once('open', () => resolve(client));
      socket.once('error', reject);
    });
  }

  send(frame: unknown): void {
    this.socket.send(JSON.stringify(frame));
  }

  sendRaw(data: string | Buffer): void {
    this.socket.send(data);
  }

  /** Resolves with the first frame — already received or yet to arrive —
   *  matching `predicate`. Scanning the backlog first removes the ordering
   *  hazard of "the frame arrived while the test was doing something else". */
  waitFor(predicate: (f: WsFrame) => boolean, timeoutMs = 3000): Promise<WsFrame> {
    const existing = this.frames.find(predicate);
    if (existing) return Promise.resolve(existing);
    if (this.close_) {
      return Promise.reject(new Error(`socket closed (${this.close_.code}) before a matching frame`));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(
            `timed out waiting for frame; received: ${JSON.stringify(this.frames.map((f) => f.type))}` +
              (this.close_ ? ` (closed ${this.close_.code})` : '')
          )
        );
      }, timeoutMs);
      this.waiters.push({ predicate, resolve, reject, timer });
    });
  }

  waitType(type: string, timeoutMs = 3000): Promise<WsFrame> {
    return this.waitFor((f) => f.type === type, timeoutMs);
  }

  waitClose(timeoutMs = 3000): Promise<CloseInfo> {
    if (this.close_) return Promise.resolve(this.close_);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for close')), timeoutMs);
      this.closeWaiters.push({ resolve, timer });
    });
  }

  of(type: string): WsFrame[] {
    return this.frames.filter((f) => f.type === type);
  }

  /** Every event id this client has been delivered, in arrival order, across
   *  every `events` frame. */
  deliveredEventIds(): string[] {
    const ids: string[] = [];
    for (const frame of this.of('events')) {
      for (const ev of (frame.events as { eventId: string }[]) ?? []) ids.push(ev.eventId);
    }
    return ids;
  }

  /** The `nextCursor` of every `events` frame, in arrival order. */
  cursors(): string[] {
    return this.of('events').map((f) => String(f.nextCursor));
  }

  async close(): Promise<void> {
    if (this.close_) return;
    this.socket.close(1000, 'test_done');
    await this.waitClose().catch(() => undefined);
  }

  terminate(): void {
    this.socket.terminate();
  }
}

/** Lets a test observe that nothing arrived, which is the assertion for
 *  "fan-out excludes the sender" and for cross-account isolation. A negative
 *  needs a real wait; there is no event to hang it off. */
export function settle(ms = 150): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
