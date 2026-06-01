# Fixtures — preview-only sample data

These JSON files **only** drive the visual previewer. The real apps ignore them;
they get data from their own stores (SQLite, IndexedDB).

Fixtures fill list-shaped bindings (`tasks.active`, `tasks.archived`) and
read-only scalar bindings (`account.did`, `device.id`) so the previewer can
show realistic, populated screens — including every visual state of a row
(overdue, due today, etc.).

Keys are binding ids from `design/actions.json`. Values for list bindings are
arrays of objects whose fields are referenced by `{item.<field>}` in the
screen's row component props.

When you add a new component variant or visual state, extend the fixture so
the preview shows it.
