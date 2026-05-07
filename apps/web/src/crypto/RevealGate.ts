// Per-reveal user-presence gate. Mirrors apps/macos/Sources/CornerTasks/Crypto/RevealGate.swift.
//
// Implementation: WebAuthn platform authenticator (passkey). On first reveal we register a
// discoverable platform credential (Touch ID / Windows Hello / Android biometric) and store
// its credential id in localStorage. Every subsequent reveal calls `navigator.credentials.get`
// with `allowCredentials: [{id: <storedId>}]` which scopes the prompt to that specific local
// passkey — the OS does NOT open the cross-device picker because we name the credential we
// want.
//
// Fallback: if WebAuthn is unavailable (`PublicKeyCredential` undefined, or no platform
// authenticator), we drop to a confirm modal asking the user to retype the LAST FOUR WORDS
// of their mnemonic. Weaker, but works on browsers without WebAuthn.
//
// The gate's decision is NEVER cached or persisted across reveals — every disclosure open
// re-runs the prompt fresh. The only persisted state is the registered credential id.

const CREDENTIAL_ID_KEY = 'cornertasks.reveal.credentialId';
const USER_HANDLE_KEY = 'cornertasks.reveal.userHandle';
const RP_NAME = 'CornerTasks';

export interface RevealGate {
  require(reason: string): Promise<boolean>;
}

export interface MnemonicRevealChallenge {
  /** Returns the last four words of the user's mnemonic, lowercase, space-joined. */
  expectedTail(): string;
  /** Prompts the user to retype the last four words. Resolves with what they typed (trimmed/lowercased) or null on cancel. */
  ask(reason: string): Promise<string | null>;
}

/** Test seam: when set, replaces the entire gate. Reset to null between tests. */
export const RevealGateOverride: { fn: ((reason: string) => Promise<boolean>) | null } = { fn: null };

const b64urlEncode = (bytes: Uint8Array): string => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};

const b64urlDecode = (s: string): Uint8Array => {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const std = s.replaceAll('-', '+').replaceAll('_', '/') + pad;
  const bin = atob(std);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const randomBytes = (n: number): Uint8Array => {
  const b = new Uint8Array(n);
  if (typeof crypto !== 'undefined') crypto.getRandomValues(b);
  return b;
};

const isWebAuthnSupported = async (): Promise<boolean> => {
  if (typeof window === 'undefined' || typeof PublicKeyCredential === 'undefined') return false;
  if (typeof navigator === 'undefined' || !navigator.credentials) return false;
  try {
    const fn = (PublicKeyCredential as unknown as {
      isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean>;
    }).isUserVerifyingPlatformAuthenticatorAvailable;
    if (!fn) return false;
    return await fn.call(PublicKeyCredential);
  } catch {
    return false;
  }
};

const getStoredCredentialId = (): Uint8Array | null => {
  const s = localStorage.getItem(CREDENTIAL_ID_KEY);
  if (!s) return null;
  try {
    return b64urlDecode(s);
  } catch {
    return null;
  }
};

const getOrCreateUserHandle = (): Uint8Array => {
  const existing = localStorage.getItem(USER_HANDLE_KEY);
  if (existing) {
    try { return b64urlDecode(existing); } catch { /* fall through */ }
  }
  const fresh = randomBytes(16);
  localStorage.setItem(USER_HANDLE_KEY, b64urlEncode(fresh));
  return fresh;
};

const registerPasskey = async (): Promise<Uint8Array | null> => {
  try {
    const cred = (await navigator.credentials.create({
      publicKey: {
        rp: { name: RP_NAME },
        user: {
          id: getOrCreateUserHandle() as BufferSource,
          name: 'cornertasks-local',
          displayName: 'CornerTasks (this browser)',
        },
        challenge: randomBytes(32) as BufferSource,
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },    // ES256
          { type: 'public-key', alg: -257 },  // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'preferred',
        },
        timeout: 60_000,
        attestation: 'none',
      },
    })) as PublicKeyCredential | null;
    if (!cred) return null;
    const rawId = new Uint8Array(cred.rawId);
    localStorage.setItem(CREDENTIAL_ID_KEY, b64urlEncode(rawId));
    return rawId;
  } catch {
    return null;
  }
};

const assertPasskey = async (credentialId: Uint8Array): Promise<boolean> => {
  try {
    const cred = await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32) as BufferSource,
        allowCredentials: [
          { id: credentialId as BufferSource, type: 'public-key', transports: ['internal'] },
        ],
        userVerification: 'required',
        timeout: 60_000,
      },
    });
    return cred !== null;
  } catch {
    return false;
  }
};

export const clearRevealCredential = (): void => {
  localStorage.removeItem(CREDENTIAL_ID_KEY);
  localStorage.removeItem(USER_HANDLE_KEY);
};

export const hasRegisteredPasskey = (): boolean => getStoredCredentialId() !== null;

export const makeRevealGate = (challenge: MnemonicRevealChallenge): RevealGate => ({
  async require(reason: string): Promise<boolean> {
    if (RevealGateOverride.fn) return RevealGateOverride.fn(reason);

    if (await isWebAuthnSupported()) {
      let credentialId = getStoredCredentialId();
      if (!credentialId) {
        // First reveal: register a passkey. The Touch ID / biometric prompt that
        // creates the credential IS the auth proof — treat success as a passed gate.
        const registered = await registerPasskey();
        if (registered) return true;
        // Registration failed (cancelled, blocked, unsupported). Fall through to
        // mnemonic-tail so the user isn't permanently locked out.
      } else if (await assertPasskey(credentialId)) {
        return true;
      } else {
        // Either the user cancelled, or the credential was deleted from the OS
        // keychain. Drop the stale id so the NEXT reveal starts a fresh
        // registration instead of looping on a missing credential.
        if (!hasOSCredential(credentialId)) clearRevealCredential();
        return false;
      }
    }

    const typed = await challenge.ask(reason);
    if (typed === null) return false;
    return typed.trim().toLowerCase() === challenge.expectedTail();
  },
});

// We can't actually probe the OS keychain for the credential — there's no API.
// Stub kept for clarity; in practice we only clear on explicit "forget" or when
// the user tells us the credential is gone.
const hasOSCredential = (_id: Uint8Array): boolean => true;

/** Builds the challenge text for the mnemonic-tail fallback. */
export const lastFourWords = (mnemonic: string): string =>
  mnemonic.trim().toLowerCase().split(/\s+/).slice(-4).join(' ');

/**
 * Default fallback prompt: a `window.prompt(...)` asking for the last four words.
 * UI code that wants a styled modal should pass its own `MnemonicRevealChallenge.ask`
 * implementation instead.
 */
export const defaultMnemonicChallenge = (mnemonic: string): MnemonicRevealChallenge => ({
  expectedTail: () => lastFourWords(mnemonic),
  ask: async (reason: string): Promise<string | null> => {
    if (typeof window === 'undefined' || typeof window.prompt !== 'function') return null;
    const answer = window.prompt(
      `${reason}\n\nType the LAST FOUR WORDS of your mnemonic to confirm.`,
      ''
    );
    return answer;
  },
});
