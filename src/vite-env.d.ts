/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare const __BUILD_ID__: string

declare module '*.yaml?raw' {
  const content: string
  export default content
}
