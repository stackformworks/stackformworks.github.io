'use strict';

const byId = (id) => document.getElementById(id);
const tool = byId('main').dataset.tool;

function status(message = '', error = false) {
  const element = byId('status');
  element.textContent = message;
  element.dataset.error = String(error);
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

async function copy(text, message, source) {
  try {
    await navigator.clipboard.writeText(text);
    status(message);
  } catch {
    if (source instanceof HTMLTextAreaElement) {
      source.focus();
      source.select();
    } else if (source) {
      const range = document.createRange();
      range.selectNodeContents(source);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
    status('Clipboard access is unavailable. Copy the selected text manually.', true);
  }
}

function qrTool() {
  const form = byId('qr-form');
  const type = byId('qr-type');
  const value = byId('qr-value');
  const network = byId('wifi-name');
  const security = byId('wifi-security');
  const password = byId('wifi-password');
  const png = byId('qr-png');
  const svg = byId('qr-svg');
  const preview = byId('qr-preview');
  let image = '';
  let canvas;

  function updateType() {
    const wifi = type.value === 'wifi';
    byId('qr-value-fields').hidden = wifi;
    byId('qr-wifi-fields').hidden = !wifi;
    value.required = !wifi;
    network.required = wifi;
    password.disabled = security.value === 'nopass';
    password.required = wifi && !password.disabled;
    byId('qr-value-label').textContent = type.value === 'url' ? 'Website URL' : 'Text to encode';
    value.placeholder = type.value === 'url' ? 'https://example.com' : 'Enter a message';
  }

  function reset() {
    image = '';
    canvas = undefined;
    png.disabled = svg.disabled = true;
    byId('qr-result').hidden = true;
    preview.removeAttribute('src');
    status();
  }

  function escapeWifi(text) {
    return text.replace(/[\\;,":]/g, (character) => '\\' + character);
  }

  form.addEventListener('input', () => {
    updateType();
    reset();
  });
  updateType();

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    reset();
    let payload = value.value;
    if (type.value === 'url') {
      try {
        const entered = value.value.trim();
        const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(entered) ? entered : 'https://' + entered);
        if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || /\s/.test(entered)) throw Error();
        payload = url.href;
      } catch {
        status('Enter a valid HTTP or HTTPS address.', true);
        return;
      }
    }
    if (type.value === 'wifi') {
      const pass = password.disabled ? '' : 'P:' + escapeWifi(password.value) + ';';
      payload = 'WIFI:T:' + security.value + ';S:' + escapeWifi(network.value) + ';' + pass
        + 'H:' + byId('wifi-hidden').checked + ';;';
      if (new TextEncoder().encode(network.value).length > 32) {
        status('A Wi-Fi network name can contain up to 32 bytes.', true);
        return;
      }
    }
    const bytes = new TextEncoder().encode(payload);
    if (!bytes.length || bytes.length > 2000) {
      status('Enter between 1 and 2,000 bytes of content.', true);
      return;
    }
    try {
      const qr = new window.ToolVibeQRCode(-1, 0); // Medium error correction.
      qr.addData(String.fromCharCode(...bytes));
      qr.make();
      const count = qr.getModuleCount();
      const size = count + 8;
      const scale = Math.max(4, Math.floor(600 / size));
      canvas = document.createElement('canvas');
      canvas.width = canvas.height = size * scale;
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#000';
      const paths = [];
      for (let row = 0; row < count; row++) {
        for (let col = 0; col < count; col++) {
          if (!qr.isDark(row, col)) continue;
          const x = col + 4;
          const y = row + 4;
          context.fillRect(x * scale, y * scale, scale, scale);
          paths.push('M' + x + ' ' + y + 'h1v1h-1z');
        }
      }
      image = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' ' + size
        + '" shape-rendering="crispEdges"><path fill="#fff" d="M0 0h' + size + 'v' + size
        + 'H0z"/><path d="' + paths.join('') + '"/></svg>';
      preview.src = canvas.toDataURL('image/png');
      byId('qr-result').hidden = false;
      png.disabled = svg.disabled = false;
      status('QR code ready to scan or download.');
    } catch {
      status('This QR code could not be generated. Try a shorter input.', true);
    }
  });

  png.addEventListener('click', () => {
    canvas?.toBlob((blob) => { if (blob) download(blob, 'toolvibe-qr-code.png'); });
  });
  svg.addEventListener('click', () => {
    if (image) download(new Blob([image], { type: 'image/svg+xml' }), 'toolvibe-qr-code.svg');
  });
}

