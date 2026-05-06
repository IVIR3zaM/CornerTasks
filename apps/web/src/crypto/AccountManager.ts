// SENSITIVE: holds the user's BIP-39 mnemonic in memory after a generate / import / load.
// Mirrors apps/macos/Sources/CornerTasks/Crypto/AccountManager.swift.

import * as mnemonic from './mnemonic';
import { fromBip39Seed, type Identity } from './identity';
import { MnemonicStore } from './MnemonicStore';

export class InvalidMnemonicError extends Error {
  constructor() {
    super('Invalid BIP-39 mnemonic');
    this.name = 'InvalidMnemonicError';
  }
}

export const normaliseMnemonic = (raw: string): string =>
  raw
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .join(' ');

export interface AccountState {
  did: string | null;
  mnemonic: string | null;
  identity: Identity | null;
}

export class AccountManager {
  private state: AccountState = { did: null, mnemonic: null, identity: null };
  private listeners = new Set<(s: AccountState) => void>();

  private constructor(private store: MnemonicStore) {}

  static async open(store?: MnemonicStore): Promise<AccountManager> {
    const s = store ?? (await MnemonicStore.open());
    const m = new AccountManager(s);
    await m.loadIfPresent();
    return m;
  }

  get did(): string | null { return this.state.did; }
  get mnemonic(): string | null { return this.state.mnemonic; }
  get identity(): Identity | null { return this.state.identity; }
  get hasKey(): boolean { return this.state.identity !== null; }

  subscribe(fn: (s: AccountState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => { this.listeners.delete(fn); };
  }

  async loadIfPresent(): Promise<void> {
    const m = await this.store.load();
    if (!m || !mnemonic.validate(m)) return;
    await this.applyMnemonic(m);
  }

  async generateNew(): Promise<string> {
    const m = mnemonic.generate();
    await this.store.save(m);
    await this.applyMnemonic(m);
    return m;
  }

  async importMnemonic(raw: string): Promise<string> {
    const normalised = normaliseMnemonic(raw);
    if (!mnemonic.validate(normalised)) throw new InvalidMnemonicError();
    await this.store.save(normalised);
    await this.applyMnemonic(normalised);
    return normalised;
  }

  async forget(): Promise<void> {
    await this.store.clear();
    this.set({ did: null, mnemonic: null, identity: null });
  }

  private async applyMnemonic(m: string): Promise<void> {
    const seed = await mnemonic.toSeed(m);
    const id = await fromBip39Seed(seed);
    this.set({ did: id.accountDid, mnemonic: m, identity: id });
  }

  private set(s: AccountState): void {
    this.state = s;
    for (const fn of this.listeners) fn(s);
  }
}
