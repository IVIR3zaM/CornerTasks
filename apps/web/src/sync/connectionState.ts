// Connection-status state vocabulary shared by SyncEngine and its transports.
// Contract: docs/connection-status.md §1 (see also plan/v0.3.0/nodes/N03-status-contract.md).
// The set is closed — do not add a state here without updating that document first.

export type ConnectionState =
  | 'disabled'
  | 'checking'
  | 'live'
  | 'polling'
  | 'syncing'
  | 'queued'
  | 'failed';