function imageTool() {
  const form = byId('image-form');
  const file = byId('image-file');
  const type = byId('image-type');
  const quality = byId('image-quality');
  const submit = byId('image-submit');
  const save = byId('image-download');
  const formats = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  let sequence = 0;
  let result;
  let resultUrl;
  let filename;

  function updateQuality() {
    byId('image-quality-value').textContent = quality.value + '%';
    quality.disabled = type.value === 'image/png';
    byId('image-quality-hint').textContent = quality.disabled
      ? 'PNG uses lossless encoding. Resize the image to reduce its dimensions.'
      : 'Lower quality usually creates a smaller file.';
  }

  function reset() {
    sequence++;
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = result = undefined;
    byId('image-preview').removeAttribute('src');
    byId('image-result').hidden = true;
    save.disabled = true;
    submit.disabled = false;
    status();
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  }

  form.addEventListener('input', () => {
    updateQuality();
    reset();
  });
  updateQuality();
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    reset();
    const current = sequence;
    const source = file.files[0];
    const mime = type.value;
    const level = Number(quality.value) / 100;
    const maxWidth = Number(byId('image-width').value);
    if (!source || !((source.type in formats) || (!source.type && /\.(jpe?g|png|webp)$/i.test(source.name)))) {
      status('Choose a JPG, PNG, or WebP image.', true);
      return;
    }
    if (source.size > 40 * 1024 * 1024) {
      status('Choose an image smaller than 40 MB.', true);
      return;
    }
    submit.disabled = true;
    status('Compressing image…');
    let sourceUrl;
    try {
      sourceUrl = URL.createObjectURL(source);
      const input = new Image();
      input.src = sourceUrl;
      await input.decode();
      if (current !== sequence) return;
      const originalWidth = input.naturalWidth;
      const originalHeight = input.naturalHeight;
      const ratio = Math.min(1, (maxWidth || 8192) / originalWidth, 8192 / originalHeight,
        Math.sqrt(32000000 / originalWidth / originalHeight));
      const width = Math.max(1, Math.floor(originalWidth * ratio));
      const height = Math.max(1, Math.floor(originalHeight * ratio));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (mime === 'image/jpeg') {
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, width, height);
      }
      ctx.drawImage(input, 0, 0, width, height);
      const output = await new Promise((resolve) => canvas.toBlob(resolve, mime, level));
      if (current !== sequence) return;
      if (!output || output.type !== mime) throw new Error('This browser could not export the selected format.');
      result = output;
      resultUrl = URL.createObjectURL(output);
      filename = source.name.replace(/\.[^.]+$/, '') + '-compressed.' + formats[mime];
      byId('image-preview').src = resultUrl;
      const savings = Math.round((1 - output.size / source.size) * 100);
      const comparison = output.size < source.size ? ' · ' + (savings >= 1 ? savings + '% smaller' : 'less than 1% smaller')
        : output.size > source.size ? ' · output is larger' : ' · same file size';
      byId('image-stats').textContent = formatSize(source.size) + ' → ' + formatSize(output.size)
        + comparison + ' · ' + width + ' × ' + height + ' px';
      byId('image-result').hidden = false;
      save.disabled = false;
      status('Image ready to download.');
    } catch (error) {
      if (current === sequence) status(error.message === 'This browser could not export the selected format.'
        ? error.message : 'The image could not be opened or compressed.', true);
    } finally {
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
      if (current === sequence) submit.disabled = false;
    }
  });
  save.addEventListener('click', () => { if (result) download(result, filename); });
}

