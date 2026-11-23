import { GlobalWorkerOptions, getDocument } from '../assets/pdf-editor/pdf.min.mjs';

const assets = new URL('../assets/pdf-editor/', import.meta.url);
GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', assets).href;

let characterMaps;

async function readAsset(url, conversion) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Could not load PDF rendering data.');
  return response[conversion]();
}

class PdfAssetFactory {
  constructor({ standardFontDataUrl, wasmUrl }) {
    this.locations = { standardFontDataUrl, wasmUrl };
  }

  async fetch({ kind, filename }) {
    if (!/^[a-z0-9][a-z0-9_.-]*$/i.test(filename)) throw new Error('Invalid PDF rendering asset.');
    if (kind === 'cMapUrl') {
      // Keep PDF.js's packed maps intact and fetch them only for PDFs that require them.
      characterMaps ??= readAsset(new URL('cmaps.json', assets), 'json').catch((error) => {
        characterMaps = undefined;
        throw error;
      });
      const maps = await characterMaps;
      if (!Object.hasOwn(maps, filename)) throw new Error('Missing PDF character map.');
      return Uint8Array.from(atob(maps[filename]), (byte) => byte.charCodeAt(0));
    }
    if (!Object.hasOwn(this.locations, kind)) throw new Error('Invalid PDF asset type.');
    return new Uint8Array(await readAsset(new URL(filename, this.locations[kind]), 'arrayBuffer'));
  }
}

const byId = (id) => document.getElementById(id);
const file = byId('pdf-file');
const controls = byId('pdf-controls');
const pageCanvas = byId('pdf-page');
const overlay = byId('pdf-overlay');
const mode = byId('pdf-mode');
const textInput = byId('pdf-text');
const status = byId('pdf-status');
const buttons = Object.fromEntries(
  ['prev', 'next', 'rotate', 'earlier', 'later', 'delete', 'undo', 'save'].map((id) => [id, byId('pdf-' + id)])
);
let source;
let viewer;
let loadTask;
let state = { pages: [], position: 0 };
let history = [];
let viewport;
let renderTask;
let renderVersion = 0;
let fileVersion = 0;
let busy = false;
let drawing;

function announce(text, error = false) {
  status.textContent = text;
  status.dataset.error = String(error);
}

function updateButtons() {
  const { pages, position } = state;
  const disabled = busy || !viewport;
  buttons.prev.disabled = buttons.earlier.disabled = disabled || position === 0;
  buttons.next.disabled = buttons.later.disabled = disabled || position >= pages.length - 1;
  buttons.delete.disabled = disabled || pages.length < 2;
  buttons.rotate.disabled = buttons.save.disabled = disabled;
  buttons.undo.disabled = disabled || !history.length;
  byId('pdf-page-number').value = 'Page ' + (position + 1) + ' of ' + pages.length;
}

function checkpoint() {
  history.push(state);
  if (history.length > 50) history.shift();
  state = { pages: [...state.pages], position: state.position };
}

function drawAnnotation(context, currentViewport, annotation) {
  const [origin, xBasis, yBasis] = annotation.basis.map(([x, y]) => currentViewport.convertToViewportPoint(x, y));
  context.save();
  context.transform(
    xBasis[0] - origin[0], xBasis[1] - origin[1],
    yBasis[0] - origin[0], yBasis[1] - origin[1], origin[0], origin[1]
  );
  const [[x, y], ...points] = annotation.points;
  if (annotation.mode === 'text') {
    context.font = '16px system-ui, sans-serif';
    context.fillStyle = '#17281f';
    context.fillText(annotation.text, x, y);
  } else if (annotation.mode === 'highlight') {
    const [endX, endY] = points.at(-1) ?? [x, y];
    context.fillStyle = 'rgba(255, 227, 39, .42)';
    context.fillRect(x, y, endX - x, endY - y);
  } else {
    context.strokeStyle = '#1746a0';
    context.lineJoin = context.lineCap = 'round';
    context.lineWidth = 2.5;
    context.beginPath();
    context.moveTo(x, y);
    for (const [endX, endY] of points) context.lineTo(endX, endY);
    context.stroke();
  }
  context.restore();
}

function updateOverlay() {
  const context = overlay.getContext('2d');
  context.clearRect(0, 0, overlay.width, overlay.height);
  if (!viewport) return;
  for (const note of state.pages[state.position].annotations) drawAnnotation(context, viewport, note);
  if (drawing) drawAnnotation(context, viewport, drawing.note);
}

