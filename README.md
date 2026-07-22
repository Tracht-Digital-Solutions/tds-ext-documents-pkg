# tds-ext-documents

Customer↔owner **document store** extension for the TDS frontend platform. Ported
from `tds-customer-api` (the legacy `document` table + Message actions) so the
feature can retire the legacy customer portal (`tds-customer-legacy-frontend`).

Ships both halves of a panel extension:

- **Frontend manifest** (`@tracht-digital-solutions/tds-ext-documents`) — a nav
  entry, the `/documents` route, an unread-count dashboard widget, and
  `documents:read` / `documents:write` permissions.
- **PHP Module** (`tracht-digital-solutions/tds-ext-documents`, namespace
  `Tds\Ext\Documents`) — the `/documents` REST routes (list / create / edit /
  summary), the `documents_document` migration, and RBAC via the core
  `UserContext`.

## Data model

`documents_document` — `customer_id` (the JWT's active company/tenant id, **no FK**,
nullable), `project_id` (nullable, loose ref), `author_type` (`customer`/`owner`),
`body`, `created_at`, `read_at`, `edited_at`.

## Install

```bash
npm install        # pulls tds-frontend-contract from GitHub Packages (needs NPM_TOKEN)
composer install   # resolves tds-frontend-contract from its public VCS repo
```

## Test / build

```bash
composer test          # phpunit — RBAC + validation route coverage
npm run type-check     # tsc --noEmit
npm run build          # tsup → dist/
```

Wire it into a product by adding `documents` to that product's `astro.config.mjs`
`extensions` array and to `tds-core-frontend-api`'s `Modules::enabled()`.
