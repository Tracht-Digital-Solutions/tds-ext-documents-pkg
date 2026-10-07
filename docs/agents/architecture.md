# Architecture

## Backend

`php/src/DocumentsModule.php` (namespace `Tds\Ext\Documents`) extends `AbstractModule`.

| Class | Role |
|---|---|
| `Domain/DocumentRepository` | Metadata rows via the core's shared `PDO` |
| `Support/DocumentStorage` | Files on disk under `DOCUMENT_ROOT_DIR`; MIME allow-list, 25 MB limit |
| `Service/DocumentSigner` | HMAC for share links, keyed by `DOCUMENT_SIGN_SECRET` |

| Route | Purpose |
|---|---|
| `GET /documents/summary` | Count for the dashboard widget |
| `GET /documents?projectId=` | List metadata |
| `POST /documents` | Upload (multipart, field `file`) |
| `PATCH /documents/{id:[0-9]+}` | Rename (file name is sanitised) |
| `GET /documents/{id:[0-9]+}/download` | JWT-gated stream |
| `POST /documents/{id:[0-9]+}/sign` | Mint a short-lived signed URL |
| `GET /documents/sign` | HMAC-verified download, no JWT |

## Auth and scope

- Auth is the core `UserContext`: `documents:read` / `documents:write` (admins bypass),
  scoped by `activeCompanyId()`.
- A non-admin without an active company has no scope: the summary returns 0 and
  per-document routes return 404. (`null` means "every company" to the repository.)
- A document outside the caller's company is a **404**, so ids can't be probed.

## Configuration

- `DOCUMENT_ROOT_DIR` — writable storage directory. Without it uploads are unavailable.
- `DOCUMENT_SIGN_SECRET` — share-link signing key. Without it both sign routes return
  **503**, and the island shows a "signed links are not configured" hint.

## Data model

- Table `documents_document`; migration `CreateDocumentsDocument` (`20260722000003`).
- **No customer/project foreign keys.** Those entities live in another domain, so
  `customer_id` / `project_id` are loose unsigned references. `customer_id` is the JWT's
  active company id.

## Frontend

- `src/index.ts` — the manifest: nav entry, `/documents` route, count widget.
- `pages/Index.astro` renders `DocumentList`.
- **No motion primitives on purpose.** The list is a `<table>`, and transforms on `<tr>`
  render unreliably across engines. If a real list is added, use
  `tds-shared/motion/react` as elsewhere.
- One rule for outcomes: upload, rename and share-link results are toasts (tds-shared
  `>=0.16.0`). `error` is the load failure only. `notice` keeps only the "signed links are
  not configured" hint, which is a configuration problem, not an outcome.
