/// <reference types="vite/client" />

interface ImportMetaEnv {
  /// Deployed Google Apps Script `/exec` endpoint the user export posts to.
  /// See `.env.example`. Unset means the Sync button reports itself as
  /// unconfigured rather than failing with an opaque network error.
  readonly VITE_SHEETS_SCRIPT_URL?: string;

  /// Override for the API origin. Unset means the deployed API
  /// (`https://api.aarambh.app`); set it to e.g. `http://localhost:8080` to run
  /// the panel against a local server.
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