function passwordTool() {
  const form = byId('password-form');
  const length = byId('password-length');
  const result = byId('password-result');
  const copyButton = byId('copy-password');
  const sets = {
    uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    lowercase: 'abcdefghijklmnopqrstuvwxyz',
    numbers: '0123456789',
    symbols: '!@#$%^&*()_+-=[]{}:,.?~|'
  };
  const sample = new Uint32Array(1);

  function randomIndex(max) {
    const limit = 2 ** 32 - (2 ** 32 % max);
    do { crypto.getRandomValues(sample); } while (sample[0] >= limit);
    return sample[0] % max;
  }

  function generate() {
    if (!globalThis.crypto?.getRandomValues) {
      status('Secure random generation is unavailable in this browser.', true);
      return;
    }
    const exclude = byId('similar').checked;
    const selected = Object.entries(sets)
      .filter(([id]) => byId(id).checked)
      .map(([, chars]) => exclude ? chars.replace(/[01OIoil|]/g, '') : chars);
    if (!selected.length) {
      status('Select at least one character group.', true);
      return;
    }
    const all = selected.join('');
    const chars = selected.map((group) => group[randomIndex(group.length)]);
    while (chars.length < Number(length.value)) chars.push(all[randomIndex(all.length)]);
    for (let i = chars.length - 1; i > 0; i--) {
      const j = randomIndex(i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    result.value = chars.join('');
    copyButton.disabled = false;
    status();
  }

  form.addEventListener('input', () => {
    byId('length-value').value = length.value;
    result.value = '';
    copyButton.disabled = true;
    status();
  });
  form.addEventListener('submit', (event) => { event.preventDefault(); generate(); });
  copyButton.addEventListener('click', () => copy(result.value, 'Password copied.', result));
  generate();
}

function wordTool() {
  const input = byId('word-input');
  const copyButton = byId('copy-text');
  const clearButton = byId('clear-text');
  const segmenter = (granularity) => typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity }) : null;
  const words = segmenter('word');
  const sentences = segmenter('sentence');
  const letters = segmenter('grapheme');

  function lengthOf(value) {
    let count = 0;
    for (const part of letters ? letters.segment(value) : value) count++;
    return count;
  }

  function analysis() {
    const value = input.value;
    let wordCount = 0;
    if (words) {
      for (const part of words.segment(value)) if (part.isWordLike) wordCount++;
    } else {
      wordCount = value.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)?.length ?? 0;
    }
    let sentenceCount = 0;
    const parts = sentences ? sentences.segment(value) : value.split(/[.!?。！？]+/u);
    for (const part of parts) {
      if (/[\p{L}\p{N}]/u.test(part.segment ?? part)) sentenceCount++;
    }
    const duration = Math.ceil(wordCount * 60 / 200);
    const remainder = duration % 60;
    const readingTime = duration < 60 ? duration + ' sec'
      : Math.floor(duration / 60) + ' min' + (remainder ? ' ' + remainder + ' s' : '');
    const metrics = {
      words: wordCount,
      characters: lengthOf(value),
      letters: lengthOf(value.replace(/\s/gu, '')),
      sentences: sentenceCount,
      reading: readingTime
    };
    for (const [id, value] of Object.entries(metrics)) byId('count-' + id).value = value;
    copyButton.disabled = clearButton.disabled = !value.length;
  }

  input.addEventListener('input', () => { analysis(); status(); });
  clearButton.addEventListener('click', () => { input.value = ''; analysis(); input.focus(); status('Text cleared.'); });
  copyButton.addEventListener('click', () => copy(input.value, 'Text copied.', input));
  analysis();
}

