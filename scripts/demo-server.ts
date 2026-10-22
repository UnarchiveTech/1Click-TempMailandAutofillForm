import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, relative, resolve, sep } from 'node:path';

const PORT = Number.parseInt(process.env.DEMO_PORT || '5173', 10);
const DEMO_DIR = realpathSync(resolve(process.cwd(), 'demo'));

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

const server = createServer((req, res) => {
  // CORS headers for extension testing
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  let requestPath: string;
  try {
    // Decode before resolving so encoded traversal and separators are subject
    // to the same containment check as literal path segments.
    requestPath = decodeURIComponent((req.url?.split('?')[0] || '/').split('#')[0]);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('400 Bad Request');
    return;
  }

  let relativePath = requestPath.replace(/^\/demo\//, '/').replace(/^\//, '');

  if (!relativePath || relativePath === 'index.html') {
    relativePath = 'signup-social.html';
  }

  const filePath = resolve(DEMO_DIR, relativePath);
  const pathFromDemoRoot = relative(DEMO_DIR, filePath);
  if (isOutsideDemoDirectory(pathFromDemoRoot)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
    return;
  }

  if (existsSync(filePath)) {
    try {
      const resolvedFilePath = realpathSync(filePath);
      if (isOutsideDemoDirectory(relative(DEMO_DIR, resolvedFilePath))) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
        return;
      }
      const content = readFileSync(resolvedFilePath);
      const ext = extname(resolvedFilePath);
      const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mimeType });
      res.end(content);
      return;
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`Internal Server Error: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('404 Not Found');
});

function isOutsideDemoDirectory(pathFromDemoRoot: string): boolean {
  return (
    pathFromDemoRoot === '' || pathFromDemoRoot === '..' || pathFromDemoRoot.startsWith(`..${sep}`)
  );
}

server.listen(PORT, () => {
  console.log(`[DemoServer] Serving demo showcase pages on http://localhost:${PORT}/demo/`);
});
