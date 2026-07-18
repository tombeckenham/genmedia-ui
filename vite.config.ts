import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    devtools(),
    // serverDir opts into nitro's server/ scan: server/routes/api/media.get.ts
    // must register as a specific nitro route so browser image/video requests
    // (Sec-Fetch-Dest) aren't misclassified as static assets in dev.
    nitro({ serverDir: 'server', rollupConfig: { external: [/^@sentry\//] } }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})

export default config