async function showPage() {
  const revision = ++renderVersion;
  viewport = undefined;
  drawing = undefined;
  const previous = renderTask;
  previous?.cancel();
  updateButtons();
  const item = state.pages[state.position];
  if (!item) return;

  try {
    if (previous) await previous.promise.catch(() => {});
    if (revision !== renderVersion) return;
    const page = await viewer.getPage(item.number);
    if (revision !== renderVersion) return;
    const original = page.getViewport({ scale: 1, rotation: page.rotate + item.turn });
    const size = Math.min(1.65, 1500 / original.width, 1900 / original.height);
    const view = page.getViewport({ scale: size, rotation: page.rotate + item.turn });
    pageCanvas.width = overlay.width = Math.ceil(view.width);
    pageCanvas.height = overlay.height = Math.ceil(view.height);
    pageCanvas.style.aspectRatio = pageCanvas.width + ' / ' + pageCanvas.height;
    renderTask = page.render({ canvas: pageCanvas, viewport: view });
    await renderTask.promise;
    if (revision !== renderVersion) return;
    viewport = view;
    updateOverlay();
  } catch {
    if (revision === renderVersion) announce('This page could not be displayed.', true);
  } finally {
    if (revision === renderVersion) {
      renderTask = undefined;
      updateButtons();
    }
  }
}

file.addEventListener('change', async () => {
  const revision = ++fileVersion;
  ++renderVersion;
  renderTask?.cancel();
  const previous = loadTask;
  loadTask = undefined;
  viewer = viewport = source = undefined;
  history = [];
  state = { pages: [], position: 0 };
  controls.hidden = true;
  announce();
  const selected = file.files[0];
  if (!selected) return;
  if (!/\.pdf$/i.test(selected.name) || selected.size > 30 * 1024 * 1024) {
    announce('Choose a PDF file up to 30 MB.', true);
    return;
  }
  announce('Opening PDF…');
  try {
    if (previous) await previous.destroy().catch(() => {});
    const bytes = new Uint8Array(await selected.arrayBuffer());
    if (revision !== fileVersion) return;
    // Validate editability before showing a preview or accepting annotations.
    await PDFLib.PDFDocument.load(bytes, { updateMetadata: false });
    if (revision !== fileVersion) return;
    loadTask = getDocument({
      data: bytes.slice(),
      isEvalSupported: false,
      enableXfa: false,
      BinaryDataFactory: PdfAssetFactory,
      useWorkerFetch: false,
      cMapPacked: true,
      standardFontDataUrl: new URL('standard_fonts/', assets).href,
      wasmUrl: new URL('wasm/', assets).href,
      iccUrl: new URL('iccs/', assets).href
    });
    const opened = await loadTask.promise;
    if (revision !== fileVersion) return;
    if (opened.numPages > 200 || opened.numPages < 1) {
      announce('Choose a PDF with 1 to 200 pages.', true);
      return;
    }
    source = { bytes, name: selected.name.replace(/\.pdf$/i, '') };
    viewer = opened;
    state = { position: 0, pages: Array.from({ length: opened.numPages }, (_, i) => ({ number: i + 1, turn: 0, annotations: [] })) };
    controls.hidden = false;
    announce('PDF opened.');
    await showPage();
  } catch {
    if (revision === fileVersion) announce('This PDF could not be opened for editing. Check whether it is encrypted or damaged.', true);
  }
});

function changePage(operation) {
  if (!viewport || busy) return;
  const { position } = state;
  const item = state.pages[position];
  checkpoint();
  if (operation === 'rotate') state.pages[position] = { ...item, turn: (item.turn + 90) % 360 };
  if (operation === 'delete') {
    state.pages.splice(position, 1);
    state.position = Math.min(position, state.pages.length - 1);
  }
  if (operation === 'earlier' || operation === 'later') {
    const target = position + (operation === 'earlier' ? -1 : 1);
    state.pages.splice(position, 1);
    state.pages.splice(target, 0, item);
    state.position = target;
  }
  showPage();
}
for (const key of ['rotate', 'delete', 'earlier', 'later']) buttons[key].addEventListener('click', () => changePage(key));
for (const [key, step] of [['prev', -1], ['next', 1]]) {
  buttons[key].addEventListener('click', () => {
    state = { ...state, position: state.position + step };
    showPage();
  });
}
buttons.undo.addEventListener('click', () => {
  if (!history.length || busy) return;
  state = history.pop();
  showPage();
});

function createNote(point) {
  const [x, y] = point;
  const unit = viewport.scale;
  return {
    mode: mode.value,
    text: textInput.value.trim(),
    basis: [[x, y], [x + unit, y], [x, y + unit]].map(([a, b]) => viewport.convertToPdfPoint(a, b)),
    points: [[0, 0]]
  };
}

function commitNote(note) {
  const index = state.position;
  const item = state.pages[index];
  checkpoint();
  state.pages[index] = { ...item, annotations: [...item.annotations, note] };
  updateOverlay();
  updateButtons();
}

function pointerPoint(event) {
  const box = overlay.getBoundingClientRect();
  const clamp = (x, range) => Math.min(range, Math.max(0, x));
  return [
    clamp((event.clientX - box.left) * overlay.width / box.width, viewport.width),
    clamp((event.clientY - box.top) * overlay.height / box.height, viewport.height)
  ];
}

