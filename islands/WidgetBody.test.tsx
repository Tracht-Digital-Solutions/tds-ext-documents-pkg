
/**
 * Path + query of a request. The island calls an ABSOLUTE URL now (via
 * `apiFetch`); a relative one would hit the product's own static host and come
 * back as SPA-fallback HTML with a 200. Matching on the path keeps the route
 * matchers below anchored.
 */
const pathOf = (url: string) => String(url).replace(/^https?:\/\/[^/]+/i, "");
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import WidgetBody from "./WidgetBody";

/**
 * The document-count widget.
 *
 * NOTE — this one falls back to `0` on a failure, where the lexware, billing
 * and customers widgets render `—`. Pinned as-is; the divergence is recorded in
 * AGENTS.md rather than silently changed in a test-only pass.
 */

let reply: { status: number; body: unknown } | "reject" = { status: 200, body: { count: 0 } };

beforeEach(() => {
  reply = { status: 200, body: { count: 0 } };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      if (reply === "reject") throw new TypeError("offline");
      return {
        ok: reply.status < 300,
        status: reply.status,
        json: async () => (reply === "reject" ? {} : reply.body),
      } as Response;
    }),
  );
});

afterEach(() => cleanup());

describe("the widget", () => {
  it("fetches its summary endpoint with credentials", () => {
    render(<WidgetBody />);
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(pathOf(fetchMock.mock.calls[0]![0] as string)).toBe("/documents/summary");
    // Absolute, on the API host. Every other assertion here matches the PATH,
    // which a relative fetch satisfies too — so this is the one that fails if
    // the call ever goes back to the product's own origin (whose SPA fallback
    // answers 200 + HTML and turns into a silent empty state).
    expect(String(fetchMock.mock.calls[0]![0]).startsWith("https://api.tracht-digital.de/")).toBe(true);
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ credentials: "include" });
  });

  it("shows a placeholder before the request resolves", () => {
    render(<WidgetBody />);
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
  });

  it("renders the document count", async () => {
    reply = { status: 200, body: { count: 12 } };
    render(<WidgetBody />);
    expect(await screen.findByText("12")).toBeTruthy();
  });

  it("renders a real zero for an empty store", async () => {
    render(<WidgetBody />);
    expect(await screen.findByText("0")).toBeTruthy();
  });

  it("coerces a string count from the API to a number", async () => {
    // PDO hands back strings for integer columns. `"5"` renders identically
    // either way, so this uses a zero-padded value where the coercion shows.
    reply = { status: 200, body: { count: "05" } };
    render(<WidgetBody />);
    expect(await screen.findByText("5")).toBeTruthy();
    expect(screen.queryByText("05")).toBeNull();
  });

  it("treats a missing count as zero rather than rendering NaN", async () => {
    reply = { status: 200, body: {} };
    render(<WidgetBody />);
    expect(await screen.findByText("0")).toBeTruthy();
    expect(screen.queryByText("NaN")).toBeNull();
  });

  it("does not render a count carried by a NON-OK response", async () => {
    reply = { status: 403, body: { count: 99 } };
    render(<WidgetBody />);
    expect(await screen.findByText("0")).toBeTruthy();
    expect(screen.queryByText("99")).toBeNull();
  });

  it("still resolves to a rendered tile when the request rejects", async () => {
    reply = "reject";
    render(<WidgetBody />);
    expect(await screen.findByText("0")).toBeTruthy();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });
});
