"""Serve only allowlisted synthetic HTML on loopback; never feedback/backups."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent / 'public'
ALLOWED = {'/demo.html', '/report.html'} | {'/cases/' + path.name for path in (ROOT / 'cases').glob('*.html')}

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        route = self.path.split('?', 1)[0]
        if route not in ALLOWED:
            self.send_error(404)
            return
        data = (ROOT / route.removeprefix('/')).read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.end_headers()
        self.wfile.write(data)

print('Synthetic demo: http://127.0.0.1:3098/demo.html', flush=True)
ThreadingHTTPServer(('127.0.0.1', 3098), Handler).serve_forever()
