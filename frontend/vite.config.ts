import path from "node:path"
import { createRequire } from "node:module"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

// Single source of truth for the app version is package.json; expose it (plus a
// build date) to the client so learners can see which build they're reading.
const { version } = createRequire(import.meta.url)("./package.json") as {
  version: string
}
const buildDate = new Date().toISOString().slice(0, 10)

// The kata markdown lives one level up in `../modules`, so allow the dev server
// to read outside the frontend root and resolve `@` to `src`.
export default defineConfig({
  // For GitHub Pages project sites the app is served from /<repo>/.
  // The publish script sets VITE_BASE=/netsec-katas/; dev/local default is "/".
  base: process.env.VITE_BASE ?? "/",
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __BUILD_DATE__: JSON.stringify(buildDate),
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    fs: {
      allow: [".."],
    },
  },
})
