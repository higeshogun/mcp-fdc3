import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Serve the sibling demo app HTML files under /demos/<app-name>/
    {
      name: 'serve-demo-apps',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = req.url ?? '';
          // Match /demos/<app-name>/index.html (or bare /demos/<app-name>/)
          const match = url.match(/^\/demos\/(frontend-app-[^/?#]+)(\/index\.html)?(\?.*)?$/);
          if (match) {
            const appName = match[1];
            const filePath = path.resolve(
              __dirname,
              '..',
              appName,
              'index.html',
            );
            if (fs.existsSync(filePath)) {
              res.setHeader('Content-Type', 'text/html; charset=utf-8');
              res.end(fs.readFileSync(filePath));
              return;
            }
          }
          next();
        });
      },
    },
  ],
  server: {
    port: 8080,
    strictPort: true,
  },
});
