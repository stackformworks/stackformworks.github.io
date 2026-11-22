(() => {
  'use strict';

  const byId = (id) => document.getElementById(id);
  const htmlCode = byId('html-code');
  const cssCode = byId('css-code');
  const jsCode = byId('js-code');
  const stage = byId('playground-stage');
  const log = byId('playground-log');
  const emptyConsole = byId('console-empty');
  const status = byId('playground-status');
  const tabs = [...document.querySelectorAll('.playground-tabs [role="tab"]')];
  const viewButtons = [...document.querySelectorAll('[data-preview-size]')];
  const levels = new Set(['log', 'info', 'warn', 'error', 'debug', 'ready']);
  const maxConsoleLines = 150;
  let currentFrame;
  let currentRun;
  let logCount = 0;

  // This function is serialized and runs in the opaque-origin preview, never on the host page.
  function previewConsole(run, limit) {
    const post = window.parent.postMessage.bind(window.parent);
    let messageCount = 0;

    function send(level, message) {
      if (level !== 'ready' && messageCount++ > limit) return;
      post({ channel: 'toolvibe-code-playground', run, level, message: message.slice(0, 4000) }, '*');
    }

    function describe(value) {
      if (typeof value === 'string') return value.slice(0, 2000);
      if (value instanceof Error) return value.name + ': ' + value.message;
      if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return String(value);
      if (typeof value === 'bigint') return String(value) + 'n';

      try {
        const seen = new WeakSet();
        return JSON.stringify(value, (_, part) => {
          if (typeof part === 'bigint') return String(part) + 'n';
          if (part && typeof part === 'object') {
            if (seen.has(part)) return '[Circular]';
            seen.add(part);
          }
          return part;
        }) ?? String(value);
      } catch {
        return '[Unserializable value]';
      }
    }

    for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
      const original = console[level].bind(console);
      console[level] = (...args) => {
        original(...args);
        send(level, args.slice(0, 12).map(describe).join(' '));
      };
    }

    window.addEventListener('error', (event) => {
      const where = event.lineno ? ' (line ' + event.lineno + ')' : '';
      send('error', (event.message || 'JavaScript error') + where);
    });
    window.addEventListener('unhandledrejection', (event) => {
      send('error', 'Unhandled promise rejection: ' + describe(event.reason));
    });
    document.addEventListener('DOMContentLoaded', () => send('ready', ''), { once: true });
  }

  function inlineScript(source) {
    return '<script>' + source + '</script>';
  }

  function scriptValue(value) {
    // Keep raw closing tags inside user strings from closing the generated script.
    return JSON.stringify(value).replace(/</g, '\\u003c');
  }

  function addStyle(css) {
    return inlineScript('(() => { const style = document.createElement("style");'
      + ' style.textContent = ' + scriptValue(css) + '; document.head.append(style); })();');
  }

  function addJavaScript(js) {
    return inlineScript('(() => { const script = document.createElement("script");'
      + ' script.textContent = ' + scriptValue(js) + '; document.body.append(script); })();');
  }

  function buildDocument(html, css, js, run) {
    const initialTags = /^(?:\s|<!--[\s\S]*?-->)*(?:<!doctype\b[^>]*>(?:\s|<!--[\s\S]*?-->)*)?(?:<html(?=[\s/>])(?:[^"'<>]|"[^"]*"|'[^']*')*>(?:\s|<!--[\s\S]*?-->)*)?(?:<head(?=[\s/>])(?:[^"'<>]|"[^"]*"|'[^']*')*>)?/i;
    const prefix = html.match(initialTags)[0];
    const docType = /^(?:\s|<!--[\s\S]*?-->)*<!doctype\b/i.test(prefix) ? '' : '<!doctype html>';
    const previewHead = run
      ? '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data: blob:; font-src data:; media-src data: blob:; base-uri \'none\'; form-action \'none\'">'
        + inlineScript('(' + previewConsole.toString() + ')(' + scriptValue(run) + ', ' + maxConsoleLines + ');')
      : '';

    const meta = '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">';
    let content = docType + prefix + previewHead + meta + html.slice(prefix.length);

    if (!css.trim() && !js.trim()) return content;
    const closingTags = /((?:<\/body\s*>\s*)?(?:<\/html\s*>\s*)?)$/i;
    const style = css.trim() ? addStyle(css) : '';
    const script = js.trim() ? addJavaScript(js) : '';
    // At the end of parsing both the implicit and explicit head and body are available.
    content = content.replace(closingTags, (_, tail) => '\n' + style + script + '\n' + tail);
    return content;
  }

  function documentForCurrentCode(run) {
    return buildDocument(htmlCode.value, cssCode.value, jsCode.value, run);
  }

  function clearConsole() {
    log.replaceChildren();
    log.hidden = true;
    emptyConsole.hidden = false;
    logCount = 0;
  }

  function runCode() {
    clearConsole();
    currentRun = crypto.randomUUID();
    const frame = document.createElement('iframe');
    frame.title = 'Code output preview';
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.srcdoc = documentForCurrentCode(currentRun);
    currentFrame = frame;
    status.textContent = 'Running code…';
    stage.replaceChildren(frame);
  }

  function downloadHtml() {
    const url = URL.createObjectURL(new Blob([documentForCurrentCode()], { type: 'text/html;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'toolvibe-playground.html';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    status.textContent = 'HTML file ready to download.';
  }

  window.addEventListener('message', (event) => {
    if (!currentFrame || event.source !== currentFrame.contentWindow || event.origin !== 'null') return;
    const entry = event.data;
    if (entry?.channel !== 'toolvibe-code-playground' || entry.run !== currentRun
      || !levels.has(entry.level) || typeof entry.message !== 'string') return;
    if (entry.level === 'ready') {
      status.textContent = 'Preview ready.';
      return;
    }
    if (logCount > maxConsoleLines) return;

    const item = document.createElement('li');
    item.dataset.level = entry.level;
    item.textContent = logCount === maxConsoleLines
      ? 'Console message limit reached. Run again to reset.'
      : '[' + entry.level + '] ' + entry.message.slice(0, 4000);
    logCount++;
    log.append(item);
    log.hidden = false;
    emptyConsole.hidden = true;
  });

  function openTab(tab, focus = false) {
    for (const item of tabs) {
      const selected = item === tab;
      item.setAttribute('aria-selected', String(selected));
      item.tabIndex = selected ? 0 : -1;
      byId(item.getAttribute('aria-controls')).hidden = !selected;
    }
    if (focus) tab.focus();
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => openTab(tab));
    tab.addEventListener('keydown', (event) => {
      const destinations = {
        ArrowRight: (index + 1) % tabs.length,
        ArrowLeft: (index + tabs.length - 1) % tabs.length,
        Home: 0,
        End: tabs.length - 1
      };
      if (!Object.hasOwn(destinations, event.key)) return;
      event.preventDefault();
      openTab(tabs[destinations[event.key]], true);
    });
  });
  viewButtons.forEach((button) => button.addEventListener('click', () => {
    stage.dataset.size = button.dataset.previewSize;
    for (const other of viewButtons) other.setAttribute('aria-pressed', String(button === other));
  }));
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.repeat) {
      event.preventDefault();
      runCode();
    }
  });
  byId('run-playground').addEventListener('click', runCode);
  byId('download-playground').addEventListener('click', downloadHtml);
  byId('clear-playground-console').addEventListener('click', clearConsole);

  htmlCode.value = '<main>\n  <h1>Hello, ToolVibe!</h1>\n  <button id="example">Click me</button>\n</main>';
  cssCode.value = 'body {\n  background: #edf6ef;\n  color: #173828;\n  font-family: system-ui, sans-serif;\n  padding: 2rem;\n}\n\nbutton {\n  background: #126749;\n  color: white;\n  border: 0;\n  border-radius: .5rem;\n  padding: .65rem 1rem;\n  cursor: pointer;\n}';
  jsCode.value = 'const button = document.querySelector("#example");\n\nbutton.addEventListener("click", () => {\n  button.textContent = "It works!";\n  console.log("Preview button clicked.");\n});';
  runCode();
})();
