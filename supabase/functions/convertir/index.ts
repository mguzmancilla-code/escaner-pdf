// Edge Function: convierte un PDF a Word/Excel/PowerPoint con alta fidelidad
// usando CloudConvert. La API key vive solo en el secreto CLOUDCONVERT_API_KEY
// (nunca sale al navegador). El usuario debe estar autenticado.
//
// Despliegue (desde el panel de Supabase, sin CLI):
//   Edge Functions › Deploy a new function › nombre "convertir" › pegar este
//   archivo › DESACTIVAR "Verify JWT" (el token se valida aquí abajo) › Deploy.
//   Luego: Edge Functions › Secrets › agregar CLOUDCONVERT_API_KEY.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const FORMATOS: Record<string, string> = {
  docx: 'docx',
  xlsx: 'xlsx',
  pptx: 'pptx',
};

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);

  // 1) Verificar que el usuario tiene sesión iniciada.
  const auth = req.headers.get('Authorization') ?? '';
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: auth } } },
  );
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) return json({ error: 'Inicia sesión para convertir.' }, 401);

  const apiKey = Deno.env.get('CLOUDCONVERT_API_KEY');
  if (!apiKey) return json({ error: 'Falta configurar CLOUDCONVERT_API_KEY en la función.' }, 500);

  // 2) Leer el PDF y el formato destino.
  let body: { pdfBase64?: string; formato?: string; nombre?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Cuerpo inválido.' }, 400);
  }
  const salida = FORMATOS[body.formato ?? ''];
  if (!salida) return json({ error: 'Formato no soportado.' }, 400);
  if (!body.pdfBase64) return json({ error: 'Falta el PDF.' }, 400);

  const cc = (path: string, init?: RequestInit) =>
    fetch(`https://api.cloudconvert.com/v2${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });

  try {
    // 3) Crear el trabajo: importar (base64) → convertir → exportar (url).
    const crear = await cc('/jobs', {
      method: 'POST',
      body: JSON.stringify({
        tasks: {
          'import-1': { operation: 'import/base64', file: body.pdfBase64, filename: 'entrada.pdf' },
          'convert-1': { operation: 'convert', input: 'import-1', input_format: 'pdf', output_format: salida },
          'export-1': { operation: 'export/url', input: 'convert-1' },
        },
      }),
    });
    if (!crear.ok) return json({ error: `CloudConvert rechazó la conversión (${crear.status}).` }, 502);
    const job = (await crear.json()).data;

    // 4) Esperar a que termine (sondeo con límite de tiempo).
    let url = '';
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const estado = (await (await cc(`/jobs/${job.id}`)).json()).data;
      if (estado.status === 'finished') {
        const exportTask = estado.tasks.find((t: any) => t.name === 'export-1');
        url = exportTask?.result?.files?.[0]?.url ?? '';
        break;
      }
      if (estado.status === 'error') return json({ error: 'La conversión falló en CloudConvert.' }, 502);
    }
    if (!url) return json({ error: 'La conversión tardó demasiado. Intenta con un PDF más corto.' }, 504);

    // 5) Descargar el resultado y devolverlo al navegador.
    const archivo = await fetch(url);
    const bytes = new Uint8Array(await archivo.arrayBuffer());
    return new Response(bytes, {
      headers: { ...cors, 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${salida}"` },
    });
  } catch (e) {
    return json({ error: `Error al convertir: ${e instanceof Error ? e.message : e}` }, 500);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
