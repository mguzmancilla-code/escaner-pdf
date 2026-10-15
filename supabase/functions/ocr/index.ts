// Edge Function: OCR de un PDF escaneado con un modelo de visión (Claude).
// Devuelve el texto reconocido y una sugerencia de nombre. La API key vive solo
// en el secreto ANTHROPIC_API_KEY (nunca en el navegador). Usuario autenticado.
//
// Despliegue (panel de Supabase, sin CLI):
//   Edge Functions › Deploy a new function › nombre "ocr" › pegar este archivo
//   › DESACTIVAR "Verify JWT" › Deploy.
//   Luego: Edge Functions › Secrets › agregar ANTHROPIC_API_KEY.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const MODELO = 'claude-sonnet-5'; // buen balance calidad/costo; cambia a claude-haiku-4-5-20251001 para más barato

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);

  const auth = req.headers.get('Authorization') ?? '';
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) return json({ error: 'Inicia sesión para usar el OCR.' }, 401);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json({ error: 'Falta configurar ANTHROPIC_API_KEY en la función.' }, 500);

  let body: { pdfBase64?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Cuerpo inválido.' }, 400);
  }
  if (!body.pdfBase64) return json({ error: 'Falta el PDF.' }, 400);

  const prompt =
    'Transcribe TODO el texto de este documento, respetando el orden de lectura y los saltos de línea. ' +
    'No agregues comentarios ni interpretación. Luego sugiere un nombre corto y descriptivo para el archivo. ' +
    'Responde SOLO con JSON válido: {"texto": "...", "nombre_sugerido": "...", "etiquetas_sugeridas": ["...", "..."]}.';

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODELO,
        max_tokens: 8000,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: body.pdfBase64 } },
              { type: 'text', text: prompt },
            ],
          },
        ],
      }),
    });
    if (!res.ok) {
      const detalle = await res.text();
      return json({ error: `El servicio de OCR respondió ${res.status}.`, detalle }, 502);
    }
    const data = await res.json();
    const texto = (data.content ?? []).map((c: any) => c.text ?? '').join('');
    // La respuesta es JSON (posiblemente dentro de ```); se extrae el objeto.
    const match = texto.match(/\{[\s\S]*\}/);
    let resultado: { texto: string; nombre_sugerido?: string; etiquetas_sugeridas?: string[] };
    try {
      resultado = JSON.parse(match ? match[0] : texto);
    } catch {
      resultado = { texto }; // si no vino como JSON, se devuelve el texto tal cual
    }
    return json({
      texto: resultado.texto ?? '',
      nombre_sugerido: resultado.nombre_sugerido ?? '',
      etiquetas_sugeridas: resultado.etiquetas_sugeridas ?? [],
    });
  } catch (e) {
    return json({ error: `Error de OCR: ${e instanceof Error ? e.message : e}` }, 500);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
