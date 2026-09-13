import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * Build configuration for the design system package. The package ships
 * TypeScript source rather than a bundle, so this configuration exists to give
 * the Vitest project the same React transform the web application uses.
 */
export default defineConfig({
  plugins: [react()],
})