function youtubeTool() {
  const form = byId('youtube-form');
  const input = byId('youtube-url');
  const submit = byId('youtube-submit');
  const result = byId('youtube-result');
  const idPattern = /^[A-Za-z0-9_-]{11}$/;
  const candidates = [
    ['maxresdefault', 'Maximum available', 1000],
    ['sddefault', 'Standard', 480],
    ['hqdefault', 'High quality', 480],
    ['mqdefault', 'Medium', 320]
  ];
  let sequence = 0;

  function videoId(value) {
    if (idPattern.test(value)) return value;
    try {
      const url = new URL(/^https?:\/\//i.test(value) ? value : 'https://' + value);
      const path = url.pathname.split('/').filter(Boolean);
      const host = url.hostname.replace(/^(www\.|m\.|music\.)/, '');
      if (host === 'youtu.be') return path[0];
      if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
        if (path[0] === 'watch') return url.searchParams.get('v');
        if (['shorts', 'live', 'embed', 'v'].includes(path[0])) return path[1];
      }
    } catch {}
    return '';
  }

  async function probe(id, [filename, label, minWidth]) {
    const url = 'https://i.ytimg.com/vi/' + id + '/' + filename + '.jpg';
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    img.src = url;
    let timer;
    try {
      await Promise.race([img.decode(), new Promise((_, reject) => {
        timer = setTimeout(reject, 9000);
      })]);
      if (img.naturalWidth < minWidth) return null;
      return { img, url, filename, label };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  form.addEventListener('input', () => {
    sequence++;
    submit.disabled = false;
    result.replaceChildren();
    result.hidden = true;
    status();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const current = ++sequence;
    result.replaceChildren();
    result.hidden = true;
    const id = videoId(input.value.trim());
    if (!idPattern.test(id || '')) {
      status('Enter a supported YouTube video link or a valid 11-character ID.', true);
      return;
    }
    submit.disabled = true;
    status('Checking available thumbnail sizes…');
    const matches = (await Promise.all(candidates.map((candidate) => probe(id, candidate)))).filter(Boolean);
    if (current !== sequence) return;
    submit.disabled = false;
    if (!matches.length) {
      status('No usable thumbnails were found. Check the video link and your connection.', true);
      return;
    }
    matches.sort((a, b) => (b.img.naturalWidth * b.img.naturalHeight) - (a.img.naturalWidth * a.img.naturalHeight));
    for (const { img, url, filename, label } of matches) {
      const card = document.createElement('div');
      card.className = 'result thumb';
      img.alt = label + ' YouTube thumbnail';
      const caption = document.createElement('strong');
      caption.textContent = label + ' · ' + img.naturalWidth + ' × ' + img.naturalHeight + ' px';
      const actions = document.createElement('div');
      actions.className = 'actions';
      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'btn';
      save.textContent = 'Download JPG';
      const open = document.createElement('a');
      open.className = 'btn secondary';
      open.href = url;
      open.target = '_blank';
      open.rel = 'noopener noreferrer';
      open.textContent = 'Open image';
      save.addEventListener('click', async () => {
        save.disabled = true;
        try {
          const response = await fetch(url, { referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(9000) });
          if (!response.ok) throw Error();
          const blob = await response.blob();
          if (current === sequence) download(blob, id + '-' + filename + '.jpg');
        } catch {
          if (current === sequence) status('Use Open image, then save it from the new tab.', true);
        } finally {
          save.disabled = false;
        }
      });
      actions.append(save, open);
      card.append(img, caption, actions);
      result.append(card);
    }
    result.hidden = false;
    status(matches.length === 1 ? '1 thumbnail available.' : matches.length + ' thumbnails available.');
  });
}

function contactForm() {
  const form = byId('contact-form');
  const email = window.TOOLVIBE_CONFIG?.supportEmail;
  const send = byId('contact-send');
  const subject = byId('contact-subject');
  const message = byId('contact-message');
  if (email) {
    byId('contact-notice').textContent = 'Open your email app to send feedback to ' + email + '.';
    send.hidden = false;
    send.addEventListener('click', () => {
      if (!form.reportValidity()) return;
      location.href = 'mailto:' + email + '?subject=' + encodeURIComponent(subject.value)
        + '&body=' + encodeURIComponent(message.value);
    });
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const feedback = 'Subject: ' + subject.value.trim() + '\n\n' + message.value.trim();
    try {
      await navigator.clipboard.writeText(feedback);
      status('Feedback copied.');
    } catch {
      message.focus();
      message.select();
      status('Clipboard access is unavailable. Copy the selected message manually.', true);
    }
  });
}

const setup = {
  'qr-generator': qrTool,
  'image-compressor': imageTool,
  'password-generator': passwordTool,
  'word-counter': wordTool,
  'youtube-thumbnail': youtubeTool
};
if (tool) setup[tool]();
if (byId('contact-form')) contactForm();
