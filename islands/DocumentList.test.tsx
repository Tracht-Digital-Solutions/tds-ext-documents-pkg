// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DocumentList from "./DocumentList";

/**
 * The portal document store: list, upload, rename, download and "Link teilen".
 *
 * Two things here leave the browser and matter more than the rest:
 *
 *  - **the upload goes out as multipart `FormData` under the field name
 *    `file`**, with no hand-set `Content-Type` (setting one drops the multipart
 *    boundary and the backend receives nothing);
 *  - **"Link teilen" mints a SIGNED, short-lived URL** to a customer document.
 *    A 503 (signing not configured) must say so rather than look like a
 *    transient failure — otherwise an admin retries forever against a feature
 *    the host has not enabled.
 *
 * A 403 is its own state, not an error: the user simply has no document access.
 */

interface Reply {
  status: number;
  body: unknown;
}
type Handler = (url: string, init?: RequestInit) => Reply | undefined;

let calls: Array<{ url: string; method: string; body: unknown; raw: BodyInit | null | undefined; headers: unknown }> = [];
let handlers: Handler[] = [];
let clipboardWrites: string[] = [];

function respond(match: RegExp, body: unknown, status = 200, method?: string) {
  handlers.unshift((url, init) => {
    if (!match.test(url)) return undefined;
    if (method && (init?.method ?? "GET") !== method) return undefined;
    return { status, body };
  });
}

/**
 * jsdom exposes no clipboard, and `navigator` is a read-only accessor, so the
 * property has to be defined on the real object. It must also be installed
 * AFTER `userEvent.setup()`, which quietly installs a clipboard stub of its own.
 */
const setClipboard = (value: unknown) =>
  Object.defineProperty(window.navigator, "clipboard", { value, configurable: true, writable: true });

const DOC = {
  id: 4,
  project_id: null,
  filename: "Angebot.pdf",
  mime_type: "application/pdf",
  size_bytes: 2048,
  uploaded_at: "2026-07-20 09:00:00",
};

beforeEach(() => {
  calls = [];
  clipboardWrites = [];
  handlers = [() => ({ status: 200, body: {} })];
  respond(/^\/documents$/, { documents: [] });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({
        url,
        method,
        body: typeof init?.body === "string" && init.body !== "{}" ? JSON.parse(init.body) : undefined,
        raw: init?.body,
        headers: init?.headers,
      });
      const reply = handlers.map((h) => h(url, init)).find((r) => r !== undefined)!;
      return { ok: reply.status < 300, status: reply.status, json: async () => reply.body } as Response;
    }),
  );
});

afterEach(() => cleanup());

const user = () => userEvent.setup({ delay: null });
const sent = (method: string, match: RegExp) => calls.filter((c) => c.method === method && match.test(c.url));

async function open(documents: unknown[] = []) {
  respond(/^\/documents$/, { documents }, 200, "GET");
  render(<DocumentList />);
  const u = user();
  setClipboard({ writeText: async (t: string) => void clipboardWrites.push(t) });
  await waitFor(() => expect(calls.length).toBeGreaterThan(0));
  return u;
}

const row = (name: string) => screen.getAllByRole("row").find((r) => r.textContent!.includes(name))!;
const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement;
const pdf = (name = "Neu.pdf") => new File(["x"], name, { type: "application/pdf" });

describe("loading", () => {
  it("reads the document list with credentials", async () => {
    await open();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock.mock.calls[0]![0]).toBe("/documents");
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ credentials: "include" });
  });

  it("shows a loading line until the list arrives", () => {
    render(<DocumentList />);
    expect(screen.getByLabelText("Wird geladen")).toBeTruthy();
  });

  it("says so when there are no documents", async () => {
    await open();
    expect(await screen.findByText("Noch keine Dokumente.")).toBeTruthy();
  });

  it("lists a document with its size and upload date", async () => {
    await open([DOC]);
    await screen.findByText("Angebot.pdf");
    const cells = within(row("Angebot.pdf")).getAllByRole("cell");
    expect(cells[1]!.textContent).toBe("2 KB");
    expect(cells[2]!.textContent).toBe("20.07.2026");
  });

  it("treats a 403 as NO ACCESS, not as a failure", async () => {
    // "Kein Zugriff" is actionable (ask for the permission); a generic error
    // reads as something that might fix itself.
    respond(/^\/documents$/, {}, 403, "GET");
    render(<DocumentList />);
    expect(await screen.findByText("Kein Zugriff auf Dokumente.")).toBeTruthy();
    expect(screen.queryByText(/konnten nicht geladen werden/)).toBeNull();
  });

  it("offers no upload control without access", async () => {
    respond(/^\/documents$/, {}, 403, "GET");
    render(<DocumentList />);
    await screen.findByText("Kein Zugriff auf Dokumente.");
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it("reports any other failure as an error", async () => {
    respond(/^\/documents$/, {}, 500, "GET");
    render(<DocumentList />);
    expect(await screen.findByText("Dokumente konnten nicht geladen werden.")).toBeTruthy();
  });

  it("does NOT list documents carried by a non-OK response", async () => {
    respond(/^\/documents$/, { documents: [DOC] }, 500, "GET");
    render(<DocumentList />);
    await screen.findByText("Dokumente konnten nicht geladen werden.");
    expect(screen.queryByText("Angebot.pdf")).toBeNull();
  });

  it("reports a rejected request rather than hanging on the loading line", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    render(<DocumentList />);
    expect(await screen.findByText("Dokumente konnten nicht geladen werden.")).toBeTruthy();
  });

  it("tolerates a response with no documents field", async () => {
    respond(/^\/documents$/, {}, 200, "GET");
    render(<DocumentList />);
    expect(await screen.findByText("Noch keine Dokumente.")).toBeTruthy();
  });
});

