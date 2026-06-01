import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';

// jsdom's Uint8Array/ArrayBuffer live in a different realm than Node's
// webcrypto SubtleCrypto, which rejects cross-realm buffers with
// "2nd argument is not instance of ArrayBuffer, Buffer, TypedArray, or DataView".
// Wrap Subtle so every BufferSource is copied into a Node-realm Uint8Array first.
const toNodeBuffer = (data: ArrayBuffer | ArrayBufferView): Uint8Array => {
  if (data instanceof ArrayBuffer) {
    const copy = new Uint8Array(data.byteLength);
    copy.set(new Uint8Array(data));
    return copy;
  }
  const copy = new Uint8Array(data.byteLength);
  copy.set(
    new Uint8Array(
      data.buffer as ArrayBuffer,
      data.byteOffset,
      data.byteLength,
    ),
  );
  return copy;
};

const nodeSubtle = webcrypto.subtle;
const wrappedSubtle = new Proxy(nodeSubtle, {
  get(target, prop, receiver) {
    const value = Reflect.get(target, prop, receiver);
    if (typeof value !== 'function') return value;
    return (...args: unknown[]) => {
      const converted = args.map((arg) => {
        if (arg instanceof ArrayBuffer) return toNodeBuffer(arg);
        if (ArrayBuffer.isView(arg)) return toNodeBuffer(arg as ArrayBufferView);
        return arg;
      });
      return (value as (...a: unknown[]) => unknown).apply(target, converted);
    };
  },
});

const cryptoShim = {
  ...webcrypto,
  subtle: wrappedSubtle as SubtleCrypto,
  getRandomValues: <T extends ArrayBufferView | null>(buf: T): T => {
    if (buf == null) return buf;
    const tmp = new Uint8Array(buf.byteLength);
    webcrypto.getRandomValues(tmp);
    new Uint8Array(
      buf.buffer as ArrayBuffer,
      buf.byteOffset,
      buf.byteLength,
    ).set(tmp);
    return buf;
  },
  randomUUID: webcrypto.randomUUID.bind(webcrypto),
} as unknown as Crypto;

Object.defineProperty(globalThis, 'crypto', {
  value: cryptoShim,
  configurable: true,
});
