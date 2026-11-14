// assets/js/asistente-ia.js
// Asistente IA conversacional: convierte instrucciones libres ("haz un cuadrado y luego enciende la luz")
// en un plan de pasos y lo ejecuta con las mismas acciones seguras que los botones.
//
// - Sin configuración: usa un intérprete local (secuencias, figuras, ángulos, repeticiones).
// - Con IA: usa la API de Claude (clave propia guardada solo en este navegador, o un servidor proxy).

import { interpretarVoz, nombreComando } from './control-ia.js?v=23';

const CLAVE_CONFIG = 'vehiculo-iot-asistente';
const MODELO_PREDETERMINADO = 'claude-haiku-5-5';
const API_URL = 'https://api.anthropic.com/v1/messages';

const MOVIMIENTOS = ['AVANZAR', 'RETROCEDER', 'GIRAR_IZQUIERDA', 'GIRAR_DERECHA', 'SUBIR_BRAZO', 'BAJAR_BRAZO', 'MOTOR_IZQUIERDA', 'MOTOR_DERECHA'];
const ACCESORIOS = ['VELOCIDAD', 'SONIDO', 'LUZ'];

// Cinemática del gemelo 3D (scene3d.js): giro 1.55 rad/s y avance 1.35 m/s en modo normal; turbo x1.85
const GIRO_GRADOS_POR_SEG = 1.55 * (180 / Math.PI); // ≈ 88.8°/s
const FACTOR_TURBO = 1.85;

const LIMITES = { pasos: 30, segMovimiento: 10, segTotal: 90 };

const sinAcentos = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const espera = (ms, señal) => new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    señal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('cancelado', 'AbortError')); }, { once: true });
});
const redondear = (n) => Math.round(n * 100) / 100;

// =============================================================================
// Intérprete local (sin internet ni clave)
// =============================================================================

const NUM = { una: 1, un: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };
const numero = (t) => (t in NUM ? NUM[t] : parseFloat(String(t).replace(',', '.')));

/**
 * Plan local a partir de una frase. Devuelve { pasos, respuesta } o null si no entendió nada.
 * @param {string} texto
 * @param {{ turbo?: boolean }} estado
 */
