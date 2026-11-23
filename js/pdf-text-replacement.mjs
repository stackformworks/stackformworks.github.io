const latin1 = new TextDecoder('iso-8859-1');
const pdfName = (name) => PDFLib.PDFName.of(name);

function readTokens(source) {
  const token = /[\x00\t\n\f\r ]+|%[^\r\n]*|<<|>>|\[|\]|\(|<[^<>]*>|\/[^\x00\t\n\f\r ()<>\[\]{}\/%]*|[^\x00\t\n\f\r ()<>\[\]{}\/%]+|[{}]/y;
  let cursor = 0;
  function read(end, depth = 0) {
    if (depth > 20) throw new Error('Nested PDF operands.');
    const tokens = [];
    while (cursor < source.length) {
      token.lastIndex = cursor;
      const start = cursor;
      const match = token.exec(source);
      if (!match) throw new Error('Unsupported PDF operand.');
      const value = match[0];
      cursor = token.lastIndex;
      if (value === end) return tokens;
      if (/^[\x00\t\n\f\r %]/.test(value)) continue;
      let operand = { type: 'word', value };
      if (value === 'BI' && depth === 0) throw new Error('Inline image in PDF stream.');
      if (value === '(') {
        let nesting = 1;
        while (cursor < source.length && nesting) {
          const char = source[cursor++];
          if (char === '\\') cursor++;
          else if (char === '(') nesting++;
          else if (char === ')') nesting--;
        }
        if (nesting) throw new Error('Unclosed PDF string.');
        const literal = source.slice(start + 1, cursor - 1)
          .replace(/\\(\r\n|\n|\r)|\r\n?/g, (newline) => newline[0] === '\\' ? '' : '\n');
        operand = { type: 'string', value: PDFLib.PDFString.of(literal).asBytes() };
      } else if (value === '[' || value === '<<') {
        operand = { type: value === '[' ? 'array' : 'dict', value: read(value === '[' ? ']' : '>>', depth + 1) };
      } else if (value === ']' || value === '>>') {
        throw new Error('Unexpected PDF closing delimiter.');
      } else if (value[0] === '<') {
        if (!/^<[\da-f\x00\t\n\f\r ]*>$/i.test(value)) throw new Error('Invalid PDF hex string.');
        operand = { type: 'string', value: PDFLib.PDFHexString.of(value.slice(1, -1).replace(/\s|\x00/g, '')).asBytes() };
      } else if (value[0] === '/') {
        operand = { type: 'name', value: PDFLib.PDFName.of(value.slice(1)).decodeText() };
      } else if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(value)) {
        operand = { type: 'number', value: Number(value) };
      }
      tokens.push({ ...operand, start, end: cursor });
    }
    if (end) throw new Error('Unclosed PDF operand.');
    return tokens;
  }
  return read();
}

function readStream(stream) {
  // Keep every byte at its original offset when splicing content operators.
  const bytes = PDFLib.decodePDFRawStream(stream).decode();
  return Array.from({ length: Math.ceil(bytes.length / 8192) }, (_, i) =>
    String.fromCharCode(...bytes.subarray(i * 8192, (i + 1) * 8192))
  ).join('');
}

function points(bytes, size) {
  if (bytes.length % size) throw new Error('Invalid glyph encoding.');
  return Array.from({ length: bytes.length / size }, (_, i) =>
    size === 1 ? bytes[i] : (bytes[i * 2] << 8) | bytes[i * 2 + 1]
  );
}

function unicodeString(bytes) {
  return String.fromCharCode(...points(bytes, 2));
}

