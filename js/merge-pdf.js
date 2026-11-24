(() => {
  'use strict';

  const input = document.getElementById('merge-files');
  const list = document.getElementById('merge-list');
  const run = document.getElementById('merge-run');
  const clear = document.getElementById('merge-clear');
  const download = document.getElementById('merge-download');
  const status = document.getElementById('merge-status');
  const maxFiles = 20;
  const maxBytes = 50 * 1024 * 1024;
  const maxPages = 500;
  const files = [];
  let busy = false;
  let resultUrl;

  function announce(message, error = false) {
    status.textContent = message;
    status.dataset.error = String(error);
  }

  function clearResult() {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = undefined;
    download.hidden = true;
    download.removeAttribute('href');
  }

  function render() {
    list.parentElement.hidden = !files.length;
    list.replaceChildren();
    input.disabled = busy;
    run.disabled = busy || files.length < 2;
    clear.disabled = busy || !files.length;
    files.forEach((file, index) => {
      const item = document.createElement('li');
      item.className = 'result';
      const name = document.createElement('p');
      name.className = 'merge-file-name';
      name.textContent = file.name;
      const actions = document.createElement('div');
      actions.className = 'actions';
      const options = [
        { label: 'Move up', disabled: index === 0, offset: -1 },
        { label: 'Move down', disabled: index === files.length - 1, offset: 1 },
        { label: 'Remove', disabled: false, offset: 0 }
      ];
      options.forEach(({ label, disabled, offset }, buttonIndex) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn secondary';
        button.textContent = label;
        button.disabled = busy || disabled;
        button.setAttribute('aria-label', label + ' ' + file.name + ', file ' + (index + 1));
        button.addEventListener('click', () => {
          const [selected] = files.splice(index, 1);
          const nextIndex = index + offset;
          if (offset) files.splice(nextIndex, 0, selected);
          clearResult();
          render();
          const nextItem = list.children[Math.min(nextIndex, files.length - 1)];
          const nextButtons = nextItem?.querySelectorAll('button');
          const preferred = nextButtons?.[buttonIndex];
          (preferred && !preferred.disabled ? preferred : nextItem?.querySelector('button:enabled') ?? input).focus();
          announce(offset ? file.name + ' moved to position ' + (nextIndex + 1) + '.' : file.name + ' removed.');
        });
        actions.append(button);
      });
      item.append(name, actions);
      list.append(item);
    });
  }

  input.addEventListener('change', () => {
    if (busy) return;
    const selected = [...input.files];
    input.value = '';
    if (!selected.length) return;
    if (selected.some((file) => !/\.pdf$/i.test(file.name) || file.size === 0)) {
      announce('Choose non-empty files with a .pdf extension.', true);
      return;
    }
    if (files.length + selected.length > maxFiles) {
      announce('Choose up to 20 PDF files. Remove some files before adding more.', true);
      return;
    }
    const size = [...files, ...selected].reduce((total, file) => total + file.size, 0);
    if (size > maxBytes) {
      announce('Keep the total file size at 50 MB or less. Remove some files before adding more.', true);
      return;
    }
    files.push(...selected);
    clearResult();
    render();
    announce(files.length === 1 ? 'One PDF added. Add at least one more.' : files.length + ' PDFs ready to merge.');
  });

  clear.addEventListener('click', () => {
    files.length = 0;
    clearResult();
    render();
    input.focus();
    announce('Files cleared.');
  });

  run.addEventListener('click', async () => {
    if (busy || files.length < 2) return;
    const pdf = window.PDFLib;
    if (!pdf) {
      announce('The PDF library could not load. Reload this page and try again.', true);
      return;
    }
    clearResult();
    busy = true;
    render();
    announce('Merging PDFs…');
    try {
      const output = await pdf.PDFDocument.create();
      for (const file of files) {
        let source;
        try {
          source = await pdf.PDFDocument.load(await file.arrayBuffer(), { updateMetadata: false });
        } catch (error) {
          if (error instanceof pdf.EncryptedPDFError) {
            announce('Unlock “' + file.name + '” before merging.', true);
          } else {
            announce('Could not open “' + file.name + '”. Remove it or choose a readable PDF.', true);
          }
          return;
        }
        const pageCount = source.getPageCount();
        if (!pageCount) {
          announce('“' + file.name + '” has no pages. Remove it and try again.', true);
          return;
        }
        if (output.getPageCount() + pageCount > maxPages) {
          announce('The combined PDF would exceed 500 pages. Remove some files and try again.', true);
          return;
        }
        const pages = await output.copyPages(source, source.getPageIndices());
        for (const page of pages) output.addPage(page);
      }
      const blob = new Blob([await output.save()], { type: 'application/pdf' });
      resultUrl = URL.createObjectURL(blob);
      download.href = resultUrl;
      download.hidden = false;
      announce('Merged ' + files.length + ' PDFs into ' + output.getPageCount() + ' pages. Your download is ready.');
      if (document.activeElement === document.body || document.activeElement === run) download.focus();
    } catch {
      announce('The files could not be merged. Try a smaller batch or remove a problematic file.', true);
    } finally {
      busy = false;
      render();
    }
  });
})();
