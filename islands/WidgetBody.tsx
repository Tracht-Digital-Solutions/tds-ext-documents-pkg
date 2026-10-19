import { SummaryMetric } from "@tracht-digital-solutions/tds-shared/components";

/** "Dokumente" widget body — the document count from `/documents/summary`. */
export default function DocumentCount() {
  return <SummaryMetric endpoint="/documents/summary" />;
}