function identityMap(font) {
  const cmap = font.lookup(pdfName('ToUnicode'));
  if (!(cmap instanceof PDFLib.PDFRawStream)) return new Map();
  const tokens = readTokens(readStream(cmap));
  const result = new Map();
  for (let i = 0; i < tokens.length; i++) {
    const section = tokens[i].value;
    if (section !== 'beginbfchar' && section !== 'beginbfrange') continue;
    const count = tokens[i - 1]?.value;
    if (!Number.isInteger(count) || count < 0 || count > 65536) return new Map();
    for (let entry = 0; entry < count; entry++) {
      const first = tokens[++i];
      if (first?.type !== 'string' || first.value.length !== 2) return new Map();
      const from = points(first.value, 2)[0];
      if (section === 'beginbfchar') {
        const dest = tokens[++i];
        if (dest?.type !== 'string') return new Map();
        if (dest.value.length <= 32 && dest.value.length % 2 === 0) result.set(from, unicodeString(dest.value));
        continue;
      }
      const last = tokens[++i];
      if (last?.type !== 'string' || last.value.length !== 2) return new Map();
      const to = points(last.value, 2)[0];
      const dest = tokens[++i];
      if (dest?.type === 'array' && dest.value.length === to - from + 1) {
        for (let code = from; code <= to; code++) {
          const glyph = dest.value[code - from];
          if (glyph.type !== 'string') return new Map();
          if (glyph.value.length <= 32 && glyph.value.length % 2 === 0) result.set(code, unicodeString(glyph.value));
        }
      } else if (dest?.type === 'string') {
        if (dest.value.length !== 2) continue;
        const base = points(dest.value, 2)[0];
        if (base + to - from > 65535) return new Map();
        for (let code = from; code <= to; code++) result.set(code, String.fromCharCode(base + code - from));
      } else return new Map();
    }
  }
  return result;
}

function fontData(font) {
  const { PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream, StandardFontEmbedder, StandardFonts } = PDFLib;
  if (!(font instanceof PDFDict)) return;
  const name = (dict, key) => dict.lookupMaybe(pdfName(key), PDFName)?.decodeText();
  const number = (dict, key) => dict.lookupMaybe(pdfName(key), PDFNumber)?.asNumber();
  const subtype = name(font, 'Subtype');
  let width;
  let glyphs;
  let size = 1;
  let available = () => true;

  if (subtype === 'Type0' && name(font, 'Encoding') === 'Identity-H') {
    size = 2;
    const descendant = font.lookupMaybe(pdfName('DescendantFonts'), PDFArray)?.lookupMaybe(0, PDFDict);
    if (!descendant || name(descendant, 'Subtype') !== 'CIDFontType2') return;
    glyphs = identityMap(font);
    const widths = descendant.lookupMaybe(pdfName('W'), PDFArray);
    const ranges = new Map();
    for (let i = 0; widths && i < widths.size();) {
      const from = widths.lookup(i++, PDFNumber).asNumber();
      const next = widths.lookup(i++);
      if (next instanceof PDFArray) {
        for (let offset = 0; offset < next.size(); offset++) {
          ranges.set(from + offset, next.lookup(offset, PDFNumber).asNumber());
        }
      } else if (next instanceof PDFNumber) {
        const to = next.asNumber();
        const value = widths.lookup(i++, PDFNumber).asNumber();
        if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > 65535) return;
        for (let code = from; code <= to; code++) ranges.set(code, value);
      } else return;
    }
    const defaultWidth = number(descendant, 'DW') ?? 1000;
    width = (code) => ranges.get(code) ?? defaultWidth;
    const toGlyph = descendant.lookup(pdfName('CIDToGIDMap'));
    if (toGlyph instanceof PDFRawStream) {
      const map = PDFLib.decodePDFRawStream(toGlyph).decode();
      available = (code) => !!(map[code * 2] || map[code * 2 + 1]);
    } else if (!toGlyph || (toGlyph instanceof PDFName && toGlyph.decodeText() === 'Identity')) {
      // With an identity map, use glyphs explicitly listed in the font's widths.
      available = (code) => code > 0 && ranges.has(code);
    } else return;
  } else if (subtype === 'Type1' || subtype === 'TrueType') {
    const encoding = font.lookup(pdfName('Encoding'));
    if (encoding && !(encoding instanceof PDFName)) return;
    const encodingName = encoding?.decodeText();
    const base = name(font, 'BaseFont');
    const standard = Object.values(StandardFonts).includes(base) && base !== 'Symbol' && base !== 'ZapfDingbats';
    if (encodingName !== 'WinAnsiEncoding' && !(standard && (!encodingName || encodingName === 'StandardEncoding'))) return;
    // A custom Unicode map may assign a different character to the same byte.
    if (font.has(pdfName('ToUnicode')) && !standard) return;
    glyphs = new Map();
    const winAnsi = encodingName === 'WinAnsiEncoding';
    for (let code = 32; code <= (winAnsi ? 255 : 126); code++) {
      if (code === 127 || [129, 141, 143, 144, 157, 160, 173].includes(code)) continue;
      const char = winAnsi ? latin1.decode(Uint8Array.of(code)) : String.fromCharCode(code);
      glyphs.set(code, char);
    }
    if (!winAnsi) {
      glyphs.set(39, '’');
      glyphs.set(96, '‘');
      glyphs.set(169, "'");
    }
    const widths = font.lookupMaybe(pdfName('Widths'), PDFArray);
    const first = number(font, 'FirstChar');
    if (widths && Number.isInteger(first)) {
      width = (code) => widths.lookupMaybe(code - first, PDFNumber)?.asNumber();
    } else if (standard) {
      const metrics = StandardFontEmbedder.for(base);
      width = (code) => {
        try { return metrics.widthOfTextAtSize(glyphs.get(code), 1000); }
        catch { return undefined; }
      };
    } else return;
  } else return;

  const encoding = new Map();
  for (const [code, char] of glyphs) {
    if ([...char].length === 1 && available(code) && !encoding.has(char)) encoding.set(char, code);
  }
  return { size, glyphs, width, encoding };
}

