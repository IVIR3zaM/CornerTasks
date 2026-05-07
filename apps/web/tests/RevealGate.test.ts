import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  RevealGateOverride,
  defaultMnemonicChallenge,
  lastFourWords,
  makeRevealGate,
} from '../src/crypto/RevealGate';

beforeEach(() => {
  RevealGateOverride.fn = null;
  globalThis.indexedDB = new IDBFactory();
  localStorage.clear();
});

afterEach(() => {
  RevealGateOverride.fn = null;
});

describe('lastFourWords', () => {
  it('returns the trailing four words, lowercased', () => {
    expect(lastFourWords('one two three four five six SEVEN eight nine ten Eleven twelve')).toBe(
      'nine ten eleven twelve'
    );
  });
});

describe('makeRevealGate', () => {
  it('uses the override when set', async () => {
    const challenge = defaultMnemonicChallenge('a b c d e f g h i j k l');
    const gate = makeRevealGate(challenge);

    RevealGateOverride.fn = async () => true;
    expect(await gate.require('show mnemonic')).toBe(true);

    RevealGateOverride.fn = async () => false;
    expect(await gate.require('show mnemonic')).toBe(false);
  });

  it('falls back to the mnemonic-tail challenge when accepted', async () => {
    const m = 'one two three four five six seven eight nine ten eleven twelve';
    const ask = async (): Promise<string | null> => 'nine ten eleven twelve';
    const gate = makeRevealGate({ expectedTail: () => lastFourWords(m), ask });
    expect(await gate.require('reveal')).toBe(true);
  });

  it('rejects an incorrect mnemonic-tail answer', async () => {
    const m = 'one two three four five six seven eight nine ten eleven twelve';
    const ask = async (): Promise<string | null> => 'wrong wrong wrong wrong';
    const gate = makeRevealGate({ expectedTail: () => lastFourWords(m), ask });
    expect(await gate.require('reveal')).toBe(false);
  });

  it('treats a cancelled prompt as a failed reveal', async () => {
    const ask = async (): Promise<string | null> => null;
    const gate = makeRevealGate({ expectedTail: () => 'a b c d', ask });
    expect(await gate.require('reveal')).toBe(false);
  });

  it('does not write to localStorage or IndexedDB', async () => {
    const ask = async (): Promise<string | null> => 'a b c d';
    const gate = makeRevealGate({ expectedTail: () => 'a b c d', ask });
    await gate.require('reveal');
    expect(localStorage.length).toBe(0);
    // IndexedDB has no databases without a prior open call — fake-indexeddb's databases()
    // helper is the cleanest probe.
    const dbs = await (indexedDB as unknown as { databases?: () => Promise<unknown[]> }).databases?.();
    if (dbs) expect(dbs.length).toBe(0);
  });
});
