import { useEffect, useRef, useState } from 'react';
import { AccountManager } from '../crypto/AccountManager';
import { clearRevealCredential, defaultMnemonicChallenge, makeRevealGate } from '../crypto/RevealGate';
import { Prefs, SYNC_INTERVAL_MAX_SECONDS, SYNC_INTERVAL_MIN_SECONDS } from '../models/Prefs';
import { ping, describePingError, isBackendPingError } from '../sync/BackendPing';
import { ensureDeviceId, fireCloudSyncChanged, fireCloudSyncIntervalChanged } from '../sync/SyncEngine';
import { EnableCloudSyncSheet } from './EnableCloudSyncSheet';
import { QRCodeImage } from './QRCodeImage';

type PingState =
  | { kind: 'idle' }
  | { kind: 'pinging' }
  | { kind: 'ok' }
  | { kind: 'failed'; message: string };

export function SettingsPanel(): JSX.Element {
  const [account, setAccount] = useState<AccountManager | null>(null);
  const [, setVersion] = useState(0);
  const [cloudSyncEnabled, setCloudSyncEnabled] = useState(Prefs.cloudSyncEnabled());
  const [backendURL, setBackendURL] = useState(Prefs.backendURL() ?? '');
  const [pingState, setPingState] = useState<PingState>({ kind: 'idle' });
  const [showEnable, setShowEnable] = useState(false);
  const [showMnemonic, setShowMnemonic] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [confirmForget, setConfirmForget] = useState(false);
  const initialInterval = decomposeInterval(Prefs.syncIntervalSeconds());
  const [intervalAmount, setIntervalAmount] = useState<number>(initialInterval.amount);
  const [intervalUnit, setIntervalUnit] = useState<IntervalUnit>(initialInterval.unit);

  useEffect(() => {
    let mounted = true;
    AccountManager.open().then((a) => {
      if (!mounted) return;
      setAccount(a);
      a.subscribe(() => setVersion((v) => v + 1));
    });
    return () => { mounted = false; };
  }, []);

  // Debounce slider/select changes so dragging or rapid arrow-key input does
  // not fire one engine reschedule per pixel. 500 ms is short enough that the
  // user perceives the change as "applied" once they pause. Declared before
  // the early return below so the hook order stays stable across renders.
  const intervalCommitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (intervalCommitTimer.current !== null) clearTimeout(intervalCommitTimer.current);
  }, []);

  if (!account) {
    return <div className="settings"><p className="muted">Loading account…</p></div>;
  }

  const onEnabled = (url: string): void => {
    Prefs.setCloudSyncEnabled(true);
    Prefs.setBackendURL(url);
    // Every enable — first time or re-enable — schedules a one-shot full
    // resync. The engine consumes (and clears) the flag on its next start.
    Prefs.setPendingFullResync(true);
    setBackendURL(url);
    setCloudSyncEnabled(true);
    setShowEnable(false);
    fireCloudSyncChanged(true);
  };

  const commitInterval = (amount: number, unit: IntervalUnit): void => {
    if (intervalCommitTimer.current !== null) clearTimeout(intervalCommitTimer.current);
    intervalCommitTimer.current = setTimeout(() => {
      intervalCommitTimer.current = null;
      const seconds = clampIntervalSeconds(toSeconds(amount, unit));
      if (seconds === Prefs.syncIntervalSeconds()) return;
      Prefs.setSyncIntervalSeconds(seconds);
      // Lightweight signal — the existing engine reschedules its timers and
      // keeps its bearer + AuthSession. Avoids the challenge/token + immediate
      // pull burst that a full restart would cause on every commit.
      fireCloudSyncIntervalChanged();
    }, 500);
  };

  const onIntervalAmount = (raw: string): void => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    const bounded = clampForUnit(n, intervalUnit);
    setIntervalAmount(bounded);
    commitInterval(bounded, intervalUnit);
  };

  const onIntervalUnit = (u: IntervalUnit): void => {
    const bounded = clampForUnit(intervalAmount, u);
    setIntervalUnit(u);
    setIntervalAmount(bounded);
    commitInterval(bounded, u);
  };

  const onDisable = (): void => {
    Prefs.setCloudSyncEnabled(false);
    setCloudSyncEnabled(false);
    setPingState({ kind: 'idle' });
    fireCloudSyncChanged(false);
  };

  const requireReveal = async (reason: string): Promise<boolean> => {
    if (!account.mnemonic) return false;
    const gate = makeRevealGate(defaultMnemonicChallenge(account.mnemonic));
    return gate.require(reason);
  };

  const toggleMnemonicReveal = async (open: boolean): Promise<void> => {
    if (!open) { setShowMnemonic(false); return; }
    const ok = await requireReveal('Confirm to display your mnemonic.');
    setShowMnemonic(ok);
  };

  const toggleQRReveal = async (open: boolean): Promise<void> => {
    if (!open) { setShowQR(false); return; }
    const ok = await requireReveal('Confirm to display the QR code.');
    setShowQR(ok);
  };

  const runPing = async (): Promise<void> => {
    if (!account.did) return;
    setPingState({ kind: 'pinging' });
    try {
      await ping(backendURL, account.did);
      setPingState({ kind: 'ok' });
      Prefs.setBackendURL(backendURL);
    } catch (e) {
      const msg = isBackendPingError(e) ? describePingError(e) : `Failed: ${String(e)}`;
      setPingState({ kind: 'failed', message: msg });
    }
  };

  const forget = async (): Promise<void> => {
    await account.forget();
    Prefs.setCloudSyncEnabled(false);
    clearRevealCredential();
    setCloudSyncEnabled(false);
    setConfirmForget(false);
    setShowMnemonic(false);
    setShowQR(false);
    fireCloudSyncChanged(false);
  };

  return (
    <div className="settings">
      <section>
        <h2>{cloudSyncEnabled && account.hasKey ? 'Cloud Sync — On' : 'Cloud Sync — Off'}</h2>

        {cloudSyncEnabled && account.hasKey ? (
          <>
            <p>Tasks on this device will sync to the backend you configured. The full sync engine activates in a later iteration.</p>
            <label className="field-label">Backend URL</label>
            <input
              type="url"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={backendURL}
              onChange={(e) => setBackendURL(e.target.value)}
              onBlur={() => Prefs.setBackendURL(backendURL)}
            />
            <div className="modal-row">
              <button
                type="button"
                className="btn-text"
                disabled={backendURL.trim().length === 0 || pingState.kind === 'pinging'}
                onClick={runPing}
              >
                {pingState.kind === 'pinging' ? 'Testing…' : 'Test'}
              </button>
              <button type="button" className="btn-text" onClick={() => Prefs.setBackendURL(backendURL)}>
                Save
              </button>
              {pingState.kind === 'ok' && <span className="ok-text">reachable</span>}
            </div>
            {pingState.kind === 'failed' && <p className="error-text">{pingState.message}</p>}

            <hr />
            <label className="field-label">Sync every</label>
            <div className="modal-row">
              <input
                type="number"
                min={unitMin(intervalUnit)}
                max={unitMax(intervalUnit)}
                step={1}
                value={intervalAmount}
                onChange={(e) => onIntervalAmount(e.target.value)}
                style={{ width: 80 }}
                aria-label="Sync interval amount"
              />
              <select
                value={intervalUnit}
                onChange={(e) => onIntervalUnit(e.target.value as IntervalUnit)}
                aria-label="Sync interval unit"
              >
                <option value="seconds">sec</option>
                <option value="minutes">min</option>
                <option value="hours">hr</option>
              </select>
            </div>
            <p className="muted small">Range: 10 s – 24 h. Applies to both push and pull.</p>

            <button type="button" className="btn-text" onClick={onDisable}>Disable cloud sync</button>
          </>
        ) : (
          <>
            <p>Cloud sync is off. Your tasks stay on this device.</p>
            <p className="muted small">
              You can stay offline forever. If you decide to enable later, you can either generate a new key (a brand new account) or import an existing key from another device (this device will join that account and merge its tasks with the existing ones).
            </p>
            <button type="button" className="btn-primary" onClick={() => setShowEnable(true)}>
              Enable cloud sync
            </button>
          </>
        )}
      </section>

      {account.hasKey && (
        <>
          <hr />
          <section>
            <h2>Account</h2>
            <label className="field-label">DID</label>
            <code className="did-box">{account.did}</code>

            <label className="field-label">Device ID <span className="debug-tag">debug</span></label>
            <code className="debug-id-block">{ensureDeviceId()}</code>

            <details
              open={showMnemonic}
              onToggle={(e) => void toggleMnemonicReveal((e.target as HTMLDetailsElement).open)}
            >
              <summary>Show mnemonic</summary>
              {showMnemonic && account.mnemonic && (
                <>
                  <p className="warn">
                    Treat these 12 words like a password. Anyone with them can read and modify this account's tasks.
                  </p>
                  <pre className="mnemonic-box">{account.mnemonic}</pre>
                </>
              )}
            </details>

            <details
              open={showQR}
              onToggle={(e) => void toggleQRReveal((e.target as HTMLDetailsElement).open)}
            >
              <summary>Show QR code</summary>
              {showQR && account.mnemonic && (
                <>
                  <p className="warn">
                    This QR code encodes the same 12 words as your mnemonic. Treat it like a password — anyone who scans it can read and modify this account's tasks.
                  </p>
                  <QRCodeImage payload={account.mnemonic} downloadName="cornertasks-mnemonic.png" />
                  <p className="muted small">Scan this with another device to import this account.</p>
                </>
              )}
            </details>

            {confirmForget ? (
              <div className="confirm-block">
                <p className="warn">
                  This wipes the mnemonic from this browser. Tasks on this device are kept; cloud sync turns off. If you have not backed up the 12 words, you cannot recover this account.
                </p>
                <div className="modal-row">
                  <button type="button" className="btn-text danger" onClick={forget}>Forget anyway</button>
                  <button type="button" className="btn-text" onClick={() => setConfirmForget(false)}>Cancel</button>
                </div>
              </div>
            ) : (
              <button type="button" className="btn-text" onClick={() => setConfirmForget(true)}>
                Forget this device
              </button>
            )}
          </section>
        </>
      )}

      {showEnable && (
        <EnableCloudSyncSheet
          account={account}
          onEnabled={onEnabled}
          onCancel={() => setShowEnable(false)}
        />
      )}
    </div>
  );
}

type IntervalUnit = 'seconds' | 'minutes' | 'hours';

const toSeconds = (amount: number, unit: IntervalUnit): number => {
  switch (unit) {
    case 'seconds': return amount;
    case 'minutes': return amount * 60;
    case 'hours':   return amount * 3600;
  }
};

const decomposeInterval = (s: number): { amount: number; unit: IntervalUnit } => {
  if (s >= 3600 && s % 3600 === 0) return { amount: Math.min(24, s / 3600), unit: 'hours' };
  if (s >= 60 && s % 60 === 0)     return { amount: Math.min(59, s / 60),   unit: 'minutes' };
  return { amount: Math.max(10, Math.min(59, s)), unit: 'seconds' };
};

const unitMin = (u: IntervalUnit): number => (u === 'seconds' ? 10 : 1);
const unitMax = (u: IntervalUnit): number => (u === 'hours' ? 24 : 59);
const clampForUnit = (n: number, u: IntervalUnit): number =>
  Math.max(unitMin(u), Math.min(unitMax(u), Math.floor(n)));
const clampIntervalSeconds = (s: number): number =>
  Math.max(SYNC_INTERVAL_MIN_SECONDS, Math.min(SYNC_INTERVAL_MAX_SECONDS, Math.floor(s)));
