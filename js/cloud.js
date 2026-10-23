// Biblioteca en la nube (Supabase): carpetas, documentos y archivos del bucket privado.
// Rutas en Storage: {user_id}/{documento_id}/v{n}.pdf y {user_id}/{documento_id}/miniatura.jpg

import { getUser, supabase } from './auth.js';
import { SUPABASE_KEY, SUPABASE_URL } from './config.js';

const BUCKET = 'documentos';
const storage = () => supabase.storage.from(BUCKET);

function requireUser() {
  const user = getUser();
  if (!user) throw new Error('Inicia sesión para usar la nube.');
  return user;
}

/** Lanza un error con un mensaje claro en español. */
function check(error, fallback) {
  if (!error) return;
  const messages = {
    23505: 'Ya existe una carpeta con ese nombre en este lugar.',
    23514: 'El nombre no es válido.',
    P0001: error.message, // mensajes propios de la base de datos, ya en español
  };
  if (messages[error.code]) throw new Error(messages[error.code]);
  if (error instanceof TypeError || /fetch|network/i.test(error.message ?? '')) {
    throw new Error('Sin conexión a internet.');
  }
  throw new Error(`${fallback}: ${error.message ?? 'error desconocido'}`);
}

// -----------------------------------------------------------------------------
// Carpetas
// -----------------------------------------------------------------------------

export async function fetchFolders() {
  const { data, error } = await supabase
    .from('carpetas')
    .select('id, nombre, carpeta_padre_id')
    .order('nombre');
  check(error, 'No se pudieron cargar las carpetas');
  return data;
}

export async function createFolder(nombre, carpetaPadreId) {
  requireUser();
  const { data, error } = await supabase
    .from('carpetas')
    .insert({ nombre, carpeta_padre_id: carpetaPadreId ?? null })
    .select('id, nombre, carpeta_padre_id')
    .single();
  check(error, 'No se pudo crear la carpeta');
  return data;
}

export async function renameFolder(id, nombre) {
  const { error } = await supabase.from('carpetas').update({ nombre }).eq('id', id);
  check(error, 'No se pudo renombrar la carpeta');
}

/** Borra la carpeta y sus subcarpetas; los documentos pasan a la raíz. */
export async function deleteFolder(id) {
  const { error } = await supabase.from('carpetas').delete().eq('id', id);
  check(error, 'No se pudo eliminar la carpeta');
}

// -----------------------------------------------------------------------------
// Documentos
// -----------------------------------------------------------------------------

const DOC_COLS =
  'id, nombre, carpeta_id, origen, estado_ocr, paginas, version_actual, miniatura_path, created_at, ' +
  'documento_versiones (numero, storage_path, tamano_bytes)';

// Si la columna «favorito» aún no existe (migración pendiente), se sigue sin ella.
let hasFavorito = true;

export async function fetchDocuments() {
  const consulta = (cols) =>
    supabase.from('documentos').select(cols).order('created_at', { ascending: false });
  let { data, error } = await consulta(hasFavorito ? `${DOC_COLS}, favorito` : DOC_COLS);
  if (error && hasFavorito && /favorito/.test(error.message ?? '')) {
    hasFavorito = false;
    ({ data, error } = await consulta(DOC_COLS));
  }
  check(error, 'No se pudieron cargar los documentos');
  return data.map((row) => {
    const versions = row.documento_versiones ?? [];
    const current = versions.find((v) => v.numero === row.version_actual) ?? versions[0] ?? null;
    return { ...row, version: current };
  });
}

async function putFile(path, blob, contentType) {
  const { error } = await storage().upload(path, blob, { contentType, upsert: false });
  // Si ya existe (un reintento tras un corte), se da por subido: los archivos no se sobrescriben.
  if (error && !(String(error.statusCode) === '409' || /exists|duplicate/i.test(error.message))) {
    check(error, 'No se pudo subir el archivo');
  }
}

/**
 * Sube un PDF local como versión 1 de un documento nuevo. Se puede repetir sin
 * problemas si una subida anterior quedó a medias.
 * @returns {{ remotePath: string, thumbPath: string|null }}
 */
