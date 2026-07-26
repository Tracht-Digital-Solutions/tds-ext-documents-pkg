import { useEffect, useState } from "react";

/**
 * "Dokumente" widget body. Fetches the document count from the manifest's
 * dataEndpoint (`/documents/summary`). Relative fetch with credentials.
 */
export default function DocumentCount() {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/documents/summary", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { count: 0 }))
      .then((d) => alive && setCount(Number(d.count ?? 0)))
      .catch(() => alive && setCount(0));
    return () => {
      alive = false;
    };
  }, []);
  return <p className="tds-widget__metric">{count === null ? "…" : count}</p>;
}