function placeText(point) {
  if (!textInput.value.trim()) {
    announce('Enter the text you want to add.', true);
    textInput.focus();
    return;
  }
  commitNote(createNote(point));
  announce('Text added.');
}

mode.addEventListener('change', () => {
  byId('pdf-text-field').hidden = mode.value !== 'text';
  byId('pdf-help').textContent = mode.value === 'text'
    ? 'Type your text, then click where its baseline should appear. With a keyboard, focus the PDF preview and press Enter to place it at the center.'
    : 'Drag on the preview to ' + (mode.value === 'ink' ? 'draw on this page.' : 'highlight a rectangular area.');
});
overlay.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && mode.value === 'text' && viewport && !busy) {
    event.preventDefault();
    placeText([viewport.width / 2, viewport.height / 2]);
  }
});
overlay.addEventListener('pointerdown', (event) => {
  if (!viewport || busy || drawing || !event.isPrimary || event.button !== 0) return;
  const point = pointerPoint(event);
  if (mode.value === 'text') return placeText(point);
  drawing = { id: event.pointerId, start: point, note: createNote(point) };
  overlay.setPointerCapture(event.pointerId);
});
function trackPointer(event) {
  if (drawing?.id !== event.pointerId || !viewport) return;
  const p = pointerPoint(event).map((value, i) => (value - drawing.start[i]) / viewport.scale);
  if (drawing.note.mode === 'highlight') drawing.note.points[1] = p;
  else if (drawing.note.points.length < 2000) drawing.note.points.push(p);
  updateOverlay();
}
overlay.addEventListener('pointermove', trackPointer);
overlay.addEventListener('pointerup', (event) => {
  if (drawing?.id !== event.pointerId || !viewport) return;
  trackPointer(event);
  const { note } = drawing;
  drawing = undefined;
  if (note.points.some(([x, y]) => x || y)) {
    commitNote(note);
    announce(note.mode === 'ink' ? 'Drawing added.' : 'Highlight added.');
  } else updateOverlay();
});
overlay.addEventListener('pointercancel', (event) => {
  if (drawing?.id !== event.pointerId) return;
  drawing = undefined;
  updateOverlay();
});

async function addAnnotations(document, page, view, annotations) {
  if (!annotations.length) return;
  const canvas = window.document.createElement('canvas');
  const scale = Math.min(2, 2400 / view.width, 2400 / view.height);
  canvas.width = Math.ceil(view.width * scale);
  canvas.height = Math.ceil(view.height * scale);
  const context = canvas.getContext('2d');
  context.scale(canvas.width / view.width, canvas.height / view.height);
  for (const note of annotations) drawAnnotation(context, view, note);
  const image = await document.embedPng(canvas.toDataURL('image/png'));
  const [x, y] = view.convertToPdfPoint(0, view.height);
  const [rightX, rightY] = view.convertToPdfPoint(view.width, view.height);
  const [topX, topY] = view.convertToPdfPoint(0, 0);
  page.drawImage(image, {
    x, y,
    width: Math.hypot(rightX - x, rightY - y),
    height: Math.hypot(topX - x, topY - y),
    rotate: PDFLib.degrees(Math.atan2(rightY - y, rightX - x) * 180 / Math.PI)
  });
}

buttons.save.addEventListener('click', async () => {
  if (!source || !viewport || busy) return;
  busy = true;
  file.disabled = true;
  updateButtons();
  announce('Preparing the edited PDF…');
  try {
    const output = await PDFLib.PDFDocument.load(source.bytes, { updateMetadata: false });
    const originals = output.getPages();
    // Preserve the original page tree unless the user changes order or deletes pages.
    const rearranged = state.pages.length !== originals.length || state.pages.some((item, i) => item.number !== i + 1);
    if (rearranged) {
      for (let i = originals.length - 1; i >= 0; i--) output.removePage(i);
      for (const item of state.pages) output.addPage(originals[item.number - 1]);
    }
    for (const item of state.pages) {
      const page = originals[item.number - 1];
      const angle = (page.getRotation().angle + item.turn) % 360;
      if (item.turn) page.setRotation(PDFLib.degrees(angle));
      if (item.annotations.length) {
        const pdfjsPage = await viewer.getPage(item.number);
        const view = pdfjsPage.getViewport({ scale: 1, rotation: angle });
        await addAnnotations(output, page, view, item.annotations);
      }
    }
    const blob = new Blob([await output.save({ updateFieldAppearances: false })], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = source.name + '-edited.pdf';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    announce('Edited PDF downloaded.');
  } catch {
    announce('The edited PDF could not be exported. Your original has not changed.', true);
  } finally {
    busy = false;
    file.disabled = false;
    updateButtons();
  }
});
