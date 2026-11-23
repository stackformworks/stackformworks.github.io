# ToolVibe Document Converter

Run the converter on your own computer. It binds to 127.0.0.1 and takes no API keys. Files are processed in per-request temporary directories. Use documents you trust.

## Start it

1. Install Python 3.10 or newer, LibreOffice, and Poppler. Make sure `pdftoppm` is on your PATH. On Linux, install LibreOffice Writer and Calc. If LibreOffice is in a nonstandard location, set the `TOOLVIBE_SOFFICE` environment variable to the full path of its executable.
2. From this directory run `python -m pip install -r requirements.txt`.
3. Run `python convert.py` and open [http://127.0.0.1:8787](http://127.0.0.1:8787/).

Install your documents' original fonts before exporting. Include Sinhala fonts such as Noto Sans Sinhala if your documents use them. Review PDF previews, especially if the source used Word-specific fonts, layout features, or Excel print settings.

## What is supported

| Conversion | Output |
|---|---|
| DOCX to PDF | LibreOffice Writer export with PDF preview |
| XLSX to PDF | LibreOffice Calc export with PDF preview |
| PDF to DOCX | One rendered page image per Word page. Text within the page images is not editable. |
| PDF to XLSX | One worksheet per detected bordered text table. Values are stored as strings to preserve IDs and leading zeros. Scans and borderless tables require another engine. |

Inputs are limited to 25 MB. PDF inputs must have 1–50 pages and cannot require a password. Macro-enabled documents and Office documents with externally linked resources are outside this tool's scope.

This local application needs a running Python process, LibreOffice and Poppler. GitHub Pages serves the separate PDF Editor, which runs in the browser. Before offering these conversions to public visitors, use a separately hosted conversion service with isolated jobs, resource limits and restricted egress.
