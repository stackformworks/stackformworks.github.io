'use strict';
const form = document.querySelector('form');
const byId = (id) => document.getElementById(id);
const operation = byId('operation');
const file = byId('file');
const button = form.querySelector('button');
const status = byId('status');
const result = byId('result');
const link = byId('download');
const preview = byId('preview');
const formats = {
  'word-pdf': ['docx', 'pdf', 'Install the original fonts for the closest match. Check margins, headers, and page breaks in the preview.'],
  'excel-pdf': ['xlsx', 'pdf', 'Set the print area, orientation, and scaling in Excel before conversion.'],
  'pdf-word': ['pdf', 'docx', 'Each page becomes an image inside Word. The appearance is preserved while the text stays inside the images.'],
  'pdf-excel': ['pdf', 'xlsx', 'Extracts text-based tables with visible borders. Values stay as text so IDs and leading zeros are preserved. Scanned PDFs require OCR.']
};
let resultUrl;

function say(message = '', error = false) {
  status.textContent = message;
  status.dataset.error = String(error);
}

function reset() {
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  resultUrl = undefined;
  link.removeAttribute('href');
  preview.removeAttribute('src');
  preview.hidden = result.hidden = true;
  say();
}

function updateOperation() {
  const [from, , note] = formats[operation.value];
  file.accept = '.' + from;
  file.value = '';
  byId('mode-note').textContent = note;
  reset();
}

operation.addEventListener('change', updateOperation);
file.addEventListener('change', reset);
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  reset();
  const chosen = file.files[0];
  const [from, to] = formats[operation.value];
  if (!chosen || !chosen.name.toLowerCase().endsWith('.' + from) || chosen.size > 25 * 1024 * 1024) {
    say('Choose a .' + from + ' file up to 25 MB.', true);
    return;
  }
  file.disabled = operation.disabled = button.disabled = true;
  say('Converting…');
  try {
    const response = await fetch('/api/convert/' + operation.value, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: chosen
    });
    if (!response.ok) throw new Error((await response.json()).error);
    resultUrl = URL.createObjectURL(await response.blob());
    link.href = resultUrl;
    link.download = chosen.name.slice(0, -from.length - 1) + '-converted.' + to;
    if (to === 'pdf') {
      preview.src = resultUrl;
      preview.hidden = false;
    }
    result.hidden = false;
    say(response.headers.get('X-ToolVibe-Result') || 'Conversion complete.');
  } catch (error) {
    say(error.message || 'Conversion failed.', true);
  } finally {
    file.disabled = operation.disabled = button.disabled = false;
  }
});
updateOperation();
