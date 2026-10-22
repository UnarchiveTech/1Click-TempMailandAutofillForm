/** Local static preview; apply the deployed site's CSP during browser checks. */
import { readFile, realpath } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';

const root = await realpath(resolve('.output/web-demo'));
const headers = await readFile(resolve(root, '_headers'), 'utf8');
const csp = headers.match(/Content-Security-Policy: (.+)/)?.[1];
if (!csp) throw new Error('Missing generated demo CSP');
const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.wasm': 'application/wasm',
};
createServer(async (request, response) => {
  response.setHeader('Content-Security-Policy', csp);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    const file = await realpath(
      resolve(root, `.${pathname}${pathname.endsWith('/') ? 'index.html' : ''}`)
    );
    const delta = relative(root, file);
    if (isAbsolute(delta) || delta === '..' || delta.startsWith(`..${sep}`))
      throw new Error('Outside demo root');
    response.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' });
    response.end(await readFile(file));
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain' });
    response.end('404');
  }
}).listen(Number(process.env.DEMO_PORT ?? 3100), '127.0.0.1');
