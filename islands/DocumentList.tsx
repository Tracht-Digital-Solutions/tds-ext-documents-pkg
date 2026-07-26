import { useEffect, useRef, useState } from "react";
import { Spinner } from "@tracht-digital-solutions/tds-shared/components";

interface Document {
  id: number;
  project_id: number | null;
  filename: string;
  mime_type: string;
  size_bytes: number;
  uploaded_at: string;
}

const api = (path: string, init?: RequestInit) => fetch(path, { credentials: "include", ...init });
const fmtSize = (b: number) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`);
const fmtDate = (iso: string) => new Date(iso.replace(" ", "T")).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });

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
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = () =>
    api("/documents")
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

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api("/documents", { method: "POST", body: fd });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error ?? String(r.status));
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload fehlgeschlagen.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function saveRename(id: number) {
    const name = renameDraft.trim();
    if (!name) return;
    try {
      const r = await api(`/documents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: name }),
      });
      if (!r.ok) throw new Error(String(r.status));
      setRenamingId(null);
      await load();
    } catch {
      setError("Umbenennen fehlgeschlagen.");
    }
  }

  async function share(id: number) {
    try {
      const r = await api(`/documents/${id}/sign`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (r.status === 503) {
        setNotice("Signierte Links sind nicht konfiguriert.");
        return;
      }
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json();
      await navigator.clipboard?.writeText(d.url).catch(() => undefined);
      setNotice("Link in die Zwischenablage kopiert (gültig bis " + new Date(d.expiresAt).toLocaleTimeString("de-DE") + ").");
    } catch {
      setError("Link konnte nicht erstellt werden.");
    }
  }

  if (forbidden) return <p className="marginalia">Kein Zugriff auf Dokumente.</p>;
  if (error && docs === null) return <p className="tds-alert tds-alert--danger" role="alert">{error}</p>;
  if (docs === null) return <p role="status"><Spinner /></p>;

  return (
    <div className="document-store">
      <div className="tds-toolbar">
        <label className="button">
          {uploading ? "Wird hochgeladen …" : "Datei hochladen"}
          <input ref={fileRef} type="file" onChange={upload} disabled={uploading} hidden />
        </label>
      </div>
      {error && <p className="tds-alert tds-alert--danger" role="alert">{error}</p>}
      {notice && <p className="notice">{notice}</p>}
      {docs.length === 0 ? (
        <p className="marginalia">Noch keine Dokumente.</p>
      ) : (
        <table className="document-table">
          <thead>
            <tr><th>Name</th><th>Größe</th><th>Hochgeladen</th><th></th></tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id}>
                <td>
                  {renamingId === d.id ? (
                    <span className="document-rename">
                      <input value={renameDraft} onChange={(e) => setRenameDraft(e.target.value)} maxLength={255} />
                      <button type="button" onClick={() => saveRename(d.id)}>OK</button>
                      <button type="button" onClick={() => setRenamingId(null)}>×</button>
                    </span>
                  ) : (
                    d.filename
                  )}
                </td>
                <td>{fmtSize(d.size_bytes)}</td>
                <td>{fmtDate(d.uploaded_at)}</td>
                <td className="document-actions">
                  <a href={`/documents/${d.id}/download`}>Download</a>
                  <button type="button" onClick={() => { setRenamingId(d.id); setRenameDraft(d.filename); }}>Umbenennen</button>
                  <button type="button" onClick={() => share(d.id)}>Link teilen</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