function pageContent(document, page) {
  const { PDFArray, PDFDict, PDFRawStream } = PDFLib;
  const contents = page.node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray() : [page.node.get(pdfName('Contents'))];
  const fonts = page.node.Resources()?.lookupMaybe(pdfName('Font'), PDFDict);
  const fontCache = new Map();
  const stack = [];
  let graphics = { font: undefined, size: 0, charSpacing: 0, wordSpacing: 0, stretch: 100, render: 0 };
  let inText = false;
  const markedContent = [];
  const properties = page.node.Resources()?.lookupMaybe(pdfName('Properties'), PDFDict);
  const candidates = [];

  const sources = streams.map((ref, index) => {
    const stream = document.context.lookup(ref);
    if (!(stream instanceof PDFRawStream)) throw new Error('Unsupported PDF content stream.');
    const content = readStream(stream);
    let args = [];
    for (const token of readTokens(content)) {
      if (token.type !== 'word') {
        args.push(token);
        continue;
      }
      const value = args[0]?.value;
      const operator = token.value;
      switch (operator) {
        case 'q': stack.push({ ...graphics }); break;
        case 'Q': graphics = stack.pop() ?? graphics; break;
        case 'BT': inText = true; break;
        case 'ET': inText = false; break;
        case 'BMC': markedContent.push(false); break;
        case 'BDC': {
          const details = args[1];
          const actualText = details?.type === 'dict'
            ? details.value.some((entry) => entry.type === 'name' && entry.value === 'ActualText')
            : details?.type === 'name' && properties?.lookupMaybe(pdfName(details.value), PDFDict)?.has(pdfName('ActualText'));
          markedContent.push(actualText);
          break;
        }
        case 'EMC': markedContent.pop(); break;
        case 'Tf': {
          if (!fontCache.has(value)) {
            try { fontCache.set(value, fontData(fonts?.lookup(pdfName(value)))); }
            catch { fontCache.set(value, undefined); }
          }
          graphics.font = fontCache.get(value);
          graphics.size = args[1]?.value;
          break;
        }
        case 'Tc': graphics.charSpacing = value; break;
        case 'Tw': graphics.wordSpacing = value; break;
        case 'Tr': graphics.render = value; break;
        case 'Tz': graphics.stretch = value; break;
        case 'gs':
          // ExtGState can select a font. Require a later explicit Tf.
          graphics.font = undefined;
          break;
        case 'Tj': case 'TJ': {
          const { font, size, render, stretch, charSpacing, wordSpacing } = graphics;
          if (!inText || markedContent.some(Boolean) || !font || !(size > 0) || !(stretch > 0) ||
            render < 0 || render > 2 || charSpacing !== 0 || wordSpacing !== 0 || args.length !== 1) break;
          const segments = operator === 'Tj' && args[0].type === 'string' ? args :
            operator === 'TJ' && args[0].type === 'array' ? value : [];
          let original = '';
          let advance = 0;
          for (const segment of segments) {
            if (segment.type === 'number') {
              advance -= segment.value;
              continue;
            }
            if (segment.type !== 'string') {
              advance = NaN;
              break;
            }
            for (const code of points(segment.value, font.size)) {
              const char = font.glyphs.get(code);
              advance += font.width(code) ?? NaN;
              if (!char) advance = NaN;
              original += char ?? '';
            }
          }
          if (original.trim() && Number.isFinite(advance) && advance > 0) {
            candidates.push({ id: candidates.length, index, start: args[0].start, end: token.end, original, advance, font, stretch });
          }
          break;
        }
        // The double-quote text operator also sets text spacing.
        case '"':
          graphics.wordSpacing = args[0]?.value;
          graphics.charSpacing = args[1]?.value;
          break;
      }
      args = [];
    }
    if (args.length) throw new Error('PDF operands span multiple streams.');
    return { ref, content, index };
  });
  return { candidates, sources };
}

