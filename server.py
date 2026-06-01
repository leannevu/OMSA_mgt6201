import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse


ROOT = Path(__file__).resolve().parent
PUBLIC_ROOT = ROOT / "public"
ACCOUNTING_QUIZ_CSV = ROOT / "data" / "accounting_quiz.csv"
ACCOUNTING_MAP_CSV = ROOT / "data" / "accounting_map.csv"
PRACTICE_DATA_ROOT = ROOT / "data" / "practice"
PRACTICE_MANIFEST = PRACTICE_DATA_ROOT / "practice_manifest.json"
PRACTICE_WEEK01 = PRACTICE_DATA_ROOT / "week01_foundations"
PRACTICE_WEEK02 = PRACTICE_DATA_ROOT / "week02_operating_assets_debt"
PRACTICE_WEEK03 = PRACTICE_DATA_ROOT / "week03_statement_analysis"
PRACTICE_CSVS = {
    "/api/practice/account-classification": PRACTICE_WEEK01 / "account_classification.csv",
    "/api/practice/balance-sheet": PRACTICE_WEEK01 / "balance_sheet_builder.csv",
    "/api/practice/statements": PRACTICE_WEEK01 / "statement_completion.csv",
    "/api/practice/retained-earnings": PRACTICE_WEEK01 / "retained_earnings.csv",
    "/api/practice/week2/ar-bad-debt": PRACTICE_WEEK02 / "ar_bad_debt.csv",
    "/api/practice/week2/bond-amortization": PRACTICE_WEEK02 / "bond_amortization.csv",
    "/api/practice/week2/cash-classification": PRACTICE_WEEK02 / "cash_classification.csv",
    "/api/practice/week2/depreciation": PRACTICE_WEEK02 / "depreciation_calculations.csv",
    "/api/practice/week2/inventory-answers": PRACTICE_WEEK02 / "inventory_answers.csv",
    "/api/practice/week2/inventory-layers": PRACTICE_WEEK02 / "inventory_layers.csv",
    "/api/practice/week2/ppe-capitalization": PRACTICE_WEEK02 / "ppe_capitalization.csv",
    "/api/practice/week2/revenue-calculations": PRACTICE_WEEK02 / "revenue_recognition_calculations.csv",
    "/api/practice/week2/revenue-steps": PRACTICE_WEEK02 / "revenue_recognition_steps.csv",
    "/api/practice/week1/fs-reader-balance-sheet": PRACTICE_WEEK01 / "fs_reader_balance_sheet.csv",
    "/api/practice/week1/fs-reader-income-statement": PRACTICE_WEEK01 / "fs_reader_income_statement.csv",
    "/api/practice/week1/fs-reader-questions": PRACTICE_WEEK01 / "fs_reader_questions.csv",
    "/api/practice/week1/matching-scenarios": PRACTICE_WEEK01 / "matching_principle_scenarios.csv",
    "/api/practice/week1/ratio-calculations": PRACTICE_WEEK01 / "ratio_calculations.csv",
    "/api/practice/week1/revenue-scenarios": PRACTICE_WEEK01 / "revenue_recognition_scenarios.csv",
    "/api/practice/week1/warranty-classifier": PRACTICE_WEEK01 / "warranty_classifier.csv",
    "/api/practice/week3/common-size": PRACTICE_WEEK03 / "common_size_statement.csv",
    "/api/practice/week3/costco-key-figures": PRACTICE_WEEK03 / "costco_key_figures.csv",
    "/api/practice/week3/dupont": PRACTICE_WEEK03 / "dupont_exercises.csv",
    "/api/practice/week3/ratio-interpretation": PRACTICE_WEEK03 / "ratio_interpretation.csv",
    "/api/practice/week3/ratio-table": PRACTICE_WEEK03 / "ratio_table.csv",
    "/api/practice/week3/trend": PRACTICE_WEEK03 / "trend_statement.csv",
    "/api/practice/week3/walmart-key-figures": PRACTICE_WEEK03 / "walmart_key_figures.csv",
}
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8001"))


class KnowledgeTreeHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PUBLIC_ROOT), **kwargs)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path in ("/api/accounting-quiz-csv", "/api/accounting-csv", "/api/accounting.csv"):
            self.serve_csv(ACCOUNTING_QUIZ_CSV, "Accounting quiz CSV not found")
            return

        if parsed.path == "/api/accounting-map-csv":
            self.serve_csv(ACCOUNTING_MAP_CSV, "Accounting map CSV not found")
            return

        if parsed.path in PRACTICE_CSVS:
            self.serve_csv(PRACTICE_CSVS[parsed.path], "Practice CSV not found")
            return

        if parsed.path == "/api/practice-manifest":
            self.serve_file(PRACTICE_MANIFEST, "application/json; charset=utf-8", "Practice manifest not found")
            return

        if parsed.path.startswith("/api/practice-data/"):
            relative_path = unquote(parsed.path.removeprefix("/api/practice-data/"))
            csv_path = (PRACTICE_DATA_ROOT / relative_path).resolve()
            practice_root = PRACTICE_DATA_ROOT.resolve()
            if practice_root not in csv_path.parents:
                self.send_error(403, "Practice data path is outside the practice data root")
                return
            self.serve_csv(csv_path, "Practice data CSV not found")
            return

        super().do_GET()

    def serve_csv(self, csv_path, missing_message):
        self.serve_file(csv_path, "text/csv; charset=utf-8", missing_message)

    def serve_file(self, file_path, content_type, missing_message):
        if not file_path.exists():
            self.send_error(404, missing_message)
            return

        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(file_path.read_bytes())


if __name__ == "__main__":
    print(f"Knowledge Tree server running on {HOST}:{PORT}")
    if HOST == "0.0.0.0":
        print(f"Local URL: http://127.0.0.1:{PORT}")
    ThreadingHTTPServer((HOST, PORT), KnowledgeTreeHandler).serve_forever()