export function planLocal(texto, estado = {}) {
    let t = ` ${sinAcentos(texto).replace(/[¿?¡!]/g, ' ').replace(/\s+/g, ' ').trim()} `;
    const giroSeg = (grados) => redondear(grados / (GIRO_GRADOS_POR_SEG * (estado.turbo ? FACTOR_TURBO : 1)));
    const pasos = [];
    const entendidas = [];

    // Repetición global: "... 3 veces"
    let repetir = 1;
    const mRep = t.match(/\b(\d+|una|dos|tres|cuatro|cinco)\s+veces\b/);
    if (mRep) {
        repetir = Math.min(5, Math.max(1, numero(mRep[1])));
        t = t.replace(mRep[0], ' ');
    }

    const segmentos = t
        .split(/\s*(?:,|;|\by luego\b|\bluego\b|\by despues\b|\bdespues\b|\by entonces\b|\bentonces\b|\by al final\b|\by\b)\s*/)
        .map((s) => s.trim())
        .filter(Boolean);

    for (const seg of segmentos) {
        // Figuras / maniobras
        if (/\bcuadrado\b/.test(seg)) {
            for (let i = 0; i < 4; i++) pasos.push(mover('AVANZAR', 1.5), mover('GIRAR_DERECHA', giroSeg(90)));
            entendidas.push('un cuadrado');
            continue;
        }
        if (/\btriangulo\b/.test(seg)) {
            for (let i = 0; i < 3; i++) pasos.push(mover('AVANZAR', 1.5), mover('GIRAR_DERECHA', giroSeg(120)));
            entendidas.push('un triángulo');
            continue;
        }
        if (/\bzig ?zag\b/.test(seg)) {
            pasos.push(mover('GIRAR_IZQUIERDA', giroSeg(45)));
            for (let i = 0; i < 3; i++) pasos.push(mover('AVANZAR', 1), mover(i % 2 ? 'GIRAR_IZQUIERDA' : 'GIRAR_DERECHA', giroSeg(90)));
            pasos.push(mover('AVANZAR', 1));
            entendidas.push('un zigzag');
            continue;
        }
        if (/\b(baila|bailar|fiesta|celebra)\b/.test(seg)) {
            pasos.push(acc('LUZ'), acc('SONIDO'), mover('GIRAR_IZQUIERDA', 0.8), mover('GIRAR_DERECHA', 0.8), mover('SUBIR_BRAZO', 0.6), mover('BAJAR_BRAZO', 0.6), acc('LUZ'), acc('SONIDO'));
            entendidas.push('un baile');
            continue;
        }
        if (/\b(saluda|saludo|hola)\b/.test(seg)) {
            pasos.push(acc('SONIDO'), mover('SUBIR_BRAZO', 0.7), mover('BAJAR_BRAZO', 0.7), mover('SUBIR_BRAZO', 0.7), mover('BAJAR_BRAZO', 0.7));
            entendidas.push('un saludo');
            continue;
        }
        if (/\b(excava|excavar|cava|cavar)\b/.test(seg) && !/\bdemo\b/.test(seg)) {
            pasos.push(mover('BAJAR_BRAZO', 1.2), mover('MOTOR_IZQUIERDA', 1), mover('SUBIR_BRAZO', 1.2), mover('MOTOR_DERECHA', 1), mover('BAJAR_BRAZO', 0.8));
            entendidas.push('una excavación');
            continue;
        }
        if (/\b(espera|esperar|pausa)\b/.test(seg)) {
            const m = seg.match(/(\d+(?:[.,]\d+)?|un|una|dos|tres|cuatro|cinco)\s*(seg|segundo|segundos)/);
            pasos.push({ accion: 'esperar', segundos: Math.min(10, m ? numero(m[1]) : 1) });
            entendidas.push('esperar');
            continue;
        }

        // Giros por ángulo: "gira 90 grados a la derecha", "media vuelta", "vuelta completa"
        const izq = /\bizquierd/.test(seg);
        const mGrados = seg.match(/(\d+)\s*(grados|°)/);
        let grados = null;
        if (mGrados) grados = parseInt(mGrados[1], 10);
        else if (/\bmedia vuelta\b/.test(seg)) grados = 180;
        else if (/\b(vuelta completa|una vuelta|da la vuelta|360)\b/.test(seg)) grados = 360;
        if (grados !== null && /\b(gira|girar|vuelta|voltea|da)\b/.test(seg) && !/\b(motor|cabina|torreta)\b/.test(seg)) {
            pasos.push(mover(izq ? 'GIRAR_IZQUIERDA' : 'GIRAR_DERECHA', Math.min(LIMITES.segMovimiento, giroSeg(grados))));
            entendidas.push(`girar ${grados}° a la ${izq ? 'izquierda' : 'derecha'}`);
            continue;
        }

        // Comando simple (mismo intérprete que la voz)
        const a = interpretarVoz(seg);
        if (!a) continue;
        if (a.tipo === 'mover') {
            // Sin segundos explícitos, un giro del chasis es de 90°
            const sinTiempo = !/(\d+(?:[.,]\d+)?|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|medio)\s*(s|seg|segundo|segundos)\b/.test(seg);
            if (sinTiempo && (a.cmd === 'GIRAR_IZQUIERDA' || a.cmd === 'GIRAR_DERECHA')) a.segundos = giroSeg(90);
            pasos.push(mover(a.cmd, a.segundos));
            entendidas.push(`${nombreComando(a.cmd).toLowerCase()} ${a.segundos} s`);
        } else if (a.tipo === 'accesorio') {
            pasos.push({ accion: 'accesorio', cmd: a.cmd, estado: a.deseado });
            entendidas.push(nombreComando(a.cmd).toLowerCase());
        } else if (a.tipo === 'parar') {
            pasos.push({ accion: 'parar' });
            entendidas.push('detener');
        } else if (a.tipo === 'demo') {
            pasos.push({ accion: 'demo', nombre: a.texto });
            entendidas.push('iniciar demo');
        } else if (a.tipo === 'cancelar_demo') {
            pasos.push({ accion: 'cancelar_demo' });
            entendidas.push('cancelar demo');
        }
    }

    if (!pasos.length) return null;
    const base = [...pasos];
    for (let i = 1; i < repetir; i++) pasos.push(...base);
    const resumen = entendidas.join(', luego ');
    return {
        pasos,
        respuesta: `Entendido: ${resumen}${repetir > 1 ? ` (${repetir} veces)` : ''}.`
    };
}

