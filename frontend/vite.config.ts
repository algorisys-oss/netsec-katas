import path from "node:path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

// The kata markdown lives one level up in `../modules`, so allow the dev server
// to read outside the frontend root and resolve `@` to `src`.
export default defineConfig({
  // For GitHub Pages project sites the app is served from /<repo>/.
  // The publish script sets VITE_BASE=/netsec-katas/; dev/local default is "/".
  base: process.env.VITE_BASE ?? "/",
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
