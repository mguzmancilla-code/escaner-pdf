// Protección de PDF con contraseña: cifrado estándar AES-256 (PDF 2.0 / ISO
// 32000-2, «Standard security handler» revisión 6), el mismo que usa Adobe.
// Todo ocurre en el navegador con Web Crypto: la contraseña nunca sale del equipo.

import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFStream, PDFString } from './vendor/pdf-lib.esm.min.js';

const subtle = crypto.subtle;
const enc = new TextEncoder();

const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
const random = (n) => crypto.getRandomValues(new Uint8Array(n));

/** Contraseña como bytes UTF-8 (máx. 127), tal como pide la revisión 6. */
const passwordBytes = (password) => enc.encode(String(password).normalize('NFKC')).slice(0, 127);

/** AES-CBC sin relleno: Web Crypto siempre agrega un bloque de relleno, que se descarta. */
async function aesCbcNoPad(keyBytes, iv, data) {
  const key = await subtle.importKey('raw', keyBytes, 'AES-CBC', false, ['encrypt']);
  const out = new Uint8Array(await subtle.encrypt({ name: 'AES-CBC', iv }, key, data));
  return out.slice(0, data.length);
}

/** Hash de la revisión 6 (algoritmo 2.B de ISO 32000-2). */
async function hash2B(password, salt, userKey = new Uint8Array(0)) {
  let k = new Uint8Array(await subtle.digest('SHA-256', concat(password, salt, userKey)));
  for (let i = 0; ; i++) {
    const unidad = concat(password, k, userKey);
    const k1 = new Uint8Array(unidad.length * 64);
    for (let r = 0; r < 64; r++) k1.set(unidad, r * unidad.length);
    const e = await aesCbcNoPad(k.slice(0, 16), k.slice(16, 32), k1);
    let mod = 0;
    for (let b = 0; b < 16; b++) mod += e[b];
    const algoritmo = ['SHA-256', 'SHA-384', 'SHA-512'][mod % 3];
    k = new Uint8Array(await subtle.digest(algoritmo, e));
    if (i >= 63 && e[e.length - 1] <= i + 1 - 32) break;
  }
  return k.slice(0, 32);
}

/**
 * Permisos (tabla 22 de la norma). Los bits 1-2 van en 0, los 7-8 y 13-32 en 1.
 * Imprimir = bits 3 y 12; modificar = 4, 9 y 11; copiar = 5 y 10 (accesibilidad).
 */
function permissionsValue({ imprimir, copiar, modificar }) {
  let p = 0xfffff0c0; // bits fijos en 1
  if (imprimir) p |= (1 << 2) | (1 << 11);
  if (modificar) p |= (1 << 3) | (1 << 8) | (1 << 10);
  if (copiar) p |= (1 << 4) | (1 << 9);
  else p |= 1 << 9; // lectores de pantalla siempre permitidos
  return p | 0; // entero con signo de 32 bits, como lo escribe el PDF
}

async function encryptBytes(fileKey, data) {
  const iv = random(16);
  const key = await subtle.importKey('raw', fileKey, 'AES-CBC', false, ['encrypt']);
  return concat(iv, new Uint8Array(await subtle.encrypt({ name: 'AES-CBC', iv }, key, data)));
}

/** Cifra recursivamente los textos de un objeto directo (diccionarios y arreglos). */
async function encryptStrings(obj, fileKey) {
  if (obj instanceof PDFString || obj instanceof PDFHexString) {
    return PDFHexString.of(toHex(await encryptBytes(fileKey, obj.asBytes())));
  }
  if (obj instanceof PDFDict) {
    for (const [key, value] of obj.entries()) obj.set(key, await encryptStrings(value, fileKey));
    return obj;
  }
  if (obj instanceof PDFArray) {
    for (let i = 0; i < obj.size(); i++) obj.set(i, await encryptStrings(obj.get(i), fileKey));
    return obj;
  }
  return obj;
}

const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * Devuelve una copia del PDF protegida con contraseña.
 * @param {Blob} blob PDF sin proteger
 * @param {{ password: string, ownerPassword?: string, imprimir?: boolean, copiar?: boolean, modificar?: boolean }} opciones
 *   Sin restricciones, la contraseña del propietario es la misma; con restricciones
 *   se usa una aleatoria para que nadie pueda quitarlas con la de apertura.
 */
export async function protectPdf(blob, { password, ownerPassword, imprimir = true, copiar = true, modificar = true }) {
  if (!password) throw new Error('falta la contraseña');
  let doc;
  try {
    doc = await PDFDocument.load(await blob.arrayBuffer(), { updateMetadata: false });
  } catch (error) {
    if (/encrypt/i.test(error?.message ?? '')) throw new Error('este PDF ya está protegido con contraseña');
    throw error;
  }
  const context = doc.context;
  const restringido = !(imprimir && copiar && modificar);
  const owner = ownerPassword || (restringido ? toHex(random(24)) : password);

  // Claves (algoritmos 8, 9 y 10 de ISO 32000-2).
  const fileKey = random(32);
  const upw = passwordBytes(password);
  const opw = passwordBytes(owner);
  const [uVal, uKey, oVal, oKey] = [random(8), random(8), random(8), random(8)];
  const U = concat(await hash2B(upw, uVal), uVal, uKey);
  const UE = await aesCbcNoPad(await hash2B(upw, uKey), new Uint8Array(16), fileKey);
  const O = concat(await hash2B(opw, oVal, U), oVal, oKey);
  const OE = await aesCbcNoPad(await hash2B(opw, oKey, U), new Uint8Array(16), fileKey);
  const P = permissionsValue({ imprimir, copiar, modificar });
  const perms = new Uint8Array(16);
  new DataView(perms.buffer).setInt32(0, P, true);
  perms.set([0xff, 0xff, 0xff, 0xff, 0x54 /* T: metadatos cifrados */, 0x61, 0x64, 0x62], 4);
  perms.set(random(4), 12);
  const Perms = await aesCbcNoPad(fileKey, new Uint8Array(16), perms); // un bloque = ECB

  // Cifrar cada objeto: textos y contenido de los streams (ya comprimido).
  for (const [ref, obj] of context.enumerateIndirectObjects()) {
    if (obj instanceof PDFStream) {
      const dict = obj.dict;
      const tipo = dict.get(PDFName.of('Type'));
      if (tipo === PDFName.of('XRef')) continue; // las tablas de referencias no se cifran
      await encryptStrings(dict, fileKey);
      const datos = await encryptBytes(fileKey, obj.getContents());
      dict.set(PDFName.of('Length'), PDFNumber.of(datos.length));
      context.assign(ref, PDFRawStream.of(dict, datos));
    } else {
      context.assign(ref, await encryptStrings(obj, fileKey));
    }
  }

  const cifrado = context.obj({
    Filter: 'Standard',
    V: 5,
    R: 6,
    Length: 256,
    CF: { StdCF: { AuthEvent: 'DocOpen', CFM: 'AESV3', Length: 32 } },
    StmF: 'StdCF',
    StrF: 'StdCF',
    P,
    EncryptMetadata: true,
  });
  for (const [k, v] of [['O', O], ['U', U], ['OE', OE], ['UE', UE], ['Perms', Perms]]) {
    cifrado.set(PDFName.of(k), PDFHexString.of(toHex(v)));
  }
  context.trailerInfo.Encrypt = context.register(cifrado);
  const id = PDFHexString.of(toHex(random(16)));
  context.trailerInfo.ID = context.obj([id, id]);

  const bytes = await doc.save({ useObjectStreams: false, updateFieldAppearances: false });
  return new Blob([bytes], { type: 'application/pdf' });
}
