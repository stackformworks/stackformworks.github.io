(() => {
  'use strict';

  const byId = (id) => document.getElementById(id);
  const status = byId('extension-status');

  function showStatus(message = '', error = false) {
    status.textContent = message;
    status.dataset.error = String(error);
  }

  async function copyOutput(output, message) {
    try {
      await navigator.clipboard.writeText(output.value);
      showStatus(message);
    } catch {
      output.focus();
      output.select();
      showStatus('Clipboard access is unavailable. Copy the selected text manually.', true);
    }
  }

  function initializeResizer() {
    const form = byId('resize-form');
    const fileInput = byId('resize-file');
    const preset = byId('resize-preset');
    const widthInput = byId('resize-width');
    const heightInput = byId('resize-height');
    const mode = byId('resize-mode');
    const format = byId('resize-type');
    const sourceInfo = byId('resize-source');
    const submit = byId('resize-submit');
    const download = byId('resize-download');
    const result = byId('resize-result');
    const preview = byId('resize-preview');
    const formats = new Map([
      ['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/webp', 'webp']
    ]);
    const hints = {
      fit: 'Keeps proportions. The output may be smaller than the requested size on one side.',
      crop: 'Keeps proportions and trims the edges to get the exact requested size.',
      stretch: 'Uses the exact requested size. The proportions may change.'
    };
    let image;
    let file;
    let previewUrl;
    let filename;
    let fileRevision = 0;
    let resultRevision = 0;

    function clearResult() {
      resultRevision++;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = undefined;
      preview.removeAttribute('src');
      result.hidden = true;
      download.disabled = true;
      submit.disabled = !image;
    }

    fileInput.addEventListener('change', async () => {
      const revision = ++fileRevision;
      image = undefined;
      file = fileInput.files[0];
      clearResult();
      sourceInfo.textContent = 'JPG, PNG, or WebP up to 40 MB.';
      showStatus();
      if (!file) return;
      if (!formats.has(file.type) && (file.type || !/\.(jpe?g|png|webp)$/i.test(file.name))) {
        showStatus('Choose a JPG, PNG, or WebP image.', true);
        return;
      }
      if (file.size > 40 * 1024 * 1024) {
        showStatus('Choose an image up to 40 MB.', true);
        return;
      }
      showStatus('Opening image…');
      const url = URL.createObjectURL(file);
      try {
        const original = new Image();
        original.src = url;
        await original.decode();
        if (revision !== fileRevision) return;
        if (!original.naturalWidth || !original.naturalHeight) throw Error();
        image = original;
        sourceInfo.textContent = 'Original size · ' + original.naturalWidth + ' × ' + original.naturalHeight + ' px';
        if (!widthInput.value || !heightInput.value) {
          const scale = Math.min(1, 8192 / original.naturalWidth, 8192 / original.naturalHeight,
            Math.sqrt(32000000 / original.naturalWidth / original.naturalHeight));
          if (!widthInput.value) widthInput.value = Math.max(1, Math.floor(original.naturalWidth * scale));
          if (!heightInput.value) heightInput.value = Math.max(1, Math.floor(original.naturalHeight * scale));
        }
        submit.disabled = false;
        showStatus();
      } catch {
        if (revision === fileRevision) showStatus('This image could not be opened.', true);
      } finally {
        URL.revokeObjectURL(url);
      }
    });

    form.addEventListener('input', (event) => {
      if (event.target === fileInput) return;
      if (event.target === preset && preset.value) {
        [widthInput.value, heightInput.value] = preset.value.split('x');
        mode.value = 'crop';
      }
      if (event.target === widthInput || event.target === heightInput) preset.value = '';
      byId('resize-mode-hint').textContent = hints[mode.value];
      clearResult();
      showStatus();
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!image) return;
      clearResult();
      const revision = resultRevision;
      const requestedWidth = widthInput.valueAsNumber;
      const requestedHeight = heightInput.valueAsNumber;
      const sourceWidth = image.naturalWidth;
      const sourceHeight = image.naturalHeight;
      const mime = format.value;
      const fitScale = Math.min(requestedWidth / sourceWidth, requestedHeight / sourceHeight);
      const width = mode.value === 'fit' ? Math.max(1, Math.round(sourceWidth * fitScale)) : requestedWidth;
      const height = mode.value === 'fit' ? Math.max(1, Math.round(sourceHeight * fitScale)) : requestedHeight;
      if (width * height > 32000000) {
        showStatus('Choose dimensions that produce no more than 32 megapixels.', true);
        return;
      }

      submit.disabled = true;
      showStatus('Resizing image…');
      try {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        if (mime === 'image/jpeg') {
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, width, height);
        }
        if (mode.value === 'crop') {
          const cropScale = Math.max(width / sourceWidth, height / sourceHeight);
          const cropWidth = width / cropScale;
          const cropHeight = height / cropScale;
          ctx.drawImage(image, (sourceWidth - cropWidth) / 2, (sourceHeight - cropHeight) / 2,
            cropWidth, cropHeight, 0, 0, width, height);
        } else {
          ctx.drawImage(image, 0, 0, width, height);
        }
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, mime, 0.92));
        if (revision !== resultRevision) return;
        if (blob?.type !== mime) throw Error();
        previewUrl = URL.createObjectURL(blob);
        filename = file.name.replace(/\.[^.]+$/, '') + '-' + width + 'x' + height + '.' + formats.get(mime);
        preview.src = previewUrl;
        byId('resize-stats').textContent = width + ' × ' + height + ' px';
        result.hidden = false;
        download.disabled = false;
        showStatus('Resized image ready.');
      } catch {
        if (revision === resultRevision) showStatus('This browser could not export the image. Try a smaller size or a different format.', true);
      } finally {
        if (revision === resultRevision) submit.disabled = false;
      }
    });

    download.addEventListener('click', () => {
      if (!previewUrl) return;
      const link = document.createElement('a');
      link.href = previewUrl;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
    });
  }

  function initializeSqlList() {
    const form = byId('sql-list-form');
    const input = byId('sql-list-input');
    const output = byId('sql-list-output');
    const copy = byId('sql-list-copy');
    const backslashEscapes = { '\\': '\\\\', '\u0000': '\\0', '\u001a': '\\Z' };

    function clearOutput() {
      output.value = '';
      copy.disabled = true;
      showStatus();
    }

    form.addEventListener('input', clearOutput);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      clearOutput();
      const split = byId('sql-list-separator').value === 'commas' ? /[\r\n\t,]+/ : /[\r\n\t]+/;
      const entries = input.value.split(split).map((item) => item.trim()).filter(Boolean);
      if (!entries.length) {
        showStatus('Paste at least one value.', true);
        return;
      }

      const type = byId('sql-list-type').value;
      if (type === 'number') {
        const invalid = entries.findIndex((item) => !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(item));
        if (invalid !== -1) {
          showStatus('Value ' + (invalid + 1) + ' is not a plain number. Use Text to preserve IDs or leading zeros.', true);
          return;
        }
      }
      if (type === 'standard' && entries.some((item) => item.includes('\u0000'))) {
        showStatus('Remove null characters or use the matching MySQL text mode.', true);
        return;
      }

      const unique = byId('sql-list-dedupe').checked ? [...new Set(entries)] : entries;
      const values = unique.map((item) => {
        if (type === 'number') return item;
        const text = type === 'mysql'
          ? item.replace(/[\\\u0000\u001a]/g, (character) => backslashEscapes[character])
          : item;
        return "'" + text.replace(/'/g, "''") + "'";
      });
      output.value = byId('sql-list-multiline').checked
        ? 'IN (\n  ' + values.join(',\n  ') + '\n)'
        : 'IN (' + values.join(', ') + ')';
      copy.disabled = false;
      const removed = entries.length - values.length;
      const count = values.length + (values.length === 1 ? ' value' : ' values');
      showStatus(removed ? count + ' · ' + removed + (removed === 1 ? ' duplicate removed' : ' duplicates removed') : count);
    });

    copy.addEventListener('click', () => copyOutput(output, 'SQL copied.'));
  }

  function initializeCaseConverter() {
    const input = byId('case-input');
    const mode = byId('case-mode');
    const output = byId('case-output');
    const copy = byId('case-copy');
    const clear = byId('case-clear');
    const capitalize = (part) => part.replace(/\p{Cased_Letter}/u, (letter) => letter.toUpperCase());
    const conversions = {
      upper: (text) => text.toUpperCase(),
      lower: (text) => text.toLowerCase(),
      title: (text) => text.toLowerCase().replace(/[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*/gu, capitalize),
      sentence: (text) => text.toLowerCase()
        .split(/([.!?。！？]+["'”’)\]}]*[^\S\n]+|\n)/u)
        .map((part, index) => index % 2 === 0 ? capitalize(part) : part)
        .join('')
    };

    function convert() {
      const text = input.value;
      output.value = conversions[mode.value](text);
      copy.disabled = clear.disabled = !text.length;
      showStatus();
    }

    input.addEventListener('input', convert);
    mode.addEventListener('change', convert);
    copy.addEventListener('click', () => copyOutput(output, 'Text copied.'));
    clear.addEventListener('click', () => {
      input.value = '';
      convert();
      input.focus();
      showStatus('Text cleared.');
    });
    convert();
  }

  const initialize = {
    'image-resizer': initializeResizer,
    'sql-in-list-generator': initializeSqlList,
    'text-case-converter': initializeCaseConverter
  };
  initialize[byId('main')?.dataset.toolExtension]?.();
})();
