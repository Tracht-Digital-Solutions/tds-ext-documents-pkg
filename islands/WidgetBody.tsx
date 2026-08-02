import { useEffect, useState } from "react";
import { Skeleton } from "@tracht-digital-solutions/tds-shared/components";

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
  return <p className="tds-widget__metric" aria-busy={count === null}>
      {count === null ? <Skeleton width="3ch" height="1.75rem" /> : count}
    </p>;
}
