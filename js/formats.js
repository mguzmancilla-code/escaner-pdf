// Conversión de PDF a formatos de lectura: texto (.txt), RTF, HTML y ePub.
// Recibe el texto ya extraído por página (y, si se pide, las páginas como
// imagen JPEG) y arma el archivo en el navegador, sin servidores.
//
// pages: [{ lines: string[], image?: Blob, heading?: string }] — una entrada por página
// (heading reemplaza al título «Página n», p. ej. «Texto reconocido»).

const enc = new TextEncoder();

const xmlEscape = (s) =>
  String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);

/**
 * Une líneas en párrafos: una línea termina el párrafo si cierra con punto
 * (u otro signo final), si es claramente más corta que las demás o si la
 * siguiente parece una viñeta o un título numerado.
 */
export function toParagraphs(lines) {
  const largo = Math.max(1, ...lines.map((l) => l.length));
  const parrafos = [];
  let actual = '';
  for (const [i, raw] of lines.entries()) {
    const linea = raw.trim();
    if (!linea) {
      if (actual) parrafos.push(actual);
      actual = '';
      continue;
    }
    actual = actual ? (actual.endsWith('-') ? actual.slice(0, -1) + linea : `${actual} ${linea}`) : linea;
    const siguiente = lines[i + 1]?.trim() ?? '';
    const cierra = /[.!?:;»"”)]$/.test(linea) || linea.length < largo * 0.6;
    const vineta = /^([-•·*–]|\d+[.)]|[a-z][.)]|[IVX]+\.)\s/i.test(siguiente);
    if (cierra || vineta || !siguiente) {
      parrafos.push(actual);
      actual = '';
    }
  }
  if (actual) parrafos.push(actual);
  return parrafos;
}

// ---------------------------------------------------------------------------
// Texto (.txt)
// ---------------------------------------------------------------------------

export function toTxt(pages) {
  const texto = pages
    .map((p) => p.lines.join('\r\n').trim())
    .filter(Boolean)
    .join('\r\n\r\n');
  // BOM para que el Bloc de notas reconozca los acentos (UTF-8).
  return new Blob(['﻿', texto], { type: 'text/plain;charset=utf-8' });
}

// ---------------------------------------------------------------------------
// RTF (se abre en Word, WordPad, LibreOffice, Pages…)
// ---------------------------------------------------------------------------

function rtfEscape(s) {
  let out = '';
  for (const ch of String(s)) {
    const code = ch.codePointAt(0);
    if (ch === '\\' || ch === '{' || ch === '}') out += `\\${ch}`;
    else if (code < 128) out += ch;
    else if (code <= 0xffff) out += `\\u${code > 32767 ? code - 65536 : code}?`;
    else {
      // Fuera del plano básico (p. ej. emojis): par sustituto UTF-16.
      const hi = 0xd800 + ((code - 0x10000) >> 10);
      const lo = 0xdc00 + ((code - 0x10000) & 0x3ff);
      out += `\\u${hi - 65536}?\\u${lo - 65536}?`;
    }
  }
  return out;
}

export function toRtf(pages, title = '') {
  const cuerpo = pages
    .map((p) =>
      toParagraphs(p.lines)
        .map((par) => `{\\pard\\sa160\\sl276\\slmult1 ${rtfEscape(par)}\\par}`)
        .join('\n'),
    )
    .filter(Boolean)
    .join('\n\\page\n');
  const rtf =
    '{\\rtf1\\ansi\\ansicpg1252\\deff0\\uc1\n' +
    '{\\fonttbl{\\f0\\fswiss\\fcharset0 Calibri;}}\n' +
    `{\\info{\\title ${rtfEscape(title)}}{\\author AgneScan}}\n` +
    '\\paperw11906\\paperh16838\\margl1134\\margr1134\\margt1134\\margb1134\n' +
    `\\f0\\fs22\n${cuerpo}\n}`;
  return new Blob([rtf], { type: 'application/rtf' });
}

// ---------------------------------------------------------------------------
// HTML (un solo archivo, con las imágenes incrustadas)
// ---------------------------------------------------------------------------

const blobToDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

const READING_CSS = `
  :root { color-scheme: light dark; --bg: #fff; --text: #1d1d1f; --muted: #6e6e73; --line: #e5e5ea; --accent: #1a66e0; }
  @media (prefers-color-scheme: dark) { :root { --bg: #111; --text: #f2f2f7; --muted: #a1a1a6; --line: #2c2c2e; --accent: #3b86f7; } }
  body { margin: 0; background: var(--bg); color: var(--text); font: 17px/1.6 Georgia, "Times New Roman", serif; }
  main { max-width: 760px; margin: 0 auto; padding: 32px 20px 64px; }
  h1 { font: 600 28px/1.25 system-ui, sans-serif; margin: 0 0 4px; }
  .meta { color: var(--muted); font: 14px system-ui, sans-serif; margin: 0 0 32px; }
  section { border-top: 1px solid var(--line); padding: 24px 0; }
  h2 { font: 600 13px system-ui, sans-serif; letter-spacing: .06em; text-transform: uppercase; color: var(--accent); margin: 0 0 12px; }
  p { margin: 0 0 1em; }
  img { display: block; max-width: 100%; height: auto; margin: 0 auto 16px; border: 1px solid var(--line); border-radius: 4px; }
`;

