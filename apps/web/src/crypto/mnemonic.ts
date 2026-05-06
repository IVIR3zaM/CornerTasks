import { generateMnemonic, mnemonicToSeed, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';

export const WORD_COUNT = 12;
const ENTROPY_BITS = 128;

export const generate = (): string => generateMnemonic(wordlist, ENTROPY_BITS);

export const validate = (mnemonic: string): boolean => validateMnemonic(mnemonic, wordlist);

/** BIP-39 seed: PBKDF2-HMAC-SHA512(mnemonic, "mnemonic"+passphrase, 2048, 64). NFKD-normalised. */
export const toSeed = async (mnemonic: string, passphrase: string = ''): Promise<Uint8Array> =>
  new Uint8Array(await mnemonicToSeed(mnemonic, passphrase));
