import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Manifest-First IWSDK Vite Integration.
 * Resolves iwsdk.config.json into the virtual:iwsdk-project module for runtime bootstrap.
 */
function iwsdkManifestPlugin() {
  const virtualModuleId = 'virtual:iwsdk-project';
  const resolvedVirtualModuleId = '\0' + virtualModuleId;

  return {
    name: 'iwsdk-manifest-plugin',
    resolveId(id: string) {
      if (id === virtualModuleId) {
        return resolvedVirtualModuleId;
      }
      return null;
    },
    load(id: string) {
      if (id === resolvedVirtualModuleId) {
        const configPath = path.resolve(process.cwd(), 'iwsdk.config.json');
        if (fs.existsSync(configPath)) {
          const content = fs.readFileSync(configPath, 'utf-8');
          return `export default ${content};`;
        }
        return 'export default {};';
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [iwsdkManifestPlugin()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: false,
  },
});
