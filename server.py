import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parent
PUBLIC_ROOT = ROOT / "public"
ACCOUNTING_QUIZ_CSV = ROOT / "data" / "accounting_quiz.csv"
ACCOUNTING_MAP_CSV = ROOT / "data" / "accounting_map.csv"
HOST = "127.0.0.1"
PORT = int(os.environ.get("PORT", "8001"))


class KnowledgeTreeHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PUBLIC_ROOT), **kwargs)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/accounting-quiz-csv":
            self.serve_csv(ACCOUNTING_QUIZ_CSV, "Accounting quiz CSV not found")
            return

        if parsed.path == "/api/accounting-map-csv":
            self.serve_csv(ACCOUNTING_MAP_CSV, "Accounting map CSV not found")
            return

        super().do_GET()

    def serve_csv(self, csv_path, missing_message):
        if not csv_path.exists():
            self.send_error(404, missing_message)
            return

        self.send_response(200)
        self.send_header("Content-Type", "text/csv; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(csv_path.read_bytes())


if __name__ == "__main__":
    print(f"Knowledge Tree server running on {HOST}:{PORT}")
    ThreadingHTTPServer((HOST, PORT), KnowledgeTreeHandler).serve_forever()
