// server/cloudflare-worker.js
// Proxy opcional para el Asistente IA. Guarda la clave de API en el servidor (no en el navegador),
// así cualquiera que abra la página puede usar la IA sin ver ni escribir la clave.
//
// Cómo publicarlo (gratis en Cloudflare Workers):
//   1. Crea una cuenta en https://dash.cloudflare.com y entra a Workers & Pages → Create → Worker.
//   2. Pega este archivo como código del Worker y pulsa Deploy.
//   3. En Settings → Variables and Secrets agrega:
//        ANTHROPIC_API_KEY  (tipo Secret)  = tu clave sk-ant-...
//        ALLOWED_ORIGIN     (tipo Text)    = https://cynthia026.github.io
//   4. Copia la URL del Worker (https://<nombre>.<cuenta>.workers.dev) y pégala en el asistente:
//        ⚙ → "URL de tu servidor proxy".

const MODELOS_PERMITIDOS = /^claude-/;
const MAX_TOKENS = 1200;

export default {
    async fetch(request, env) {
        const origen = request.headers.get('Origin') || '';
        const permitido = env.ALLOWED_ORIGIN || '';
        const cors = {
            'Access-Control-Allow-Origin': permitido,
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'content-type',
            'Vary': 'Origin'
        };

        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        if (request.method !== 'POST') return json({ error: { message: 'Método no permitido' } }, 405, cors);
        if (permitido && origen !== permitido) return json({ error: { message: 'Origen no permitido' } }, 403, cors);

        let cuerpo;
        try {
            cuerpo = await request.json();
        } catch {
            return json({ error: { message: 'JSON inválido' } }, 400, cors);
        }

        // Solo se reenvían los campos necesarios, con límites
        const peticion = {
            model: MODELOS_PERMITIDOS.test(cuerpo.model || '') ? cuerpo.model : 'claude-haiku-5-5',
            max_tokens: Math.min(Number(cuerpo.max_tokens) || 900, MAX_TOKENS),
            system: String(cuerpo.system || '').slice(0, 8000),
            messages: Array.isArray(cuerpo.messages) ? cuerpo.messages.slice(-10) : []
        };

        const respuesta = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-api-key': env.ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify(peticion)
        });

        return new Response(respuesta.body, {
            status: respuesta.status,
            headers: { ...cors, 'content-type': 'application/json' }
        });
    }
};

function json(datos, status, headers) {
    return new Response(JSON.stringify(datos), { status, headers: { ...headers, 'content-type': 'application/json' } });
}