export async function uploadDocument(doc) {
  const user = requireUser();
  const base = `${user.id}/${doc.id}`;
  const remotePath = `${base}/v1.pdf`;
  const thumbPath = doc.thumb ? `${base}/miniatura.jpg` : null;

  await putFile(remotePath, doc.pdf, 'application/pdf');
  if (thumbPath) await putFile(thumbPath, doc.thumb, 'image/jpeg');

  const row = {
    id: doc.id,
    nombre: doc.name,
    carpeta_id: doc.carpetaId ?? null,
    origen: doc.origen ?? 'app',
    estado_ocr: doc.estadoOcr ?? 'pendiente',
    texto_ocr: doc.textoOcr ?? null, // texto extraído del PDF (o del OCR en la fase 4)
    paginas: doc.pageCount ?? null,
    version_actual: 1,
    miniatura_path: thumbPath,
    created_at: new Date(doc.created).toISOString(),
  };
  let { error } = await supabase.from('documentos').upsert(row);
  if (error?.code === '23503' && row.carpeta_id) {
    // La carpeta se borró desde otro dispositivo mientras esperaba: va a la raíz.
    ({ error } = await supabase.from('documentos').upsert({ ...row, carpeta_id: null }));
  }
  check(error, 'No se pudo registrar el documento');

  ({ error } = await supabase.from('documento_versiones').upsert(
    {
      documento_id: doc.id,
      numero: 1,
      storage_path: remotePath,
      tamano_bytes: doc.size,
      paginas: doc.pageCount ?? null,
      motivo: 'original',
    },
    { onConflict: 'documento_id,numero' },
  ));
  check(error, 'No se pudo registrar la versión');

  // Favorito marcado antes de subir (si la columna aún no existe, se omite sin fallar).
  if (doc.favorito && hasFavorito) {
    await supabase.from('documentos').update({ favorito: true }).eq('id', doc.id);
  }

  return { remotePath, thumbPath };
}

/**
 * Guarda un PDF modificado como versión nueva del mismo documento. Las
 * versiones anteriores se conservan en la nube (la 1 es siempre el original).
 * @returns {{ remotePath: string, thumbPath: string|null }}
 */
export async function uploadNewVersion(doc, { pdf, thumb, pageCount, textoOcr }) {
  const user = requireUser();
  const base = `${user.id}/${doc.id}`;
  const { data: versiones, error: e1 } = await supabase
    .from('documento_versiones')
    .select('numero')
    .eq('documento_id', doc.id);
  check(e1, 'No se pudo leer el historial del documento');
  const numero = Math.max(1, ...(versiones ?? []).map((v) => v.numero)) + 1;
  const remotePath = `${base}/v${numero}.pdf`;
  // Archivo de miniatura nuevo por versión: los archivos existentes no se sobrescriben.
  const thumbPath = thumb ? `${base}/miniatura-v${numero}.jpg` : doc.thumbPath ?? null;

  await putFile(remotePath, pdf, 'application/pdf');
  if (thumb) await putFile(thumbPath, thumb, 'image/jpeg');

  let { error } = await supabase.from('documento_versiones').insert({
    documento_id: doc.id,
    numero,
    storage_path: remotePath,
    tamano_bytes: pdf.size,
    paginas: pageCount ?? null,
    motivo: 'mejora',
  });
  check(error, 'No se pudo registrar la versión');

  const cambios = { version_actual: numero, paginas: pageCount ?? null, miniatura_path: thumbPath };
  if (textoOcr !== undefined) cambios.texto_ocr = textoOcr;
  ({ error } = await supabase.from('documentos').update(cambios).eq('id', doc.id));
  check(error, 'No se pudo actualizar el documento');
  return { remotePath, thumbPath };
}

export async function renameDocument(id, nombre) {
  const { error } = await supabase.from('documentos').update({ nombre }).eq('id', id);
  check(error, 'No se pudo renombrar el documento');
}

export async function moveDocument(id, carpetaId) {
  const { error } = await supabase.from('documentos').update({ carpeta_id: carpetaId ?? null }).eq('id', id);
  check(error, 'No se pudo mover el documento');
}

/** Borra el documento (con sus versiones y etiquetas) y después sus archivos. */
export async function deleteDocument(id) {
  const user = requireUser();
  const { error } = await supabase.from('documentos').delete().eq('id', id);
  check(error, 'No se pudo eliminar el documento');

  // Si falla la limpieza de archivos, el documento igual ya no aparece en ningún lado.
  const base = `${user.id}/${id}`;
  const { data: files } = await storage().list(base);
  if (files?.length) await storage().remove(files.map((file) => `${base}/${file.name}`));
}

/**
 * Convierte un PDF a Word/Excel/PowerPoint con alta fidelidad llamando a la
 * Edge Function «convertir» (que usa CloudConvert con la API key del servidor).
 */
