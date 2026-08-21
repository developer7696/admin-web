/// <reference types="vite/client" />

interface ImportMetaEnv {
  /// Deployed Google Apps Script `/exec` endpoint the user export posts to.
  /// See `.env.example`. Unset means the Sync button reports itself as
  /// unconfigured rather than failing with an opaque network error.
  readonly VITE_SHEETS_SCRIPT_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
