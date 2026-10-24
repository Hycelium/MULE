/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TURN_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
