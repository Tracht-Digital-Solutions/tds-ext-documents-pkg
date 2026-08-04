# Agent notes — tds-ext-documents

The customer↔owner document store. Read `tds-frontend-contract-pkg`'s AGENTS.md
first (extension contract) and `tds-ext-support-tickets-pkg` as the reference
full port — this extension follows the same shape.

## Architecture

- **Backend** (`php/src/DocumentsModule.php`, namespace `Tds\Ext\Documents`) — extends
  `AbstractModule`. Routes: `GET /documents` (thread, marks counterpart msgs read),
  `POST /documents`, `PATCH /documents/{id}`, `GET /documents/summary` (widget unread
  count). Auth is entirely the core `UserContext`: `documents:read`/`documents:write`
  (admins bypass), scoped by `activeCompanyId()`. `author_type` = `owner` for admin,
  else `customer`. Data via the core shared `PDO`; repository in `Domain/`.
- **Ownership on edit** — admins edit any document; a customer only their own
  `author_type='customer'` rows scoped to their company (`rowCount()==0` → 404, so
  ids aren't leakable). Ported verbatim from the legacy `Message\UpdateAction`.
- **Frontend** (`src/index.ts` manifest + `pages/Index.astro` + `islands/*`) — nav
  entry, `/documents` route (`MessageThread`), and the `documents-unread` widget.

## Gotchas

- **Two channels became one rule.** The island had `error` (danger) AND `notice`
  (info) for outcomes; upload/rename/share-link outcomes are toasts now
  (tds-shared `>=0.16.0`), `error` is the LOAD failure only, and `notice` keeps
  just the "signed links are not configured" hint — a configuration problem, not
  an outcome. Never mount a `ToastHost` here; the frontend host owns the one.

- **No customer/project FK** — those entities live in another domain (auth /
  customer management), so `customer_id`/`project_id` are loose unsigned refs;
  `customer_id` = the JWT active company id (nullable = admin all-company view).
- **Migration class name AND numeric prefix are extension-unique** (shared phinxlog
  across all composed extensions): `CreateDocumentsMessage`, `20260722000001`.
- **Depends on the published contract** VCS-only (Composer `type:vcs`), npm `^1.0.0`
  from GitHub Packages — never a `path` repo.
- **Extension routes are Layout-wrapped by the host** (`panelHost({ layout })`); the
  page renders only its `<section>`, never a full `<html>`.

## Tests (frontend)

```bash
npm run test:run    # vitest, 85 tests (jsdom per-file via a @vitest-environment docblock)
```

- `islands/DocumentList.test.tsx` — list, upload, rename, download, share. Two
  things leave the browser and get the sharpest assertions:
  - **the upload is multipart `FormData` under the field name `file`**, with NO
    hand-set `Content-Type` — setting one drops the multipart boundary and the
    backend receives nothing. Both failure modes are separate mutants.
  - **"Link teilen" mints a signed, short-lived URL to a customer document.** A
    503 (signing not configured) says so explicitly; a generic "konnte nicht
    erstellt werden" would invite endless retries against a feature the host
    has not enabled.
  A **403 is its own state**, not an error: the user simply has no document
  access, and the upload control is absent entirely.
  `fmtSize` is pinned at both boundaries (1023/1024 B, 1048575/1048576 B) and
  on its decimal places.
- `islands/WidgetBody.test.tsx` — the count tile.
- `src/index.test.ts` + `tests/packaging.test.ts` — the manifest as a product
  build sees it, and that every specifier resolves, is exported, and ships.

Error-path tests deliberately answer with a POPULATED body and a non-OK status.
Against an EMPTY error body the ok-check is unobservable.

### Two testing notes worth keeping

- **`userEvent.setup()` installs its own `navigator.clipboard` stub.** A
  clipboard fake must be defined AFTER the user is created or the share tests
  silently observe nothing. (jsdom has no clipboard at all, and `navigator` is a
  read-only accessor, so it has to go on the real object via
  `Object.defineProperty`.)
- **`navigator.clipboard?.writeText(url).catch(…)` is safe without a clipboard.**
  Optional chaining short-circuits the WHOLE chain, `.catch()` included, so an
  insecure-context browser still gets the confirmation — it just does not get
  the copy. Asserted as graceful degradation.

Verified by mutation: 44 deliberate breakages introduced, 43 caught. The
forty-fourth — dropping `iso.replace(" ", "T")` in `fmtDate` — is **equivalent
under V8**: Node parses `"2026-07-20 09:00:00"` happily. It is NOT equivalent in
Safari/WebKit, where the space form is an Invalid Date, so the normalisation
stays. It cannot be caught from a jsdom suite.
