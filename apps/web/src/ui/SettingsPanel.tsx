import { useEffect, useState } from 'react';
import { AccountManager } from '../crypto/AccountManager';
import { Prefs } from '../models/Prefs';
import { ping, describePingError, isBackendPingError } from '../sync/BackendPing';
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

  useEffect(() => {
    let mounted = true;
    AccountManager.open().then((a) => {
      if (!mounted) return;
      setAccount(a);
      a.subscribe(() => setVersion((v) => v + 1));
    });
    return () => { mounted = false; };
  }, []);

  if (!account) {
    return <div className="settings"><p className="muted">Loading account…</p></div>;
  }

  const onEnabled = (url: string): void => {
    Prefs.setCloudSyncEnabled(true);
    Prefs.setBackendURL(url);
    setBackendURL(url);
    setCloudSyncEnabled(true);
    setShowEnable(false);
  };

  const onDisable = (): void => {
    Prefs.setCloudSyncEnabled(false);
    setCloudSyncEnabled(false);
    setPingState({ kind: 'idle' });
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
    setCloudSyncEnabled(false);
    setConfirmForget(false);
    setShowMnemonic(false);
    setShowQR(false);
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

            <details open={showMnemonic} onToggle={(e) => setShowMnemonic((e.target as HTMLDetailsElement).open)}>
              <summary>Show mnemonic</summary>
              {account.mnemonic && (
                <>
                  <p className="warn">
                    Treat these 12 words like a password. Anyone with them can read and modify this account's tasks.
                  </p>
                  <pre className="mnemonic-box">{account.mnemonic}</pre>
                </>
              )}
            </details>

            <details open={showQR} onToggle={(e) => setShowQR((e.target as HTMLDetailsElement).open)}>
              <summary>Show QR code</summary>
              {account.mnemonic && (
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