export function findEditableText(document, page) {
  try {
    return pageContent(document, page).candidates;
  } catch {
    return [];
  }
}

function replacementOperator(candidate, text) {
  const { font, advance, stretch } = candidate;
  const bytes = [];
  let width = 0;
  for (const char of text) {
    const code = font.encoding.get(char);
    const glyphWidth = code === undefined ? undefined : font.width(code);
    if (!Number.isFinite(glyphWidth) || glyphWidth < 0) {
      throw new Error('The original font does not contain every character in your replacement.');
    }
    if (font.size === 2) bytes.push(code >> 8);
    bytes.push(code & 255);
    width += glyphWidth;
  }
  const encoded = '<' + bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('') + '>';
  const decimal = (number) => Number(number.toFixed(8)).toString();
  if (width > advance) {
    // Fit longer text into the original advance and restore the next run's scale.
    if (advance / width < 0.65) throw new Error('The replacement is too long for the original space.');
    return decimal(stretch * advance / width) + ' Tz ' + encoded + ' Tj ' + decimal(stretch) + ' Tz';
  }
  return '[' + encoded + ' ' + decimal(width - advance) + '] TJ';
}

export function applyTextReplacements(document, items) {
  const { PDFArray, PDFDict, PDFRef, PDFStream } = PDFLib;
  const retired = new Set();
  const pages = document.getPages();
  for (const item of items) {
    if (!item.replacements?.length) continue;
    const page = pages[item.number - 1];
    const { candidates, sources } = pageContent(document, page);
    const edits = item.replacements.map(({ id, original, value }) => {
      const candidate = candidates[id];
      if (!candidate || candidate.original !== original) throw new Error('The original text run could not be located.');
      return { ...candidate, operator: replacementOperator(candidate, value) };
    });
    let changed = false;
    const refs = sources.map(({ ref, content, index }) => {
      const replacements = edits.filter((edit) => edit.index === index).sort((a, b) => b.start - a.start);
      if (!replacements.length) return ref;
      for (const edit of replacements) {
        content = content.slice(0, edit.start) + edit.operator + content.slice(edit.end);
      }
      changed = true;
      if (ref instanceof PDFRef) retired.add(ref);
      return document.context.register(document.context.flateStream(content));
    });
    if (changed) {
      const previous = page.node.get(pdfName('Contents'));
      if (previous instanceof PDFRef) retired.add(previous);
      page.node.set(pdfName('Contents'), document.context.obj(refs));
    }
  }

  // Remove superseded streams when no other page or object shares them.
  if (!retired.size) return;
  const seen = new Set();
  function retain(object) {
    if (object instanceof PDFRef) {
      if (retired.delete(object)) retain(document.context.lookup(object));
      return;
    }
    if (!object || seen.has(object)) return;
    seen.add(object);
    if (object instanceof PDFDict) {
      for (const [, value] of object.entries()) retain(value);
    } else if (object instanceof PDFArray) {
      for (const value of object.asArray()) retain(value);
    } else if (object instanceof PDFStream) retain(object.dict);
  }
  const objects = document.context.enumerateIndirectObjects();
  for (const [ref, object] of objects) {
    if (!retired.has(ref)) retain(object);
  }
  for (const ref of retired) document.context.delete(ref);
}