function mover(cmd, segundos) {
    return { accion: 'mover', cmd, segundos: redondear(segundos) };
}
function acc(cmd) {
    return { accion: 'accesorio', cmd, estado: null };
}

// =============================================================================
// Validación de planes (vengan de la IA o del intérprete local)
// =============================================================================

export function validarPlan(pasos) {
    if (!Array.isArray(pasos)) return [];
    const limpios = [];
    let total = 0;
    for (const p of pasos.slice(0, LIMITES.pasos)) {
        if (!p || typeof p !== 'object') continue;
        const accion = String(p.accion || '').toLowerCase();
        const cmd = String(p.cmd || '').toUpperCase();
        if (accion === 'mover' && MOVIMIENTOS.includes(cmd)) {
            const s = Math.min(LIMITES.segMovimiento, Math.max(0.2, Number(p.segundos) || 1));
            if (total + s > LIMITES.segTotal) break;
            total += s;
            limpios.push({ accion, cmd, segundos: redondear(s) });
        } else if (accion === 'accesorio' && ACCESORIOS.includes(cmd)) {
            const estado = p.estado === true || p.estado === false ? p.estado : null;
            limpios.push({ accion, cmd, estado });
        } else if (accion === 'esperar') {
            const s = Math.min(10, Math.max(0.1, Number(p.segundos) || 1));
            if (total + s > LIMITES.segTotal) break;
            total += s;
            limpios.push({ accion, segundos: redondear(s) });
        } else if (accion === 'parar' || accion === 'cancelar_demo') {
            limpios.push({ accion });
        } else if (accion === 'demo') {
            limpios.push({ accion, nombre: String(p.nombre || '') });
        }
    }
    return limpios;
}

export function describirPaso(p) {
    switch (p.accion) {
        case 'mover': return `${nombreComando(p.cmd)} · ${p.segundos} s`;
        case 'accesorio': return `${nombreComando(p.cmd)}${p.estado === true ? ' (encender)' : p.estado === false ? ' (apagar)' : ''}`;
        case 'esperar': return `Esperar ${p.segundos} s`;
        case 'parar': return 'Detener';
        case 'demo': return `Demo ${p.nombre}`.trim();
        case 'cancelar_demo': return 'Cancelar demo';
        default: return p.accion;
    }
}

// =============================================================================
// Asistente
// =============================================================================

export class AsistenteIA {
    /**
     * @param {object} acciones presionar, soltar, accesorio, parar, iniciarDemo, cancelarDemo, estadoVehiculo
     */
    constructor(acciones) {
        this.a = acciones;
        this.historial = []; // [{ role, content }] para dar contexto a la IA
        this.control = null; // AbortController del plan en curso
        this.config = this._leerConfig();
    }

    // --- Configuración ---------------------------------------------------------
    _leerConfig() {
        try {
            return { modelo: MODELO_PREDETERMINADO, apiKey: '', proxyUrl: '', ...JSON.parse(localStorage.getItem(CLAVE_CONFIG) || '{}') };
        } catch {
            return { modelo: MODELO_PREDETERMINADO, apiKey: '', proxyUrl: '' };
        }
    }
    guardarConfig(cfg) {
        this.config = { ...this.config, ...cfg };
        if (!this.config.modelo) this.config.modelo = MODELO_PREDETERMINADO;
        try { localStorage.setItem(CLAVE_CONFIG, JSON.stringify(this.config)); } catch { /* almacenamiento no disponible */ }
    }
    get iaConfigurada() {
        return Boolean(this.config.apiKey || this.config.proxyUrl);
    }

