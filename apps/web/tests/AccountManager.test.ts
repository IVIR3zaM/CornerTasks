import { describe, expect, it } from 'vitest';
import { MnemonicStore } from '../src/crypto/MnemonicStore';
import { AccountManager, InvalidMnemonicError, normaliseMnemonic } from '../src/crypto/AccountManager';

const dbName = (): string => `cornertasks-account-test-${Math.random().toString(36).slice(2)}`;

const open = async (): Promise<AccountManager> => {
  const store = await MnemonicStore.open(dbName());
  return AccountManager.open(store);
};

const VALID = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('normaliseMnemonic', () => {
  it('lowercases, trims, and collapses whitespace', () => {
    expect(normaliseMnemonic('  Abandon\tABANDON\nabandon  about ')).toBe('abandon abandon abandon about');
  });
  it('returns empty string for whitespace-only input', () => {
    expect(normaliseMnemonic('   \n\t')).toBe('');
  });
});

describe('AccountManager', () => {
  it('starts with no key', async () => {
    const a = await open();
    expect(a.hasKey).toBe(false);
    expect(a.did).toBeNull();
    expect(a.mnemonic).toBeNull();
  });

  it('rejects an invalid mnemonic', async () => {
    const a = await open();
    await expect(a.importMnemonic('not a real mnemonic at all')).rejects.toBeInstanceOf(InvalidMnemonicError);
    expect(a.hasKey).toBe(false);
  });

  it('imports a valid mnemonic, derives a did:key, persists it', async () => {
    const a = await open();
    const imported = await a.importMnemonic(`  ${VALID.toUpperCase()}  `);
    expect(imported).toBe(VALID);
    expect(a.hasKey).toBe(true);
    expect(a.did).toMatch(/^did:key:z[1-9A-HJ-NP-Za-km-z]+$/);
    expect(a.mnemonic).toBe(VALID);
  });

  it('generateNew produces a 12-word mnemonic and a did:key', async () => {
    const a = await open();
    const m = await a.generateNew();
    expect(m.split(' ')).toHaveLength(12);
    expect(a.did).toMatch(/^did:key:z[1-9A-HJ-NP-Za-km-z]+$/);
  });

  it('forget clears state', async () => {
    const a = await open();
    await a.importMnemonic(VALID);
    await a.forget();
    expect(a.hasKey).toBe(false);
    expect(a.did).toBeNull();
    expect(a.mnemonic).toBeNull();
  });

  it('subscribe fires on state changes and on initial subscribe', async () => {
    const a = await open();
    const states: (string | null)[] = [];
    const off = a.subscribe((s) => states.push(s.did));
    await a.importMnemonic(VALID);
    off();
    expect(states[0]).toBeNull();
    expect(states[states.length - 1]).toMatch(/^did:key:/);
  });
});
