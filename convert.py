"""Local conversion for ToolVibe. Run with Python 3.10+."""
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZipFile, BadZipFile
import argparse
import json
import os
import shutil
import subprocess
from urllib.parse import urlparse
import xml.etree.ElementTree as ET

from docx import Document
from docx.enum.section import WD_SECTION_START
from docx.shared import Pt
from openpyxl import Workbook
from pypdf import PdfReader
import pdfplumber

BASE = Path(__file__).resolve().parent
LIMIT = 25 * 1024 * 1024
OPERATIONS = {
    'word-pdf': ('docx', 'pdf', 'application/pdf'),
    'excel-pdf': ('xlsx', 'pdf', 'application/pdf'),
    'pdf-word': ('pdf', 'docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    'pdf-excel': ('pdf', 'xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
}


def command(args, seconds):
    try:
        subprocess.run(args, check=True, timeout=seconds, capture_output=True)
    except FileNotFoundError as exc:
        raise ValueError('Required converter is missing: ' + args[0]) from exc
    except subprocess.TimeoutExpired as exc:
        raise ValueError('Conversion took too long. Try a smaller document.') from exc
    except subprocess.CalledProcessError as exc:
        raise ValueError('The conversion engine could not process this file.') from exc


def inspect_office(path):
    expected = 'word/document.xml' if path.suffix == '.docx' else 'xl/workbook.xml'
    try:
        with ZipFile(path) as archive:
            entries = archive.infolist()
            names = {item.filename for item in entries}
            if expected not in names or '[Content_Types].xml' not in names:
                raise ValueError('This file does not match the selected Word or Excel format.')
            if len(entries) > 4000 or sum(item.file_size for item in entries) > 150 * 1024 * 1024:
                raise ValueError('This document expands beyond the converter size limit.')
            for item in entries:
                if 'vbaproject' in item.filename.lower():
                    raise ValueError('Choose a document without macros.')
                if item.filename.endswith('.rels'):
                    if item.file_size > 1024 * 1024:
                        raise ValueError('The document contains an oversized relationship file.')
                    for relation in ET.fromstring(archive.read(item)):
                        if (relation.get('TargetMode', '').lower() == 'external'
                                and not relation.get('Type', '').endswith('/hyperlink')):
                            raise ValueError('Remove externally linked resources before converting.')
    except (BadZipFile, ET.ParseError, RuntimeError) as exc:
        raise ValueError('The Office document is damaged or protected.') from exc


def office_to_pdf(path, target):
    inspect_office(path)
    configured = os.getenv('TOOLVIBE_SOFFICE')
    executable = configured or shutil.which('soffice') or shutil.which('libreoffice')
    if not executable:
        exe = Path(os.environ.get('ProgramFiles', 'C:/Program Files')) / 'LibreOffice/program/soffice.exe'
        executable = str(exe) if exe.is_file() else None
    if not executable:
        raise ValueError('Install LibreOffice or configure TOOLVIBE_SOFFICE.')
    profile = (path.parent / 'office-profile').as_uri()
    command([executable, '-env:UserInstallation=' + profile, '--headless', '--norestore',
             '--convert-to', 'pdf', '--outdir', str(path.parent), str(path)], 60)
    created = path.with_suffix('.pdf')
    if not created.is_file() or created.stat().st_size < 8:
        raise ValueError('LibreOffice did not produce a PDF. Check the source file.')
    created.replace(target)
    return f'{len(PdfReader(target).pages)} PDF page(s). Check the preview before downloading.'


def pdf_reader(path):
    try:
        pdf = PdfReader(path)
        if pdf.is_encrypted:
            raise ValueError('Choose a PDF without password protection.')
        if not 1 <= len(pdf.pages) <= 50:
            raise ValueError('Choose a PDF with 1 to 50 pages.')
        return pdf
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError('This PDF could not be opened.') from exc


def pdf_to_word(path, target):
    pdf = pdf_reader(path)
    document = Document()
    for number, page in enumerate(pdf.pages, 1):
        box = page.cropbox
        unit = float(page.user_unit)
        width, height = float(box.width) * unit, float(box.height) * unit
        if page.rotation % 180:
            width, height = height, width
        if not (10 <= width <= 1584 and 10 <= height <= 1584):
            raise ValueError('A PDF page is outside the supported Word page size.')
        prefix = path.parent / f'rendered-{number}'
        command(['pdftoppm', '-f', str(number), '-l', str(number), '-singlefile',
                 '-cropbox', '-scale-to', '2000', '-png', str(path), str(prefix)], 20)
        section = document.sections[0] if number == 1 else document.add_section(WD_SECTION_START.NEW_PAGE)
        section.page_width, section.page_height = Pt(width), Pt(height)
        section.left_margin = section.right_margin = Pt(0)
        section.top_margin = section.bottom_margin = Pt(0)
        # Allow a small paragraph boundary so image-only pages do not spill into blank pages.
        paragraph = document.add_paragraph()
        paragraph.paragraph_format.space_before = Pt(0)
        paragraph.paragraph_format.space_after = Pt(0)
        inset = min((height - 3) / height, (width - 1) / width)
        paragraph.add_run().add_picture(str(prefix.with_suffix('.png')), width=Pt(width * inset))
        prefix.with_suffix('.png').unlink()
    document.save(target)
    return f'{len(pdf.pages)} page image(s). The Word output preserves the appearance as page images.'


def pdf_to_excel(path, target):
    pdf_reader(path)
    book = Workbook()
    book.remove(book.active)
    table_count = 0
    with pdfplumber.open(path) as pdf:
        pages_with_tables = 0
        for number, page in enumerate(pdf.pages, 1):
            found = False
            for index, table in enumerate(page.extract_tables(), 1):
                if not any(cell and cell.strip() for row in table for cell in row):
                    continue
                found = True
                table_count += 1
                sheet = book.create_sheet(f'Page {number} Table {index}')
                for row_index, row in enumerate(table, 1):
                    for column, value in enumerate(row, 1):
                        if value is None:
                            continue
                        cell = sheet.cell(row_index, column, value)
                        cell.data_type = 's'  # Keep leading zeros and prevent formula interpretation.
            pages_with_tables += int(found)
            page.close()
        total = len(pdf.pages)
    if not table_count:
        raise ValueError('No text-based tables with visible borders were found. Scanned or borderless tables need a different extraction engine.')
    book.save(target)
    return f'{table_count} table(s) found on {pages_with_tables} of {total} pages. Check the extracted values in Excel.'


class LocalConverter(BaseHTTPRequestHandler):
    def allowed_host(self):
        port = self.server.server_port
        return self.headers.get('Host') in (f'127.0.0.1:{port}', f'localhost:{port}')

    def send_bytes(self, body, mime, code=200, extra=()):
        self.send_response(code)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        for name, value in extra:
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def fail(self, message, code=400):
        self.send_bytes(json.dumps({'error': message}).encode(), 'application/json', code)

    def do_GET(self):
        if not self.allowed_host():
            self.fail('Open the converter on localhost.', 403)
            return
        files = {'/': ('index.html', 'text/html; charset=utf-8'),
                 '/converter.js': ('converter.js', 'text/javascript; charset=utf-8')}
        entry = files.get(urlparse(self.path).path)
        if entry:
            self.send_bytes((BASE / entry[0]).read_bytes(), entry[1])
        else:
            self.fail('File not found.', 404)

    def do_POST(self):
        if not self.allowed_host() or self.headers.get('Origin') not in (None, 'http://' + self.headers['Host']):
            self.fail('Use the conversion page on this computer.', 403)
            return
        operation = urlparse(self.path).path.removeprefix('/api/convert/')
        if self.path != '/api/convert/' + operation or operation not in OPERATIONS:
            self.fail('Unknown conversion.', 404)
            return
        if self.headers.get('Content-Type') != 'application/octet-stream':
            self.fail('Choose a document using the conversion form.', 415)
            return
        try:
            size = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            size = 0
        if not 1 <= size <= LIMIT:
            self.fail('Choose a file up to 25 MB.', 413)
            return
        source_type, output_type, mime = OPERATIONS[operation]
        try:
            self.connection.settimeout(15)
            body = self.rfile.read(size)
            if len(body) != size:
                raise ValueError('The document upload did not finish.')
            if source_type == 'pdf' and not body.startswith(b'%PDF-'):
                raise ValueError('Choose a valid PDF file.')
            with TemporaryDirectory(prefix='toolvibe-convert-') as tmp:
                folder = Path(tmp)
                source = folder / f'input.{source_type}'
                target = folder / f'converted.{output_type}'
                source.write_bytes(body)
                converter = {'word-pdf': office_to_pdf, 'excel-pdf': office_to_pdf,
                             'pdf-word': pdf_to_word, 'pdf-excel': pdf_to_excel}[operation]
                message = converter(source, target)
                if target.stat().st_size > 100 * 1024 * 1024:
                    raise ValueError('The output is too large. Try a smaller document.')
                data = target.read_bytes()
            self.send_bytes(data, mime, extra=(('X-ToolVibe-Result', message),))
        except ValueError as exc:
            self.fail(str(exc), 422)
        except BrokenPipeError:
            pass
        except TimeoutError:
            self.fail('The document upload timed out.', 408)
        except Exception:
            self.fail('Conversion failed. Check the document and try again.', 422)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8787)
    options = parser.parse_args()
    with HTTPServer(('127.0.0.1', options.port), LocalConverter) as server:
        print(f'ToolVibe Document Converter: http://127.0.0.1:{server.server_port}/', flush=True)
        server.serve_forever()