export async function toHtml(pages, { title = 'Documento', onPage } = {}) {
  const secciones = [];
  for (const [i, p] of pages.entries()) {
    const partes = [`<h2>${xmlEscape(p.heading ?? `Página ${i + 1}`)}</h2>`];
    if (p.image) partes.push(`<img src="${await blobToDataUrl(p.image)}" alt="Página ${i + 1}">`);
    for (const par of toParagraphs(p.lines)) partes.push(`<p>${xmlEscape(par)}</p>`);
    secciones.push(`<section id="p${i + 1}">\n${partes.join('\n')}\n</section>`);
    onPage?.(i + 1, pages.length);
  }
  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="AgneScan">
<title>${xmlEscape(title)}</title>
<style>${READING_CSS}</style>
</head>
<body>
<main>
<h1>${xmlEscape(title)}</h1>
<p class="meta">Convertido con AgneScan</p>
${secciones.join('\n')}
</main>
</body>
</html>`;
  return new Blob([html], { type: 'text/html;charset=utf-8' });
}

// ---------------------------------------------------------------------------
// ePub 3 (libros electrónicos: Apple Libros, Google Play Libros, Kobo, Calibre…)
// ---------------------------------------------------------------------------

export async function toEpub(pages, { title = 'Documento', onPage } = {}) {
  const { zipSync } = await import('./vendor/fflate.js');
  const id = `urn:uuid:${crypto.randomUUID()}`;
  const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const t = xmlEscape(title);

  // El archivo «mimetype» debe ir primero y sin comprimir (lo exige el estándar).
  const files = { mimetype: [enc.encode('application/epub+zip'), { level: 0 }] };
  files['META-INF/container.xml'] = enc.encode(`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);
  files['OEBPS/estilo.css'] = enc.encode(
    'body { font-family: serif; line-height: 1.5; margin: 0 4%; }\n' +
      'h2 { font-family: sans-serif; font-size: .8em; letter-spacing: .06em; text-transform: uppercase; color: #1a66e0; }\n' +
      'p { margin: 0 0 .8em; text-indent: 0; }\n' +
      'img { display: block; max-width: 100%; height: auto; margin: 0 auto 1em; }\n',
  );

  const manifest = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
    '<item id="css" href="estilo.css" media-type="text/css"/>',
  ];
  const spine = [];
  const navItems = [];
  const ncxItems = [];

  for (const [i, p] of pages.entries()) {
    const n = i + 1;
    const etiqueta = xmlEscape(p.heading ?? `Página ${n}`);
    const cuerpo = [`<h2>${etiqueta}</h2>`];
    if (p.image) {
      const href = `imagenes/p${n}.jpg`;
      files[`OEBPS/${href}`] = [new Uint8Array(await p.image.arrayBuffer()), { level: 0 }];
      manifest.push(`<item id="img${n}" href="${href}" media-type="image/jpeg"${n === 1 ? ' properties="cover-image"' : ''}/>`);
      cuerpo.push(`<img src="${href}" alt="Página ${n}"/>`);
    }
    for (const par of toParagraphs(p.lines)) cuerpo.push(`<p>${xmlEscape(par)}</p>`);
    files[`OEBPS/p${n}.xhtml`] = enc.encode(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="es" lang="es">
<head><meta charset="utf-8"/><title>${t} · ${etiqueta}</title><link rel="stylesheet" type="text/css" href="estilo.css"/></head>
<body>
${cuerpo.join('\n')}
</body>
</html>`);
    manifest.push(`<item id="p${n}" href="p${n}.xhtml" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="p${n}"/>`);
    navItems.push(`<li><a href="p${n}.xhtml">${etiqueta}</a></li>`);
    ncxItems.push(`<navPoint id="np${n}" playOrder="${n}"><navLabel><text>${etiqueta}</text></navLabel><content src="p${n}.xhtml"/></navPoint>`);
    onPage?.(n, pages.length);
  }

  files['OEBPS/nav.xhtml'] = enc.encode(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="es" lang="es">
<head><meta charset="utf-8"/><title>${t}</title></head>
<body><nav epub:type="toc" id="toc"><h1>${t}</h1><ol>${navItems.join('')}</ol></nav></body>
</html>`);
  // Índice en formato antiguo (EPUB 2) para lectores que no entienden nav.xhtml.
  files['OEBPS/toc.ncx'] = enc.encode(`<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="${id}"/></head>
<docTitle><text>${t}</text></docTitle>
<navMap>${ncxItems.join('')}</navMap>
</ncx>`);
  files['OEBPS/content.opf'] = enc.encode(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="es">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">${id}</dc:identifier>
    <dc:title>${t}</dc:title>
    <dc:language>es</dc:language>
    <dc:creator>AgneScan</dc:creator>
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    ${manifest.join('\n    ')}
  </manifest>
  <spine toc="ncx">
    ${spine.join('\n    ')}
  </spine>
</package>`);

  return new Blob([zipSync(files, { level: 6 })], { type: 'application/epub+zip' });
}