export async function convertHiFi(pdfBlob, formato) {
  requireUser();
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error('Inicia sesión para convertir en la nube.');

  // Normaliza la estructura del PDF: algunos conversores externos se caen con
  // PDF generados por ciertos sistemas; reescribirlo suele solucionarlo.
  try {
    const edit = await import('./pdfedit.js');
    pdfBlob = await edit.normalize(pdfBlob);
  } catch {
    /* si falla, se envía el PDF tal cual */
  }

  // PDF → base64 (por tramos, para no desbordar la pila con archivos grandes).
  const bytes = new Uint8Array(await pdfBlob.arrayBuffer());
  let binario = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const pdfBase64 = btoa(binario);

  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/Convertir`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ formato, pdfBase64 }),
    });
  } catch {
    throw new Error('Sin conexión con el servidor de conversión.');
  }
  if (!res.ok) {
    let msg = `Error ${res.status}`;
    if (res.status === 404) msg = 'La función de conversión no está publicada todavía.';
    else {
      try {
        msg = (await res.json()).error || msg;
      } catch {
        /* sin cuerpo JSON */
      }
    }
    throw new Error(msg);
  }
  return res.blob();
}

/** OCR de un PDF escaneado: devuelve { texto, nombre_sugerido, etiquetas_sugeridas }. */
export async function runOcr(pdfBlob) {
  requireUser();
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error('Inicia sesión para usar el OCR.');

  const bytes = new Uint8Array(await pdfBlob.arrayBuffer());
  let binario = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));

  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/Ocr`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pdfBase64: btoa(binario) }),
    });
  } catch {
    throw new Error('Sin conexión con el servidor de OCR.');
  }
  if (!res.ok) {
    let msg = `Error ${res.status}`;
    let status = res.status;
    if (res.status === 404) msg = 'La función de OCR no está publicada todavía.';
    else {
      try {
        const body = await res.json();
        msg = body.error || msg;
        // La función reenvía la respuesta del servicio de OCR: se agrega su motivo.
        const upstream = msg.match(/respondió (\d{3})/);
        if (upstream) status = Number(upstream[1]);
        if (body.detalle) {
          try {
            const motivo = JSON.parse(body.detalle)?.error?.message;
            if (/credit balance/i.test(motivo || '')) {
              msg = 'La cuenta de Anthropic no tiene saldo. Recarga créditos en console.anthropic.com › Plans & Billing.';
              status = 402;
            } else if (motivo) msg += ` (${motivo})`;
          } catch {
            msg += ` (${String(body.detalle).slice(0, 160)})`;
          }
        }
      } catch {
        /* sin cuerpo JSON */
      }
    }
    throw Object.assign(new Error(msg), { status });
  }
  return res.json();
}

/** Guarda en la nube el texto reconocido y el estado de OCR de un documento. */
/** Marca o desmarca un documento como favorito. */
export async function setFavorite(id, favorito) {
  if (!hasFavorito) throw new Error('Falta activar Favoritos en la base de datos (migración pendiente).');
  const { error } = await supabase.from('documentos').update({ favorito }).eq('id', id);
  check(error, 'No se pudo guardar el favorito');
}

export const favoritesEnabled = () => hasFavorito;

export async function setOcr(id, texto, estado) {
  const { error } = await supabase.from('documentos').update({ texto_ocr: texto, estado_ocr: estado }).eq('id', id);
  check(error, 'No se pudo guardar el texto reconocido');
}

export async function downloadFile(path) {
  const { data, error } = await storage().download(path);
  check(error, 'No se pudo descargar el archivo');
  return data;
}

/** Convierte un documento (Word, Excel, PowerPoint, RTF, HTML, HEIC…) a PDF en la nube. */
export async function convertToPdf(file) {
  requireUser();
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error('Inicia sesión para convertir en la nube.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binario = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/Convertir`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ modo: 'a-pdf', nombre: file.name, archivoBase64: btoa(binario) }),
    });
  } catch {
    throw new Error('Sin conexión con el servidor de conversión.');
  }
  if (!res.ok) {
    let msg = `Error ${res.status}`;
    if (res.status === 404) msg = 'La función de conversión no está publicada todavía.';
    else {
      try {
        msg = (await res.json()).error || msg;
      } catch {
        /* sin cuerpo JSON */
      }
    }
    // Función antigua (sin modo «a-pdf»): hay que volver a publicarla.
    if (/Formato no soportado|Falta el PDF/.test(msg)) msg = 'Falta actualizar la función «Convertir» en Supabase para convertir a PDF.';
    throw new Error(msg);
  }
  const blob = await res.blob();
  const cabecera = new TextDecoder('latin1').decode(new Uint8Array(await blob.slice(0, 4).arrayBuffer()));
  if (cabecera !== '%PDF') throw new Error('La conversión no devolvió un PDF válido.');
  return new Blob([blob], { type: 'application/pdf' });
}

