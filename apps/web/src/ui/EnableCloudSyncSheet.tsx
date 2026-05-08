import { useState } from 'react';
import { AccountManager, InvalidMnemonicError } from '../crypto/AccountManager';
import { QRCodeImage } from './QRCodeImage';
import { QRScanner } from './QRScanner';
import { Prefs } from '../models/Prefs';
import { describePingError, isBackendPingError, ping } from '../sync/BackendPing';

type Step = 'chooser' | 'generated' | 'paste' | 'scan';

interface Props {
  account: AccountManager;
  onEnabled(url: string): void;
  onCancel(): void;
}

// Modal matching apps/macos EnableCloudSyncSheet: chooser → (generate | paste | scan) → backend URL → commit.
// Wording for the merge warning is identical to the macOS sheet per AGENTS.md.
export function EnableCloudSyncSheet({ account, onEnabled, onCancel }: Props): JSX.Element {
  const [step, setStep] = useState<Step>('chooser');
  const [generatedMnemonic, setGeneratedMnemonic] = useState('');
  const [backedUp, setBackedUp] = useState(false);
  const [pasteInput, setPasteInput] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [mergeAck, setMergeAck] = useState(false);
  const [apiUrl, setApiUrl] = useState(Prefs.backendURL() ?? '');
  const [did, setDid] = useState<string | null>(account.did);
  const [imported, setImported] = useState(false);
  const [urlTested, setUrlTested] = useState<{ url: string } | null>(null);
  const [urlTesting, setUrlTesting] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);

  const onUrlChange = (next: string): void => {
    setApiUrl(next);
    // Any edit invalidates a previous successful test.
    setUrlTested(null);
    setUrlError(null);
  };

  const testBackend = async (): Promise<void> => {
    if (!account.did) return;
    setUrlError(null);
    setUrlTesting(true);
    try {
      await ping(apiUrl, account.did);
      setUrlTested({ url: apiUrl.trim() });
    } catch (e) {
      setUrlTested(null);
      setUrlError(isBackendPingError(e) ? describePingError(e) : `Failed: ${String(e)}`);
    } finally {
      setUrlTesting(false);
    }
  };

  const urlIsTested = (): boolean => urlTested !== null && urlTested.url === apiUrl.trim();

  const generate = async (): Promise<void> => {
    try {
      const m = await account.generateNew();
      setGeneratedMnemonic(m);
      setDid(account.did);
      setStep('generated');
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'Could not generate a key.');
    }
  };

  const validatePaste = async (): Promise<void> => {
    setImportError(null);
    try {
      await account.importMnemonic(pasteInput);
      setDid(account.did);
      setImported(true);
    } catch (e) {
      setImported(false);
      setImportError(
        e instanceof InvalidMnemonicError
          ? "That doesn't look like a valid 12-word BIP-39 mnemonic."
          : `Could not import: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  };

  const onScanResult = async (text: string): Promise<void> => {
    setImportError(null);
    try {
      await account.importMnemonic(text);
      setPasteInput(text);
      setDid(account.did);
      setImported(true);
      setStep('paste');
    } catch (e) {
      setImportError(
        e instanceof InvalidMnemonicError
          ? "The QR code did not contain a valid 12-word BIP-39 mnemonic."
          : `Could not import: ${e instanceof Error ? e.message : String(e)}`
      );
      setStep('paste');
    }
  };

  const canCommit = (): boolean => {
    if (!account.hasKey || apiUrl.trim().length === 0) return false;
    if (!urlIsTested()) return false;
    if (step === 'generated') return backedUp;
    if (step === 'paste') return imported && mergeAck;
    return false;
  };

  const commit = (): void => {
    const url = apiUrl.trim();
    if (!url) return;
    onEnabled(url);
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Enable cloud sync">
      <div className="modal">
        <h2>{titleFor(step)}</h2>

        {step === 'chooser' && (
          <div className="enable-chooser">
            <p>Pick how this device joins an account.</p>
            <button type="button" className="enable-option" onClick={generate}>
              <strong>Generate new key</strong>
              <span>Creates a brand-new account. You'll see 12 words to back up — they are the only way to recover this account.</span>
            </button>
            <button type="button" className="enable-option" onClick={() => setStep('paste')}>
              <strong>Paste mnemonic</strong>
              <span>Paste the 12 words from another device. This device will join that account. Tasks already on this device will be merged with the account's tasks.</span>
            </button>
            <button type="button" className="enable-option" onClick={() => setStep('scan')}>
              <strong>Scan QR</strong>
              <span>Use your camera to scan the QR code shown by the macOS app. This device will join that account.</span>
            </button>
            <div className="modal-actions">
              <button type="button" className="btn-text" onClick={onCancel}>Cancel</button>
            </div>
          </div>
        )}

        {step === 'generated' && (
          <div className="enable-form">
            <p className="warn">
              Write these 12 words down somewhere safe. They are the only way to recover this account.
            </p>
            <pre className="mnemonic-box" aria-label="Mnemonic">{generatedMnemonic}</pre>
            {did && (
              <>
                <label className="field-label">DID</label>
                <code className="did-box">{did}</code>
              </>
            )}
            <QRCodeImage payload={generatedMnemonic} downloadName="cornertasks-mnemonic.png" />
            <label className="check-row">
              <input type="checkbox" checked={backedUp} onChange={(e) => setBackedUp(e.target.checked)} />
              I have backed up these words
            </label>
            {backendField()}
            {actionsRow()}
          </div>
        )}

        {step === 'paste' && (
          <div className="enable-form">
            <div className="merge-warning">
              If this key already controls another account on the cloud, the tasks on this device will be merged with that account's tasks. This cannot be undone.
            </div>
            <label className="field-label">Paste your 12-word mnemonic.</label>
            <textarea
              value={pasteInput}
              onChange={(e) => setPasteInput(e.target.value)}
              rows={3}
              className="mnemonic-input"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
            <div className="modal-row">
              <button type="button" className="btn-text" onClick={validatePaste}>Validate</button>
              {importError ? (
                <span className="error-text">{importError}</span>
              ) : did && imported ? (
                <span className="muted small">DID: {did}</span>
              ) : null}
            </div>
            <label className={`check-row${imported ? '' : ' disabled'}`}>
              <input
                type="checkbox"
                checked={mergeAck}
                onChange={(e) => setMergeAck(e.target.checked)}
                disabled={!imported}
              />
              I understand my local tasks will be merged into this account.
            </label>
            {!imported && (
              <p className="muted small">Validate the 12 words above to enable this checkbox.</p>
            )}
            {backendField()}
            {actionsRow()}
          </div>
        )}

        {step === 'scan' && (
          <div className="enable-form">
            <p>Point the camera at the QR code shown by the macOS app.</p>
            <QRScanner onResult={onScanResult} onCancel={() => setStep('chooser')} />
            {importError && <span className="error-text">{importError}</span>}
          </div>
        )}
      </div>
    </div>
  );

  function backendField(): JSX.Element {
    return (
      <div className="backend-field">
        <label className="field-label">Backend URL</label>
        <input
          type="url"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="https://…execute-api…amazonaws.com/Prod"
          value={apiUrl}
          onChange={(e) => onUrlChange(e.target.value)}
        />
        <div className="modal-row">
          <button
            type="button"
            className="btn-text"
            disabled={apiUrl.trim().length === 0 || urlTesting}
            onClick={testBackend}
          >
            {urlTesting ? 'Testing…' : 'Test'}
          </button>
          {urlIsTested() && <span className="ok-text">reachable</span>}
          {urlError && <span className="error-text">{urlError}</span>}
        </div>
        <p className="muted small">
          You must Test the URL before enabling sync. Paste the ApiUrl from your own backend deployment (see backend/aws/README.md).
        </p>
      </div>
    );
  }

  function actionsRow(): JSX.Element {
    return (
      <div className="modal-actions">
        <button type="button" className="btn-text" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn-primary" disabled={!canCommit()} onClick={commit}>
          Enable cloud sync
        </button>
      </div>
    );
  }
}

const titleFor = (s: Step): string => {
  switch (s) {
    case 'chooser': return 'Enable cloud sync';
    case 'generated': return 'Your new account';
    case 'paste': return 'Import existing account';
    case 'scan': return 'Scan QR code';
  }
};