    // --- Conversación ----------------------------------------------------------

    /**
     * Procesa un mensaje del usuario. Devuelve { respuesta, pasos, fuente: 'ia' | 'local' | 'ninguna', error? }.
     */
    async procesar(texto) {
        const estado = this.a.estadoVehiculo();
        let resultado = null;
        let error = null;

        if (this.iaConfigurada) {
            try {
                resultado = await this._consultarIA(texto, estado);
                resultado.fuente = 'ia';
            } catch (e) {
                console.error('Asistente IA:', e);
                error = e.message;
            }
        }
        if (!resultado) {
            const local = planLocal(texto, estado);
            if (local) resultado = { ...local, fuente: 'local' };
        }
        if (!resultado) {
            resultado = {
                fuente: 'ninguna',
                pasos: [],
                respuesta: this.iaConfigurada
                    ? 'No pude entender eso. Intenta con algo como "avanza 2 segundos y luego gira a la derecha".'
                    : 'No entendí. Sin IA conectada entiendo órdenes como "avanza 2 segundos, gira 90 grados a la izquierda y enciende la luz", "haz un cuadrado" o "baila". Para conversar libremente, configura la IA con el botón ⚙.'
            };
        }
        resultado.pasos = validarPlan(resultado.pasos);
        if (error) resultado.error = error;
        return resultado;
    }

