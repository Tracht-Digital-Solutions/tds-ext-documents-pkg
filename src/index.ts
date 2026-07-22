import { defineExtension } from "@tracht-digital-solutions/tds-frontend-contract";

/**
 * Documents extension — the customer document store, ported from tds-customer-api
 * (document table + storage + HMAC-signed URLs) onto the frontend platform.
 * Customers list/upload/download/rename their files and mint short-lived signed
 * links. Bytes live on disk (DOCUMENT_ROOT_DIR); auth comes from the core
 * UserContext.
 *
 * `documents:read` (view/download) / `documents:write` (upload/rename); admins
 * bypass. Signed-URL download verifies an HMAC (DOCUMENT_SIGN_SECRET) not the JWT.
 */
export default defineExtension({
  id: "documents",
  name: "Dokumente",
  version: "0.1.0",
  permissions: [
    { id: "documents:read", label: "Dokumente ansehen", group: "documents" },
    { id: "documents:write", label: "Dokumente hochladen", group: "documents" },
  ],
  nav: [
    {
      id: "documents",
      label: "Dokumente",
      href: "/documents",
      icon: "file-text",
      group: "work",
      order: 20,
      permission: "documents:read",
    },
  ],
  widgets: [
    {
      id: "documents-count",
      title: "Dokumente",
      island: "@tracht-digital-solutions/tds-ext-documents/widgets/Widget.astro",
      size: "sm",
      permission: "documents:read",
      dataEndpoint: "/documents/summary",
      order: 30,
    },
  ],
  routes: [
    {
      pattern: "/documents",
      entrypoint: "@tracht-digital-solutions/tds-ext-documents/pages/Index.astro",
      permission: "documents:read",
    },
  ],
  i18n: {
    de: { "documents.title": "Dokumente", "documents.count": "Dokumente" },
    en: { "documents.title": "Documents", "documents.count": "Documents" },
  },
});
