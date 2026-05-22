# Knowledge Tree

A small browser app that renders a knowledge map from the bundled accounting CSV.

## Project Structure

- `public/` - browser-facing app files
- `data/accounting.csv` - accounting terms loaded by the app
- `server.py` - web server for Railway and local runs
- `Procfile` - Railway start command

## Run Locally

```powershell
python server.py
```

Then open:

```text
http://127.0.0.1:8001/
```

## Data Source

The app loads `data/accounting.csv` through the server at startup.

Expected CSV columns:

```csv
term,definition,example,branch
```

`branch` can use `>` to describe a path, for example:

```csv
Relevant,Useful for decisions,Financial Accounting>Meaning Information,Historical cost vs market value
```