describe("the size format", () => {
  const sizeOf = async (bytes: number) => {
    cleanup();
    await open([{ ...DOC, size_bytes: bytes }]);
    await screen.findByText("Angebot.pdf");
    return within(row("Angebot.pdf")).getAllByRole("cell")[1]!.textContent;
  };

  it("shows bytes below a kilobyte", async () => {
    expect(await sizeOf(512)).toBe("512 B");
  });

  it("switches to KB exactly at 1024", async () => {
    expect(await sizeOf(1023)).toBe("1023 B");
    expect(await sizeOf(1024)).toBe("1 KB");
  });

  it("switches to MB exactly at a megabyte", async () => {
    expect(await sizeOf(1048575)).toBe("1024 KB");
    expect(await sizeOf(1048576)).toBe("1.0 MB");
  });

  it("keeps one decimal for megabytes and none for kilobytes", async () => {
    expect(await sizeOf(5 * 1048576 + 524288)).toBe("5.5 MB");
    expect(await sizeOf(1536)).toBe("2 KB");
  });

  it("renders a zero-byte file as 0 B, not as an empty cell", async () => {
    expect(await sizeOf(0)).toBe("0 B");
  });
});

describe("the upload", () => {
  it("sends the file as MULTIPART FormData under the field name file", async () => {
    // JSON here, or a hand-set Content-Type (which drops the multipart
    // boundary), means the backend receives nothing at all.
    const u = await open();
    await u.upload(fileInput(), pdf());
    await waitFor(() => expect(sent("POST", /^\/documents$/)).toHaveLength(1));
    const call = sent("POST", /^\/documents$/)[0]!;
    expect(call.raw).toBeInstanceOf(FormData);
    expect((call.raw as FormData).get("file")).toBeInstanceOf(File);
    expect(((call.raw as FormData).get("file") as File).name).toBe("Neu.pdf");
    expect(call.headers).toBeUndefined();
  });

  it("reloads the list after a successful upload", async () => {
    const u = await open();
    await u.upload(fileInput(), pdf());
    await waitFor(() => expect(sent("GET", /^\/documents$/)).toHaveLength(2));
  });

  it("surfaces the API's own error message", async () => {
    respond(/^\/documents$/, { error: "Datei zu groß (max. 25 MB)." }, 413, "POST");
    const u = await open();
    await u.upload(fileInput(), pdf());
    expect(await screen.findByText("Datei zu groß (max. 25 MB).")).toBeTruthy();
  });

  it("falls back to the status code when there is no message", async () => {
    respond(/^\/documents$/, {}, 500, "POST");
    const u = await open();
    await u.upload(fileInput(), pdf());
    expect(await screen.findByText("500")).toBeTruthy();
  });

  it("does not reload the list after a failed upload", async () => {
    respond(/^\/documents$/, { error: "nope" }, 500, "POST");
    const u = await open();
    await u.upload(fileInput(), pdf());
    await screen.findByText("nope");
    expect(sent("GET", /^\/documents$/)).toHaveLength(1);
  });

  it("CLEARS the file input afterwards so the same file can be re-picked", async () => {
    // A browser fires no change event for an identical value, so a failed
    // upload could not be retried with the same file.
    respond(/^\/documents$/, { error: "nope" }, 500, "POST");
    const u = await open();
    await u.upload(fileInput(), pdf());
    await screen.findByText("nope");
    expect(fileInput().value).toBe("");
  });

  it("re-enables the control after the upload settles", async () => {
    const u = await open();
    await u.upload(fileInput(), pdf());
    await waitFor(() => expect(sent("POST", /^\/documents$/)).toHaveLength(1));
    await waitFor(() => expect(fileInput().disabled).toBe(false));
    expect(screen.getByText("Datei hochladen")).toBeTruthy();
  });
});

