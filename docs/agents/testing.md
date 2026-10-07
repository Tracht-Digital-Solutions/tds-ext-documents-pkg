# Testing

```bash
npm run test:run   # vitest; islands opt into jsdom per file via a @vitest-environment docblock
composer test      # phpunit
```

CI (`_build.yml`) runs both suites, plus type-check, `lint:primitives` and build, on
every run.

## Test environment against the current tds-shared

tds-shared is a **peer** dependency, so a fresh standalone install may resolve an old
version while every product build composes the current one. Keep these in mind:

- `apiFetch` first consults the host runtime config (`/tds-runtime.json`), so
  `fetch.mock.calls[0]` is that probe. Call **`primeRuntimeConfig(null)`** in
  `beforeEach`; panel products never ship that file, so "absent" matches production.
- `apiFetch` is **async**. `await waitFor(() => expect(fetch).toHaveBeenCalled())`
  before reading `mock.calls`.
- A multipart upload carries an **empty** `headers` object. Assert "no content-type
  header", never "headers is undefined".
- Error-path tests answer with a **populated** body and a non-OK status. Against an
  empty error body the ok-check is unobservable.
- At least one assertion per suite pins the **absolute API host** (see
  [frontend-conventions.md](frontend-conventions.md#api-calls-apifetch-never-a-relative-fetch)).

## Suites

### `islands/DocumentList.test.tsx`

List, upload, rename, download, share. Two things leave the browser and get the sharpest
assertions:

- **The upload is multipart `FormData` under field `file`, with no hand-set
  `Content-Type`.** Setting one drops the multipart boundary and the backend receives
  nothing. Both failure modes are separate mutants.
- **"Link teilen" mints a signed, short-lived URL.** A 503 (signing not configured) says
  so explicitly; a generic error would invite endless retries.
- **403 is its own state**, not an error: the user has no document access, and the
  upload control is absent.
- `fmtSize` is pinned at both boundaries (1023/1024 B, 1048575/1048576 B) and on its
  decimal places.

### Other suites

- `islands/WidgetBody.test.tsx` — the count tile.
- `src/index.test.ts` + `tests/packaging.test.ts` — the manifest as a product build sees
  it; every specifier resolves, is exported and ships.
- `php/tests/DocumentsApiDocsTest.php` — API-doc parity.

### Clipboard notes

- **`userEvent.setup()` installs its own `navigator.clipboard` stub.** Define a
  clipboard fake **after** creating the user, or the share tests observe nothing. jsdom
  has no clipboard and `navigator` is read-only, so use `Object.defineProperty`.
- `navigator.clipboard?.writeText(url).catch(…)` is safe without a clipboard: optional
  chaining short-circuits the whole chain. An insecure-context browser still gets the
  confirmation, just not the copy. Asserted as graceful degradation.

### Known blind spot

Mutation check: 44 breakages, 43 caught. Dropping `iso.replace(" ", "T")` in `fmtDate`
is equivalent under V8 (Node parses `"2026-07-20 09:00:00"`), but **not** in
Safari/WebKit, where the space form is an Invalid Date. Keep the normalisation; a jsdom
suite can't catch it.
