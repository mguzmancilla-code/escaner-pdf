// Generador de PDF mínimo: cada página es una imagen JPEG incrustada tal cual
// (sin recomprimir), así que la calidad depende solo del JPEG de entrada.

export const PAGE_SIZES = {
  a4: { label: 'A4', size: [595.28, 841.89] },
  letter: { label: 'Carta', size: [612, 792] },
  legal: { label: 'Oficio', size: [612, 1008] },
  fit: { label: 'Ajustar a la imagen', size: null },
};

const MARGIN = 28; // ≈ 1 cm

/**
 * @param {{jpeg: Blob, width: number, height: number}[]} pages
 * @param {{pageSize?: string, margins?: boolean, title?: string}} options
 * @returns {Blob}
 */
export function buildPdf(pages, { pageSize = 'a4', margins = false, title = '' } = {}) {
  const encoder = new TextEncoder();
  const parts = [];
  const offsets = [];
  let position = 0;

  const push = (part) => {
    const chunk = typeof part === 'string' ? encoder.encode(part) : part;
    parts.push(chunk);
    position += chunk.size ?? chunk.byteLength;
  };
  const object = (num, body) => {
    offsets[num] = position;
    push(`${num} 0 obj\n${body}\nendobj\n`);
  };

  // Cabecera con comentario binario para que se trate como archivo binario.
  push(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  const kids = pages.map((_, i) => `${4 + 3 * i} 0 R`).join(' ');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  object(3, `<< /Title ${textString(title)} /Creator ${textString('Escáner PDF')} /Producer ${textString('Escáner PDF')} /CreationDate (${pdfDate(new Date())}) >>`);

  pages.forEach((page, i) => {
    const pageNum = 4 + 3 * i;
    const contentNum = pageNum + 1;
    const imageNum = pageNum + 2;
    const [pw, ph] = pageDimensions(page.width, page.height, pageSize);
    const inset = margins ? MARGIN : 0;
    const box = aspectFit(page.width, page.height, inset, inset, pw - 2 * inset, ph - 2 * inset);

    object(
      pageNum,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(pw)} ${n(ph)}] ` +
        `/Resources << /XObject << /Im0 ${imageNum} 0 R >> >> /Contents ${contentNum} 0 R >>`,
    );
    const content = `q ${n(box.w)} 0 0 ${n(box.h)} ${n(box.x)} ${n(box.y)} cm /Im0 Do Q`;
    object(contentNum, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);

    offsets[imageNum] = position;
    push(
      `${imageNum} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.size} >>\nstream\n`,
    );
    push(page.jpeg);
    push('\nendstream\nendobj\n');
  });

  const count = 4 + 3 * pages.length;
  const xrefStart = position;
  let tail = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let k = 1; k < count; k++) tail += `${String(offsets[k]).padStart(10, '0')} 00000 n \n`;
  tail += `trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  push(tail);

  return new Blob(parts, { type: 'application/pdf' });
}

function pageDimensions(width, height, pageSize) {
  const size = PAGE_SIZES[pageSize]?.size;
  if (!size) {
    // El lado largo mide como un A4 para que la página tenga un tamaño físico razonable.
    const f = 841.89 / Math.max(width, height);
    return [width * f, height * f];
  }
  const [a, b] = size;
  return width > height ? [b, a] : [a, b];
}

function aspectFit(w, h, x, y, boxW, boxH) {
  const k = Math.min(boxW / w, boxH / h);
  const fw = w * k;
  const fh = h * k;
  return { x: x + (boxW - fw) / 2, y: y + (boxH - fh) / 2, w: fw, h: fh };
}

const n = (value) => String(Math.round(value * 100) / 100);

/** Cadena de texto PDF en UTF-16BE (admite tildes y ñ). */
function textString(text) {
  let hex = 'FEFF';
  for (let i = 0; i < text.length; i++) hex += text.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  return `<${hex}>`;
}

function pdfDate(d) {
  const p = (v) => String(v).padStart(2, '0');
  return `D:${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