describe("renaming", () => {
  async function startRename(u: ReturnType<typeof user>) {
    await screen.findByText("Angebot.pdf");
    await u.click(within(row("Angebot.pdf")).getByRole("button", { name: "Umbenennen" }));
    return screen.getByDisplayValue("Angebot.pdf");
  }

  it("prefills the current filename", async () => {
    const u = await open([DOC]);
    expect(await startRename(u)).toBeTruthy();
  });

  it("PATCHes the document it opened", async () => {
    // Renames the SECOND row on purpose: with the first row, "the document it
    // opened" and "the first document in the list" are the same id, and a
    // wrong-row bug would be invisible.
    const u = await open([DOC, { ...DOC, id: 9, filename: "Vertrag.pdf" }]);
    await screen.findByText("Vertrag.pdf");
    await u.click(within(row("Vertrag.pdf")).getByRole("button", { name: "Umbenennen" }));
    const input = screen.getByDisplayValue("Vertrag.pdf");
    await u.clear(input);
    await u.type(input, "Vertrag-final.pdf");
    await u.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(sent("PATCH", /^\/documents\/9$/)).toHaveLength(1));
    expect(sent("PATCH", /^\/documents\/9$/)[0]!.body).toEqual({ filename: "Vertrag-final.pdf" });
    expect(sent("PATCH", /^\/documents\/4$/)).toHaveLength(0);
  });

  it("trims the new name", async () => {
    const u = await open([DOC]);
    const input = await startRename(u);
    await u.clear(input);
    await u.type(input, "  Angebot-final.pdf  ");
    await u.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(sent("PATCH", /^\/documents\/4$/)).toHaveLength(1));
    expect(sent("PATCH", /^\/documents\/4$/)[0]!.body).toEqual({ filename: "Angebot-final.pdf" });
  });

  it("REFUSES to rename a document to nothing", async () => {
    const u = await open([DOC]);
    const input = await startRename(u);
    await u.clear(input);
    await u.click(screen.getByRole("button", { name: "OK" }));
    expect(sent("PATCH", /documents/)).toHaveLength(0);
  });

  it("refuses a whitespace-only name", async () => {
    const u = await open([DOC]);
    const input = await startRename(u);
    await u.clear(input);
    await u.type(input, "   ");
    await u.click(screen.getByRole("button", { name: "OK" }));
    expect(sent("PATCH", /documents/)).toHaveLength(0);
  });

  it("closes the editor and reloads on success", async () => {
    const u = await open([DOC]);
    await startRename(u);
    await u.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(sent("GET", /^\/documents$/)).toHaveLength(2));
    expect(screen.queryByRole("button", { name: "OK" })).toBeNull();
  });

  it("KEEPS the editor open and reports a failed rename", async () => {
    respond(/^\/documents\/4$/, { error: "nope" }, 500, "PATCH");
    const u = await open([DOC]);
    await startRename(u);
    await u.click(screen.getByRole("button", { name: "OK" }));
    expect(await screen.findByText("Umbenennen fehlgeschlagen.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "OK" })).toBeTruthy();
    expect(sent("GET", /^\/documents$/)).toHaveLength(1);
  });

  it("abandons the rename without sending anything", async () => {
    const u = await open([DOC]);
    await startRename(u);
    await u.click(screen.getByRole("button", { name: "×" }));
    expect(screen.queryByRole("button", { name: "OK" })).toBeNull();
    expect(sent("PATCH", /documents/)).toHaveLength(0);
  });

  it("edits one row at a time", async () => {
    const u = await open([DOC, { ...DOC, id: 9, filename: "Vertrag.pdf" }]);
    await startRename(u);
    expect(screen.getAllByRole("button", { name: "OK" })).toHaveLength(1);
    expect(screen.getByText("Vertrag.pdf")).toBeTruthy();
  });
});

