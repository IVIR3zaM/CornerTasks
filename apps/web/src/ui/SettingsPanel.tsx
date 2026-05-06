// Placeholder settings panel. The real key/mnemonic/DID UI and the
// "enable cloud sync" flow land in iteration 9; this just surfaces
// the standalone-by-default contract today.
export function SettingsPanel() {
  return (
    <div className="settings">
      <section>
        <h2>Cloud Sync — Off</h2>
        <p>
          This app stores everything locally and makes no network calls. Cross-device sync is
          opt-in and arrives in a later v0.2.0 iteration.
        </p>
      </section>

      <hr />

      <section>
        <h2>Account</h2>
        <p className="muted">
          Your <code>did:key</code> and recovery mnemonic will appear here once a key is
          generated (iteration 9 / 10).
        </p>
      </section>
    </div>
  );
}