    async _consultarIA(texto, estado) {
        const sistema = this._promptSistema(estado);
        this.historial.push({ role: 'user', content: texto });
        const mensajes = this.historial.slice(-10);

        const cuerpo = { model: this.config.modelo || MODELO_PREDETERMINADO, max_tokens: 900, system: sistema, messages: mensajes };
        let respuesta;
        if (this.config.proxyUrl) {
            respuesta = await fetch(this.config.proxyUrl, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(cuerpo)
            });
        } else {
            respuesta = await fetch(API_URL, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'x-api-key': this.config.apiKey,
                    'anthropic-version': '2023-06-01',
                    // Uso directo desde el navegador con la clave propia del usuario
                    'anthropic-dangerous-direct-browser-access': 'true'
                },
                body: JSON.stringify(cuerpo)
            });
        }

        const datos = await respuesta.json().catch(() => ({}));
        if (!respuesta.ok) {
            this.historial.pop();
            const msg = datos?.error?.message || `HTTP ${respuesta.status}`;
            if (respuesta.status === 401) throw new Error('La clave de API no es válida.');
            throw new Error(`La IA respondió con error: ${msg}`);
        }

        const textoIA = (datos.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
        this.historial.push({ role: 'assistant', content: textoIA || '{}' });

        const json = extraerJSON(textoIA);
        if (!json) return { respuesta: textoIA.trim() || 'Listo.', pasos: [] };
        return { respuesta: String(json.respuesta || 'Listo.'), pasos: json.pasos || [] };
    }

    _promptSistema(estado) {
        return `Eres el asistente de control de una excavadora IoT (un vehículo real con un gemelo digital 3D). Respondes SIEMPRE en español, de forma breve y amable.

Tu trabajo: convertir lo que pide el usuario en un plan de pasos que la app ejecutará en orden. Si el usuario solo conversa o pregunta, responde sin pasos.

Responde ÚNICAMENTE con un objeto JSON válido, sin texto antes ni después, con esta forma:
{"respuesta": "frase corta para el usuario", "pasos": [ ... ]}

Pasos permitidos:
- {"accion":"mover","cmd":"<MOVIMIENTO>","segundos":<0.2 a 10>}  (el vehículo se mueve esos segundos y luego se detiene)
  MOVIMIENTO: AVANZAR, RETROCEDER, GIRAR_IZQUIERDA, GIRAR_DERECHA, SUBIR_BRAZO, BAJAR_BRAZO, MOTOR_IZQUIERDA, MOTOR_DERECHA
- {"accion":"accesorio","cmd":"VELOCIDAD|SONIDO|LUZ","estado":true|false|null}  (VELOCIDAD = turbo; LUZ y VELOCIDAD alternan: usa estado true/false si el usuario pide encender/apagar, null para alternar; SONIDO = claxon)
- {"accion":"esperar","segundos":<0.1 a 10>}
- {"accion":"parar"}
- {"accion":"demo","nombre":"<nombre de una demo disponible>"}
- {"accion":"cancelar_demo"}

Datos físicos para calcular tiempos:
- Avance: ${estado.turbo ? '2.5 m/s (turbo activo)' : '1.35 m/s (modo normal; con turbo 2.5 m/s)'}.
- Giro en su lugar: ${estado.turbo ? 'unos 164°/s (turbo)' : 'unos 89°/s (90° ≈ 1.0 s, 180° ≈ 2.0 s, 360° ≈ 4.1 s)'}.
- La plataforma es un círculo de unos 3 m de radio: evita avanzar más de 4 s seguidos en la misma dirección.
Límites: máximo ${LIMITES.pasos} pasos y ${LIMITES.segTotal} s en total.

Estado actual: luz ${estado.luz ? 'encendida' : 'apagada'}, turbo ${estado.turbo ? 'activo' : 'inactivo'}, modo ${estado.simulacion ? 'SIMULACIÓN (sin vehículo real)' : 'control real'}.
Demos disponibles: ${estado.demos?.length ? estado.demos.join(' | ') : 'ninguna'}.

Si piden algo peligroso, imposible o fuera de estos comandos, explícalo en "respuesta" y deja "pasos" vacío. Si piden detenerse, usa [{"accion":"parar"}].`;
    }

    // --- Ejecución del plan ----------------------------------------------------

    get ejecutando() {
        return Boolean(this.control);
    }

    /**
     * Ejecuta los pasos en orden. onPaso(indice, estado) con estado 'inicio' | 'fin'.
     * Devuelve true si terminó y false si se canceló.
     */
    async ejecutar(pasos, onPaso = () => {}) {
        this.cancelar();
        const control = new AbortController();
        this.control = control;
        const señal = control.signal;
        try {
            for (let i = 0; i < pasos.length; i++) {
                if (señal.aborted) return false;
                const p = pasos[i];
                onPaso(i, 'inicio');
                switch (p.accion) {
                    case 'mover':
                        this.a.presionar(p.cmd);
                        await espera(p.segundos * 1000, señal);
                        this.a.soltar();
                        await espera(150, señal); // pausa breve entre movimientos
                        break;
                    case 'accesorio': {
                        const actual = this.a.estadoAccesorio(p.cmd);
                        if (p.estado === null || actual === null || actual !== p.estado) this.a.accesorio(p.cmd);
                        await espera(250, señal);
                        break;
                    }
                    case 'esperar':
                        await espera(p.segundos * 1000, señal);
                        break;
                    case 'parar':
                        this.a.soltar();
                        break;
                    case 'demo':
                        this.a.iniciarDemo(p.nombre);
                        break;
                    case 'cancelar_demo':
                        this.a.cancelarDemo();
                        break;
                }
                onPaso(i, 'fin');
            }
            return true;
        } catch (e) {
            if (e.name === 'AbortError') return false;
            throw e;
        } finally {
            if (this.control === control) this.control = null;
        }
    }

    // Detiene el plan en curso (lo llama el botón Detener, "alto", etc.)
    cancelar() {
        if (this.control) {
            this.control.abort();
            this.control = null;
            return true;
        }
        return false;
    }

    reiniciarConversacion() {
        this.historial = [];
    }
}

// Extrae el primer objeto JSON de un texto (la IA a veces lo envuelve en ```json)
export function extraerJSON(texto) {
    if (!texto) return null;
    const limpio = texto.replace(/```(?:json)?/gi, '');
    const inicio = limpio.indexOf('{');
    const fin = limpio.lastIndexOf('}');
    if (inicio === -1 || fin <= inicio) return null;
    try {
        return JSON.parse(limpio.slice(inicio, fin + 1));
    } catch {
        return null;
    }
}