describe("downloading", () => {
  it("links to the document's own download route", async () => {
    await open([DOC]);
    await screen.findByText("Angebot.pdf");
    const link = within(row("Angebot.pdf")).getByRole("link", { name: "Download" }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/documents/4/download");
  });

  it("gives each row its own download link", async () => {
    await open([DOC, { ...DOC, id: 9, filename: "Vertrag.pdf" }]);
    await screen.findByText("Vertrag.pdf");
    expect(within(row("Vertrag.pdf")).getByRole("link").getAttribute("href")).toBe("/documents/9/download");
  });
});

describe("sharing a signed link", () => {
  const SIGNED = { url: "https://app.example.de/d/abc?sig=1", expiresAt: "2026-07-20T11:00:00Z" };

  async function share(u: ReturnType<typeof user>) {
    await screen.findByText("Angebot.pdf");
    await u.click(within(row("Angebot.pdf")).getByRole("button", { name: "Link teilen" }));
  }

  it("asks the document's own sign endpoint", async () => {
    respond(/sign$/, SIGNED, 200, "POST");
    const u = await open([DOC]);
    await share(u);
    await waitFor(() => expect(sent("POST", /^\/documents\/4\/sign$/)).toHaveLength(1));
  });

  it("copies the minted URL to the clipboard", async () => {
    respond(/sign$/, SIGNED, 200, "POST");
    const u = await open([DOC]);
    await share(u);
    await waitFor(() => expect(clipboardWrites).toEqual([SIGNED.url]));
  });

  it("tells the user when the link expires", async () => {
    respond(/sign$/, SIGNED, 200, "POST");
    const u = await open([DOC]);
    await share(u);
    expect(await screen.findByText(/Link in die Zwischenablage kopiert \(gültig bis /)).toBeTruthy();
  });

  it("NAMES an unconfigured signer instead of a generic failure", async () => {
    // A 503 means the host has not enabled signed links at all; retrying is
    // pointless, and "Link konnte nicht erstellt werden" invites exactly that.
    respond(/sign$/, { error: "not configured" }, 503, "POST");
    const u = await open([DOC]);
    await share(u);
    expect(await screen.findByText("Signierte Links sind nicht konfiguriert.")).toBeTruthy();
    expect(screen.queryByText("Link konnte nicht erstellt werden.")).toBeNull();
  });

  it("copies nothing when signing is unconfigured", async () => {
    respond(/sign$/, { error: "not configured" }, 503, "POST");
    const u = await open([DOC]);
    await share(u);
    await screen.findByText("Signierte Links sind nicht konfiguriert.");
    expect(clipboardWrites).toEqual([]);
  });

  it("reports any other failure", async () => {
    respond(/sign$/, { error: "nope" }, 500, "POST");
    const u = await open([DOC]);
    await share(u);
    expect(await screen.findByText("Link konnte nicht erstellt werden.")).toBeTruthy();
  });

  it("signs the document whose button was pressed", async () => {
    respond(/sign$/, SIGNED, 200, "POST");
    const u = await open([DOC, { ...DOC, id: 9, filename: "Vertrag.pdf" }]);
    await screen.findByText("Vertrag.pdf");
    await u.click(within(row("Vertrag.pdf")).getByRole("button", { name: "Link teilen" }));
    await waitFor(() => expect(sent("POST", /^\/documents\/9\/sign$/)).toHaveLength(1));
    expect(sent("POST", /^\/documents\/4\/sign$/)).toHaveLength(0);
  });

  it("does not reload the list just to share a link", async () => {
    respond(/sign$/, SIGNED, 200, "POST");
    const u = await open([DOC]);
    await share(u);
    await waitFor(() => expect(clipboardWrites).toHaveLength(1));
    expect(sent("GET", /^\/documents$/)).toHaveLength(1);
  });

  it("degrades gracefully when the browser exposes no clipboard", async () => {
    // `navigator.clipboard?.writeText(url).catch(…)` short-circuits the WHOLE
    // chain — including the `.catch()` — when clipboard is undefined, so an
    // insecure-context browser gets the confirmation without an exception.
    // (The URL is then only in the notice, not on the clipboard.)
    respond(/sign$/, SIGNED, 200, "POST");
    const u = await open([DOC]);
    setClipboard(undefined);
    await share(u);
    expect(await screen.findByText(/Link in die Zwischenablage kopiert/)).toBeTruthy();
    expect(screen.queryByText("Link konnte nicht erstellt werden.")).toBeNull();
  });

  it("still reports an error when the clipboard write itself rejects", async () => {
    respond(/sign$/, SIGNED, 200, "POST");
    const u = await open([DOC]);
    setClipboard({ writeText: async () => { throw new DOMException("denied"); } });
    await share(u);
    // The `.catch(() => undefined)` swallows it — the notice still appears.
    expect(await screen.findByText(/Link in die Zwischenablage kopiert/)).toBeTruthy();
  });
});
