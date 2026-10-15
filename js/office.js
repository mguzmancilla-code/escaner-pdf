// Generación de archivos de Office (Word, Excel, PowerPoint) en el navegador.
// Los formatos .docx/.xlsx/.pptx son carpetas ZIP con archivos XML (OOXML);
// se arman a mano con fflate. La conversión desde PDF tiene límites:
//   - Word/Excel: se traslada el TEXTO (editable), sin conservar el diseño.
//   - PowerPoint: cada página va como imagen (fiel, pero no editable).

const enc = new TextEncoder();
const xmlEscape = (s) =>
  String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);

async function zipFiles(files) {
  const { zipSync } = await import('./vendor/fflate.js');
  const data = {};
  for (const [name, content] of Object.entries(files)) {
    data[name] = typeof content === 'string' ? enc.encode(content) : content;
  }
  return zipSync(data, { level: 6 });
}

const CT_OVERRIDE = (part, type) => `<Override PartName="${part}" ContentType="${type}"/>`;

// ---------------------------------------------------------------------------
// Word (.docx) con el texto
// ---------------------------------------------------------------------------

export async function textToDocx(paragraphs) {
  const body = paragraphs
    .map((p) => {
      const runs = xmlEscape(p || '');
      return `<w:p><w:r><w:t xml:space="preserve">${runs}</w:t></w:r></w:p>`;
    })
    .join('');
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`;

  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
${CT_OVERRIDE('/word/document.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml')}
</Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
    'word/document.xml': document,
  };
  return new Blob([await zipFiles(files)], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}

// ---------------------------------------------------------------------------
// Excel (.xlsx) con el texto por filas (una celda por línea)
// ---------------------------------------------------------------------------

export async function rowsToXlsx(rows) {
  const sheetRows = rows
    .map((celdas, r) => {
      const cols = celdas
        .map((val, c) => {
          const ref = `${colLetter(c)}${r + 1}`;
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(val ?? '')}</t></is></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${cols}</row>`;
    })
    .join('');
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`;

  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
${CT_OVERRIDE('/xl/workbook.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml')}
${CT_OVERRIDE('/xl/worksheets/sheet1.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml')}
</Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Hoja1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`,
    'xl/worksheets/sheet1.xml': sheet,
  };
  return new Blob([await zipFiles(files)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

function colLetter(n) {
  let s = '';
  n += 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// ---------------------------------------------------------------------------
// PowerPoint (.pptx) con una imagen por diapositiva (fiel)
// ---------------------------------------------------------------------------

const EMU = 914400; // EMU por pulgada; el PDF está en puntos (1/72")

export async function imagesToPptx(images) {
  // Tamaño de la presentación según la primera página (en EMU, a 72 ppp).
  const first = images[0];
  const slideW = Math.round((first.width / 72) * EMU);
  const slideH = Math.round((first.height / 72) * EMU);

  const files = {};
  const slideRefs = [];
  const slideIdList = [];
  const ctOverrides = [];

  images.forEach((img, i) => {
    const n = i + 1;
    const w = Math.round((img.width / 72) * EMU);
    const h = Math.round((img.height / 72) * EMU);
    files[`ppt/media/image${n}.${img.ext}`] = img.bytes;
    files[`ppt/slides/slide${n}.xml`] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
<p:pic><p:nvPicPr><p:cNvPr id="2" name="Pagina ${n}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
<p:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>
</p:spTree></p:cSld><p:clrMapOvr><a:overrideClrMapping/></p:clrMapOvr></p:sld>`;
    files[`ppt/slides/_rels/slide${n}.xml.rels`] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${n}.${img.ext}"/>
</Relationships>`;
    slideRefs.push(`<Relationship Id="rIdS${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${n}.xml"/>`);
    slideIdList.push(`<p:sldId id="${255 + n}" r:id="rIdS${n}"/>`);
    ctOverrides.push(CT_OVERRIDE(`/ppt/slides/slide${n}.xml`, 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml'));
  });

  const exts = [...new Set(images.map((i) => i.ext))];
  const defaults = exts
    .map((e) => `<Default Extension="${e}" ContentType="image/${e === 'jpg' ? 'jpeg' : e}"/>`)
    .join('');

  files['[Content_Types].xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>${defaults}
${CT_OVERRIDE('/ppt/presentation.xml', 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml')}
${ctOverrides.join('')}
</Types>`;
  files['_rels/.rels'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`;
  files['ppt/presentation.xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<p:sldIdLst>${slideIdList.join('')}</p:sldIdLst><p:sldSz cx="${slideW}" cy="${slideH}"/><p:notesSz cx="${slideH}" cy="${slideW}"/></p:presentation>`;
  files['ppt/_rels/presentation.xml.rels'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${slideRefs.join('')}</Relationships>`;

  return new Blob([await zipFiles(files)], {
    type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  });
}
