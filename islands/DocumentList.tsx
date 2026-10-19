import { useEffect, useState } from "react";
import { Alert, Spinner, toast } from "@tracht-digital-solutions/tds-shared/components";
import { apiFetch, apiUrl, sendJson } from "@tracht-digital-solutions/tds-shared/api";
import { copyText } from "@tracht-digital-solutions/tds-shared/clipboard";
import { FileDropZone } from "@tracht-digital-solutions/tds-shared/dropzone";
import { formatBytes, formatDate } from "@tracht-digital-solutions/tds-shared/format";

interface Document {
  id: number;
  project_id: number | null;
  filename: string;
  mime_type: string;
  size_bytes: number;
  uploaded_at: string;
}


/**
 * Portal document store (ported from tds-customer-legacy-frontend's Documents).
 * List + upload (multipart under "file") + JWT-gated download + inline rename +
 * a "Link teilen" action that mints a short-lived signed URL (copied to the
 * clipboard). Read-only when the user lacks documents:write.
 */
export default function DocumentList() {
  const [docs, setDocs] = useState<Document[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const load = () =>
    apiFetch("/documents")
      .then((r) => {
        if (r.status === 403) {
          setForbidden(true);
          return { documents: [] };
        }
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((d) => setDocs(d.documents ?? []))
      .catch(() => setError("Dokumente konnten nicht geladen werden."));

  useEffect(() => {
    void load();
  }, []);

  async function upload(files: File[]) {
    const file = files[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await apiFetch("/documents", { method: "POST", body: fd });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error ?? String(r.status));
      }
      await load();
    } catch (err) {
      toast.danger(err instanceof Error ? err.message : "Upload fehlgeschlagen.");
    } finally {
      setUploading(false);
    }
  }

  async function saveRename(id: number) {
    const name = renameDraft.trim();
    if (!name) return;
    try {
      const r = await sendJson(`/documents/${id}`, "PATCH", { filename: name });
      if (!r.ok) throw new Error(String(r.status));
      setRenamingId(null);
      await load();
    } catch {
      toast.danger("Umbenennen fehlgeschlagen.");
    }
  }

  async function share(id: number) {
    try {
      const r = await sendJson(`/documents/${id}/sign`, "POST", {});
      if (r.status === 503) {
        setNotice("Signierte Links sind nicht konfiguriert.");
        return;
      }
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json();
      const until = new Date(d.expiresAt).toLocaleTimeString("de-DE");
      if (await copyText(d.url)) {
        toast.success(`Link in die Zwischenablage kopiert (gültig bis ${until}).`);
      } else {
        // Something to copy stays in the flow: the clipboard refused (insecure
        // origin, denied permission), so the link has to be readable here.
        setNotice(`Link (gültig bis ${until}): ${d.url}`);
      }
    } catch {
      toast.danger("Link konnte nicht erstellt werden.");
    }
  }

  if (forbidden) return <p className="tds-empty">Kein Zugriff auf Dokumente.</p>;
  if (error && docs === null) return <Alert>{error}</Alert>;
  if (docs === null) return <p><Spinner /></p>;

  return (
    <div className="tds-stack">
      <FileDropZone
        label={uploading ? "Wird hochgeladen …" : "Datei hochladen"}
        hint="oder hierher ziehen"
        activeLabel="Loslassen zum Hochladen"
        disabled={uploading}
        onFiles={(files) => void upload(files)}
      />
      <Alert>{error}</Alert>
      {/* An operator hint ("signed links are not configured") or a link the
          clipboard refused — something to read, not an outcome. */}
      <Alert tone="info">{notice}</Alert>
      {docs.length === 0 ? (
        <p className="tds-empty">Noch keine Dokumente.</p>
      ) : (
        <table className="tds-table">
          <thead>
            <tr><th>Name</th><th>Größe</th><th>Hochgeladen</th><th></th></tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id}>
                {/* A filename is one unbroken token as often as not, and a
                    table cell sizes to its content — so a long one set the
                    whole table's min width and pushed the action column off
                    a phone screen. */}
                <td className="break-words">
                  {renamingId === d.id ? (
                    <span className="tds-row">
                      <input
                        className="field-boxed"
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        maxLength={255}
                        aria-label="Neuer Dateiname"
                      />
                      <button type="button" className="btn btn-primary" onClick={() => saveRename(d.id)}>
                        OK
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => setRenamingId(null)}
                        aria-label="Umbenennen abbrechen"
                      >
                        ×
                      </button>
                    </span>
                  ) : (
                    d.filename
                  )}
                </td>
                <td>{formatBytes(d.size_bytes)}</td>
                <td>{formatDate(d.uploaded_at)}</td>
                <td>
                  <span className="tds-toolbar">
                    {/* Absolute: the route lives on the API, and a relative
                        href resolved against the portal host, which has none. */}
                    <a href={apiUrl(`/documents/${d.id}/download`)}>Download</a>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => { setRenamingId(d.id); setRenameDraft(d.filename); }}
                    >
                      Umbenennen
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => share(d.id)}>
                      Link teilen
                    </button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
