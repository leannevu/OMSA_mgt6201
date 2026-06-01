import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parent
PUBLIC_ROOT = ROOT / "public"
ACCOUNTING_QUIZ_CSV = ROOT / "data" / "accounting_quiz.csv"
ACCOUNTING_MAP_CSV = ROOT / "data" / "accounting_map.csv"
PRACTICE_DATA_ROOT = ROOT / "data" / "practice"
PRACTICE_CSVS = {
    "/api/practice/account-classification": PRACTICE_DATA_ROOT / "account_classification.csv",
    "/api/practice/balance-sheet": PRACTICE_DATA_ROOT / "balance_sheet_builder.csv",
    "/api/practice/statements": PRACTICE_DATA_ROOT / "statement_completion.csv",
    "/api/practice/retained-earnings": PRACTICE_DATA_ROOT / "retained_earnings.csv",
    "/api/practice/week2/ar-bad-debt": PRACTICE_DATA_ROOT / "week2" / "ar_bad_debt.csv",
    "/api/practice/week2/bond-amortization": PRACTICE_DATA_ROOT / "week2" / "bond_amortization.csv",
    "/api/practice/week2/cash-classification": PRACTICE_DATA_ROOT / "week2" / "cash_classification.csv",
    "/api/practice/week2/depreciation": PRACTICE_DATA_ROOT / "week2" / "depreciation_calculations.csv",
    "/api/practice/week2/inventory-answers": PRACTICE_DATA_ROOT / "week2" / "inventory_answers.csv",
    "/api/practice/week2/inventory-layers": PRACTICE_DATA_ROOT / "week2" / "inventory_layers.csv",
    "/api/practice/week2/ppe-capitalization": PRACTICE_DATA_ROOT / "week2" / "ppe_capitalization.csv",
    "/api/practice/week2/revenue-calculations": PRACTICE_DATA_ROOT / "week2" / "revenue_recognition_calculations.csv",
    "/api/practice/week2/revenue-steps": PRACTICE_DATA_ROOT / "week2" / "revenue_recognition_steps.csv",
    "/api/practice/week1/fs-reader-balance-sheet": PRACTICE_DATA_ROOT / "week1_accrual" / "fs_reader_balance_sheet.csv",
    "/api/practice/week1/fs-reader-income-statement": PRACTICE_DATA_ROOT / "week1_accrual" / "fs_reader_income_statement.csv",
    "/api/practice/week1/fs-reader-questions": PRACTICE_DATA_ROOT / "week1_accrual" / "fs_reader_questions.csv",
    "/api/practice/week1/matching-scenarios": PRACTICE_DATA_ROOT / "week1_accrual" / "matching_principle_scenarios.csv",
    "/api/practice/week1/ratio-calculations": PRACTICE_DATA_ROOT / "week1_accrual" / "ratio_calculations.csv",
    "/api/practice/week1/revenue-scenarios": PRACTICE_DATA_ROOT / "week1_accrual" / "revenue_recognition_scenarios.csv",
    "/api/practice/week1/warranty-classifier": PRACTICE_DATA_ROOT / "week1_accrual" / "warranty_classifier.csv",
    "/api/practice/week3/common-size": PRACTICE_DATA_ROOT / "week3_analysis" / "common_size_statement.csv",
    "/api/practice/week3/costco-key-figures": PRACTICE_DATA_ROOT / "week3_analysis" / "costco_key_figures.csv",
    "/api/practice/week3/dupont": PRACTICE_DATA_ROOT / "week3_analysis" / "dupont_exercises.csv",
    "/api/practice/week3/ratio-interpretation": PRACTICE_DATA_ROOT / "week3_analysis" / "ratio_interpretation.csv",
    "/api/practice/week3/ratio-table": PRACTICE_DATA_ROOT / "week3_analysis" / "ratio_table.csv",
    "/api/practice/week3/trend": PRACTICE_DATA_ROOT / "week3_analysis" / "trend_statement.csv",
    "/api/practice/week3/walmart-key-figures": PRACTICE_DATA_ROOT / "week3_analysis" / "walmart_key_figures.csv",
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
    if HOST == "0.0.0.0":
        print(f"Local URL: http://127.0.0.1:{PORT}")
    ThreadingHTTPServer((HOST, PORT), KnowledgeTreeHandler).serve_forever()
