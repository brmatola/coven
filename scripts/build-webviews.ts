import { build } from 'vite';
import react from '@vitejs/plugin-react';
import * as path from 'path';
import * as fs from 'fs';

const ROOT_DIR = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT_DIR, 'src');
const DIST_DIR = path.join(ROOT_DIR, 'dist', 'webviews');

// Find all webview entry points by looking for webview/index.tsx in feature folders
function findWebviewEntries(): Array<{ name: string; entry: string }> {
  const entries: Array<{ name: string; entry: string }> = [];

  const features = fs.readdirSync(SRC_DIR, { withFileTypes: true });
  for (const feature of features) {
    if (feature.isDirectory()) {
      const webviewIndex = path.join(SRC_DIR, feature.name, 'webview', 'index.tsx');
      if (fs.existsSync(webviewIndex)) {
        entries.push({
          name: feature.name,
          entry: webviewIndex,
        });
      }
    }
  }

  return entries;
}

async function buildWebviews(): Promise<void> {
  const entries = findWebviewEntries();

  if (entries.length === 0) {
    console.log('No webview entries found');
    return;
  }

  console.log(`Building ${entries.length} webview(s): ${entries.map((e) => e.name).join(', ')}`);

  for (const { name, entry } of entries) {
    console.log(`Building webview: ${name}`);

    await build({
      root: path.dirname(entry),
      plugins: [react()],
      build: {
        outDir: path.join(DIST_DIR, name),
        emptyOutDir: true,
        sourcemap: true,
        rollupOptions: {
          input: entry,
          output: {
            entryFileNames: 'index.js',
            assetFileNames: 'index.[ext]',
          },
        },
      },
      define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
      },
    });
  }

  console.log('Webview build complete');
}

buildWebviews().catch((err) => {
  console.error('Failed to build webviews:', err);
  process.exit(1);
});
