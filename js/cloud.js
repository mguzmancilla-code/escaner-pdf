// Biblioteca en la nube (Supabase): carpetas, documentos y archivos del bucket privado.
// Rutas en Storage: {user_id}/{documento_id}/v{n}.pdf y {user_id}/{documento_id}/miniatura.jpg

import { getUser, supabase } from './auth.js';

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

export async function fetchDocuments() {
  const { data, error } = await supabase
    .from('documentos')
    .select(
      'id, nombre, carpeta_id, origen, estado_ocr, paginas, version_actual, miniatura_path, created_at, ' +
        'documento_versiones (numero, storage_path, tamano_bytes)',
    )
    .order('created_at', { ascending: false });
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

export async function downloadFile(path) {
  const { data, error } = await storage().download(path);
  check(error, 'No se pudo descargar el archivo');
  return data;
}
