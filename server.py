import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parent
PUBLIC_ROOT = ROOT / "public"
ACCOUNTING_CSV = ROOT / "data" / "accounting.csv"
HOST = "0.0.0.0"
PORT = int(os.environ.get("PORT", "8001"))


class KnowledgeTreeHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PUBLIC_ROOT), **kwargs)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/accounting-csv":
            self.serve_accounting_csv()
            return

        super().do_GET()

    def serve_accounting_csv(self):
        if not ACCOUNTING_CSV.exists():
            self.send_error(404, "Accounting CSV not found")
            return

        self.send_response(200)
        self.send_header("Content-Type", "text/csv; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(ACCOUNTING_CSV.read_bytes())


if __name__ == "__main__":
    print(f"Knowledge Tree server running on {HOST}:{PORT}")
    ThreadingHTTPServer((HOST, PORT), KnowledgeTreeHandler).serve_forever()
