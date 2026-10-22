/**
 * Minimal static file server for local preview testing (serves the project
 * root). Usage: bun scripts/serve-static.ts [port]  (default 8765)
 */
const port = Number(process.argv[2] ?? 8765);

const server = Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    let path = decodeURIComponent(url.pathname);
    if (path === '/') path = '/tests/visual/preview-responsive-button-layout.html';
    const file = Bun.file(`.${path}`);
    if (await file.exists()) return new Response(file);
    return new Response('Not found', { status: 404 });
  },
});

console.log(`Serving project root on http://127.0.0.1:${server.port}`);
