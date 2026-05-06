import { afterEach, describe, expect, it } from 'vitest';
import { MnemonicStore } from '../src/crypto/MnemonicStore';

const dbName = (): string => `cornertasks-secrets-test-${Math.random().toString(36).slice(2)}`;

describe('MnemonicStore', () => {
  const opened: MnemonicStore[] = [];
  afterEach(() => {
    while (opened.length) opened.pop()!.close();
  });

  const open = async (): Promise<MnemonicStore> => {
    const s = await MnemonicStore.open(dbName());
    opened.push(s);
    return s;
  };

  it('returns null when nothing is stored', async () => {
    const s = await open();
    expect(await s.load()).toBeNull();
  });

  it('round-trips a mnemonic', async () => {
    const s = await open();
    const m = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    await s.save(m);
    expect(await s.load()).toBe(m);
  });

  it('overwrites on save', async () => {
    const s = await open();
    await s.save('one one one');
    await s.save('two two two');
    expect(await s.load()).toBe('two two two');
  });

  it('clears the stored mnemonic', async () => {
    const s = await open();
    await s.save('something');
    await s.clear();
    expect(await s.load()).toBeNull();
  });
});
