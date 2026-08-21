/**
 * Dependency-free static server for the demo page.
 *
 * Run with `yarn demo-page` (from example/) and pick the "Demo page" preset
 * in the app:
 *   - iOS simulator reaches it at   http://localhost:8087
 *   - Android emulator reaches it at http://10.0.2.2:8087
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const port = 8087;

createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const file = path === '/' ? 'index.html' : normalize(path).slice(1);
  try {
    const body = await readFile(join(root, file));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}).listen(port, () => {
  console.log(`Demo page: http://localhost:${port} (Android emulator: http://10.0.2.2:${port})`);
});
