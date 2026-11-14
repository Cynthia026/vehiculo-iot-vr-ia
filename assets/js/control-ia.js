// assets/js/control-ia.js
// Control del vehículo con IA: voz (reconocimiento de voz del navegador), gestos de la mano
// (modelo de IA MediaPipe Gesture Recognizer con la cámara) y giroscopio del celular.
//
// Las tres fuentes usan las mismas acciones que los botones:
//   presionar(cmd)  -> el vehículo se mueve mientras dure el comando
//   soltar()        -> envía DETENER
//   accesorio(cmd)  -> Velocidad, Sonido o Luz (un solo toque)
//   parar()         -> paro inmediato

const MP_VERSION = '0.10.21';
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const MP_MODELO = 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task';

const NOMBRES = {
    AVANZAR: 'Avanzar',
    RETROCEDER: 'Retroceder',
    GIRAR_IZQUIERDA: 'Girar izquierda',
    GIRAR_DERECHA: 'Girar derecha',
    SUBIR_BRAZO: 'Subir brazo',
    BAJAR_BRAZO: 'Bajar brazo',
    MOTOR_IZQUIERDA: 'Motor izquierda',
    MOTOR_DERECHA: 'Motor derecha',
    VELOCIDAD: 'Velocidad',
    SONIDO: 'Sonido',
    LUZ: 'Luz'
};
export const nombreComando = (cmd) => NOMBRES[cmd] || cmd;

// =============================================================================
// VOZ: interpretación de frases en español
// =============================================================================

const NUMEROS = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, medio: 0.5 };

const sinAcentos = (t) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Convierte una frase en una acción.
 * @returns {null | {tipo:'parar'} | {tipo:'mover', cmd:string, segundos:number}
 *   | {tipo:'accesorio', cmd:string, deseado:boolean|null} | {tipo:'demo', texto:string} | {tipo:'cancelar_demo'}}
 */
export function interpretarVoz(frase) {
    const t = ` ${sinAcentos(String(frase || '')).replace(/[^a-z0-9ñ.,\s]/g, ' ').replace(/\s+/g, ' ').trim()} `;
    if (!t.trim()) return null;

    // Demos
    if (/\b(demo|demos|rutina|secuencia)\b/.test(t)) {
        if (/\b(cancela|cancelar|termina|terminar|deten|detener|para|parar|quita|quitar|stop|alto)\b/.test(t)) return { tipo: 'cancelar_demo' };
        const texto = t.replace(/\b(inicia|iniciar|empieza|empezar|comienza|ejecuta|ejecutar|corre|pon|activa|la|el|una|un|demo|demos|rutina|secuencia|de)\b/g, ' ').replace(/\s+/g, ' ').trim();
        return { tipo: 'demo', texto };
    }

    // Paro (prioridad máxima)
    if (/\b(alto|para|parar|parate|detente|deten|detener|detenlo|stop|frena|frenar|quieto|quieta|basta|espera)\b/.test(t)) {
        return { tipo: 'parar' };
    }

    // Accesorios
    const enciende = /\b(enciende|encender|prende|prender|activa|activar|pon|sube la velocidad|mas rapido|rapido|acelera)\b/.test(t);
    const apaga = /\b(apaga|apagar|desactiva|desactivar|quita|quitar|mas lento|lento|baja la velocidad|normal)\b/.test(t);
    const deseado = enciende ? true : apaga ? false : null;
    if (/\b(luz|luces|faro|faros|lampara|ilumina|iluminacion)\b/.test(t)) return { tipo: 'accesorio', cmd: 'LUZ', deseado };
    if (/\b(sonido|claxon|bocina|pita|pitar|suena|sonar|toca|tocar|pitido|alarma)\b/.test(t)) return { tipo: 'accesorio', cmd: 'SONIDO', deseado: null };
    if (/\b(turbo|velocidad|rapido|lento|acelera|acelerar)\b/.test(t)) return { tipo: 'accesorio', cmd: 'VELOCIDAD', deseado };

    // Duración ("avanza 3 segundos", "gira dos segundos")
    let segundos = 2;
    const mNum = t.match(/(\d+(?:[.,]\d+)?)\s*(seg|segundo|segundos|s)\b/);
    const mPal = t.match(/\b(un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|medio)\s+(seg|segundo|segundos)\b/);
    if (mNum) segundos = parseFloat(mNum[1].replace(',', '.'));
    else if (mPal) segundos = NUMEROS[mPal[1]];
    segundos = Math.min(10, Math.max(0.5, segundos || 2));

    const mover = (cmd) => ({ tipo: 'mover', cmd, segundos });
    const izq = /\b(izquierda|izquierdo)\b/.test(t);
    const der = /\bderecha\b/.test(t); // "derecho" en México suele significar "recto"

    // Brazo
    if (/\b(brazo|pala|cucharon|cuchara|pluma)\b/.test(t) || /\b(levanta|eleva|baja|bajar|sube|subir)\b/.test(t)) {
        if (/\b(sube|subir|levanta|levantar|eleva|elevar|arriba)\b/.test(t)) return mover('SUBIR_BRAZO');
        if (/\b(baja|bajar|abajo|desciende)\b/.test(t)) return mover('BAJAR_BRAZO');
    }

    // Motores / cabina
    if (/\b(motor|motores|cabina|torreta)\b/.test(t)) {
        if (izq) return mover('MOTOR_IZQUIERDA');
        if (/\b(derecha|derecho)\b/.test(t)) return mover('MOTOR_DERECHA');
    }

    // Giros
    if (izq) return mover('GIRAR_IZQUIERDA');
    if (der) return mover('GIRAR_DERECHA');

    // Avance / retroceso
    if (/\b(retrocede|retroceder|atras|reversa|regresa|regresar|hacia atras)\b/.test(t)) return mover('RETROCEDER');
    if (/\b(avanza|avanzar|adelante|delante|enfrente|sigue|camina|recto|derecho|muevete|arranca|vamos)\b/.test(t)) return mover('AVANZAR');

    return null;
}

// Frases con varias órdenes o maniobras que no son un solo comando
export function esFraseCompleja(frase) {
    const t = ` ${sinAcentos(frase)} `;
    if (/\b(alto|detente|deten|para|frena|stop)\b/.test(t) && t.trim().split(/\s+/).length <= 3) return false;
    return /\b(y luego|luego|despues|entonces|veces|cuadrado|triangulo|zig ?zag|baila|saluda|excava|grados|vuelta|espera)\b/.test(t)
        || / y (avanza|retrocede|gira|sube|baja|enciende|apaga|toca|activa|mueve|levanta|prende)/.test(t);
}

export class ControlVoz {
    constructor(acciones) {
        this.a = acciones;
        this.activo = false;
        this.timer = null;
        this.ultimoParoInterino = -1;
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        this.soportado = !!SR;
        if (!SR) return;

        this.rec = new SR();
        this.rec.lang = 'es-MX';
        this.rec.continuous = true;
        this.rec.interimResults = true;
        this.rec.maxAlternatives = 3;
        this.rec.onresult = (e) => this._resultado(e);
        this.rec.onerror = (e) => {
            if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
                this.a.feedback('Permiso de micrófono denegado', 'danger', 3500);
                this.detener();
                this.a.cambioEstado?.('voz', false);
            } else if (e.error === 'network') {
                this.a.estado('Voz: se necesita conexión a internet para reconocer la voz');
            }
        };
        // Chrome detiene el reconocimiento tras un silencio: se reinicia mientras esté activo
        this.rec.onend = () => {
            if (this.activo) {
                try { this.rec.start(); } catch { /* ya iniciado */ }
            }
        };
    }

    iniciar() {
        if (!this.soportado) {
            throw new Error('Este navegador no tiene reconocimiento de voz. Usa Chrome o Edge.');
        }
        this.activo = true;
        try { this.rec.start(); } catch { /* ya iniciado */ }
        this.a.estado('🎤 Escuchando… di "avanza", "gira a la derecha", "enciende la luz" o "alto"');
    }

    detener() {
        this.activo = false;
        this._cancelarTimer(true);
        try { this.rec?.abort(); } catch { /* nada */ }
    }

    _cancelarTimer(soltar) {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
            if (soltar) this.a.soltar();
        }
    }

    _resultado(e) {
        for (let i = e.resultIndex; i < e.results.length; i++) {
            const res = e.results[i];
            const texto = res[0].transcript;

            // Seguridad: un "alto" se atiende aunque la frase aún no termine
            if (!res.isFinal) {
                if (this.ultimoParoInterino !== i && interpretarVoz(texto)?.tipo === 'parar') {
                    this.ultimoParoInterino = i;
                    this._ejecutar({ tipo: 'parar' }, texto);
                }
                continue;
            }
            if (this.ultimoParoInterino === i) continue; // ya se detuvo con el resultado parcial

            // Comandos propios de otros modos (p. ej. "salir" en VR celular)
            if (this.a.interceptar?.(texto)) {
                this.a.estado(`🎤 "${texto.trim()}"`);
                continue;
            }

            // Secuencias y maniobras ("haz un cuadrado", "avanza y luego gira") las resuelve el asistente
            if (this.a.consultarAsistente && esFraseCompleja(texto)) {
                this._cancelarTimer(false);
                this.a.estado(`🎤 "${texto.trim()}" → Asistente IA`);
                this.a.consultarAsistente(texto);
                continue;
            }

            let accion = null;
            let oido = texto;
            for (let k = 0; k < res.length && !accion; k++) {
                accion = interpretarVoz(res[k].transcript);
                if (accion) oido = res[k].transcript;
            }
            if (accion) this._ejecutar(accion, oido);
            else if (this.a.consultarAsistente && texto.trim().split(/\s+/).length >= 3) {
                this.a.estado(`🎤 "${texto.trim()}" → Asistente IA`);
                this.a.consultarAsistente(texto);
            } else this.a.estado(`🎤 Escuché "${texto.trim()}" pero no es un comando`);
        }
    }

    _ejecutar(accion, oido) {
        const frase = `"${oido.trim()}"`;
        switch (accion.tipo) {
            case 'parar':
                this._cancelarTimer(false);
                this.a.parar();
                this.a.estado(`🎤 ${frase} → Detener`);
                break;
            case 'mover':
                this._cancelarTimer(false);
                this.a.presionar(accion.cmd);
                this.timer = setTimeout(() => {
                    this.timer = null;
                    this.a.soltar();
                }, accion.segundos * 1000);
                this.a.estado(`🎤 ${frase} → ${nombreComando(accion.cmd)} (${accion.segundos} s)`);
                break;
            case 'accesorio': {
                const actual = this.a.estadoAccesorio(accion.cmd);
                if (accion.deseado !== null && actual !== null && actual === accion.deseado) {
                    this.a.estado(`🎤 ${frase} → ${nombreComando(accion.cmd)} ya está ${accion.deseado ? 'activada' : 'desactivada'}`);
                    break;
                }
                this.a.accesorio(accion.cmd);
                this.a.estado(`🎤 ${frase} → ${nombreComando(accion.cmd)}`);
                break;
            }
            case 'demo':
                if (this.a.iniciarDemo(accion.texto)) this.a.estado(`🎤 ${frase} → Iniciar demo`);
                else this.a.estado(`🎤 ${frase} → no encontré esa demo`);
                break;
            case 'cancelar_demo':
                this.a.cancelarDemo();
                this.a.estado(`🎤 ${frase} → Cancelar demo`);
                break;
        }
    }
}

// =============================================================================
// GESTOS: MediaPipe Gesture Recognizer (modelo de IA que corre en el navegador)
// =============================================================================

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const doblado = (lm, tip, pip) => dist(lm[tip], lm[0]) < dist(lm[pip], lm[0]) * 1.05;

/**
 * Clasifica la mano detectada.
 * - Índice extendido (resto doblado): mueve hacia donde apunta (arriba avanza, abajo retrocede, lados gira).
 * - Palma abierta o puño: detener. Pulgar arriba/abajo: subir/bajar brazo.
 * - Victoria ✌: luz. "Te quiero" 🤟: sonido.
 * Las coordenadas x se interpretan como en un espejo (lo que ve el usuario).
 */
export function clasificarMano(lm, gesto = 'None', score = 0) {
    if (!lm || lm.length < 21) return null;

    // Índice recto: la punta queda lejos del nudillo y más lejos de la muñeca que el nudillo
    const indice = dist(lm[8], lm[5]) > dist(lm[6], lm[5]) * 1.8 && dist(lm[8], lm[0]) > dist(lm[5], lm[0]);
    const otrosDoblados = doblado(lm, 12, 10) && doblado(lm, 16, 14) && doblado(lm, 20, 18);
    if (indice && otrosDoblados && gesto !== 'Victory' && gesto !== 'ILoveYou') {
        const vx = lm[8].x - lm[5].x;
        const vy = lm[8].y - lm[5].y;
        if (Math.abs(vy) >= Math.abs(vx)) {
            return { tipo: 'mover', cmd: vy < 0 ? 'AVANZAR' : 'RETROCEDER', clave: vy < 0 ? '☝ Arriba' : '👇 Abajo' };
        }
        // Espejo: si en la imagen apunta a la izquierda (x baja), el usuario apunta a su derecha
        return vx < 0
            ? { tipo: 'mover', cmd: 'GIRAR_DERECHA', clave: '👉 Derecha' }
            : { tipo: 'mover', cmd: 'GIRAR_IZQUIERDA', clave: '👈 Izquierda' };
    }

    if (score < 0.55) return null;
    switch (gesto) {
        case 'Open_Palm': return { tipo: 'parar', clave: '✋ Palma: Detener' };
        case 'Closed_Fist': return { tipo: 'parar', clave: '✊ Puño: Detener' };
        case 'Thumb_Up': return { tipo: 'mover', cmd: 'SUBIR_BRAZO', clave: '👍 Subir brazo' };
        case 'Thumb_Down': return { tipo: 'mover', cmd: 'BAJAR_BRAZO', clave: '👎 Bajar brazo' };
        case 'Victory': return { tipo: 'accesorio', cmd: 'LUZ', clave: '✌ Luz' };
        case 'ILoveYou': return { tipo: 'accesorio', cmd: 'SONIDO', clave: '🤟 Sonido' };
        case 'Pointing_Up': return { tipo: 'mover', cmd: 'AVANZAR', clave: '☝ Arriba' };
        default: return null;
    }
}

const CONEXIONES = [
    [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
    [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]
];

export class ControlGestos {
    constructor(acciones, { video, canvas, etiqueta }) {
        this.a = acciones;
        this.video = video;
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.etiqueta = etiqueta;
        this.activo = false;
        this.reconocedor = null;
        this.stream = null;
        this.raf = 0;
        this.ultimoTiempoVideo = -1;

        // Estabilización: una acción se ejecuta tras varios cuadros iguales seguidos
        this.candidata = null;
        this.cuadros = 0;
        this.actual = null;           // clave de la acción vigente
        this.sosteniendo = false;     // si este control tiene presionado un movimiento
        this.ultimoInstantaneo = 0;
    }

    async iniciar() {
        if (!navigator.mediaDevices?.getUserMedia) {
            throw new Error('Este navegador no permite usar la cámara (se necesita HTTPS).');
        }
        this.activo = true;
        this.a.estado('✋ Cargando modelo de IA de gestos…');

        if (!this.reconocedor) {
            const vision = await import(`${MP_BASE}/vision_bundle.mjs`);
            const fileset = await vision.FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
            const opciones = (delegate) => ({
                baseOptions: { modelAssetPath: MP_MODELO, delegate },
                runningMode: 'VIDEO',
                numHands: 1,
                minHandDetectionConfidence: 0.6,
                minHandPresenceConfidence: 0.6,
                minTrackingConfidence: 0.5
            });
            try {
                this.reconocedor = await vision.GestureRecognizer.createFromOptions(fileset, opciones('GPU'));
            } catch {
                this.reconocedor = await vision.GestureRecognizer.createFromOptions(fileset, opciones('CPU'));
            }
        }
        if (!this.activo) return; // se desactivó mientras cargaba

        this.a.estado('✋ Permite el acceso a la cámara…');
        this.stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
            audio: false
        });
        if (!this.activo) {
            this._apagarCamara();
            return;
        }
        this.video.srcObject = this.stream;
        await this.video.play();
        this.a.estado('✋ Gestos activos: ☝ apunta para mover, ✋ palma para detener');
        this._bucle();
    }

    detener() {
        this.activo = false;
        cancelAnimationFrame(this.raf);
        this._apagarCamara();
        this._aplicar(null);
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        if (this.etiqueta) this.etiqueta.textContent = '';
    }

    _apagarCamara() {
        this.stream?.getTracks().forEach((t) => t.stop());
        this.stream = null;
        this.video.srcObject = null;
    }

    _bucle() {
        if (!this.activo) return;
        this.raf = requestAnimationFrame(() => this._bucle());
        if (this.video.readyState < 2 || this.video.currentTime === this.ultimoTiempoVideo) return;
        this.ultimoTiempoVideo = this.video.currentTime;

        let res;
        try {
            res = this.reconocedor.recognizeForVideo(this.video, performance.now());
        } catch (e) {
            console.error('Error de reconocimiento de gestos:', e);
            return;
        }

        const lm = res.landmarks?.[0];
        const g = res.gestures?.[0]?.[0];
        this._dibujar(lm);
        const accion = clasificarMano(lm, g?.categoryName, g?.score || 0);
        this._estabilizar(accion);
    }

    _estabilizar(accion) {
        const clave = accion ? `${accion.tipo}:${accion.cmd || ''}` : null;
        if (clave === this.candidata) this.cuadros++;
        else {
            this.candidata = clave;
            this.cuadros = 1;
        }
        // Soltar la mano es inmediato; las acciones nuevas requieren 3 cuadros seguidos
        const necesarios = clave === null ? 2 : 3;
        if (this.cuadros >= necesarios && clave !== this.actual) {
            this.actual = clave;
            this._aplicar(accion);
        }
        if (this.etiqueta) this.etiqueta.textContent = accion ? accion.clave : '';
    }

    _aplicar(accion) {
        if (!accion) {
            if (this.sosteniendo) {
                this.sosteniendo = false;
                this.a.soltar();
            }
            this.actual = null;
            return;
        }
        if (accion.tipo === 'mover') {
            this.sosteniendo = true;
            this.a.presionar(accion.cmd);
            this.a.estado(`✋ ${accion.clave} → ${nombreComando(accion.cmd)}`);
        } else if (accion.tipo === 'parar') {
            this.sosteniendo = false;
            this.a.parar();
            this.a.estado(`✋ ${accion.clave}`);
        } else if (accion.tipo === 'accesorio') {
            if (this.sosteniendo) {
                this.sosteniendo = false;
                this.a.soltar();
            }
            const ahora = performance.now();
            if (ahora - this.ultimoInstantaneo > 1500) {
                this.ultimoInstantaneo = ahora;
                this.a.accesorio(accion.cmd);
                this.a.estado(`✋ ${accion.clave}`);
            }
        }
    }

    _dibujar(lm) {
        const c = this.canvas;
        if (c.width !== this.video.videoWidth && this.video.videoWidth) {
            c.width = this.video.videoWidth;
            c.height = this.video.videoHeight;
        }
        const ctx = this.ctx;
        ctx.clearRect(0, 0, c.width, c.height);
        if (!lm) return;
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(92, 200, 255, .9)';
        for (const [i, j] of CONEXIONES) {
            ctx.beginPath();
            ctx.moveTo(lm[i].x * c.width, lm[i].y * c.height);
            ctx.lineTo(lm[j].x * c.width, lm[j].y * c.height);
            ctx.stroke();
        }
        ctx.fillStyle = '#ffb43a';
        for (const p of lm) {
            ctx.beginPath();
            ctx.arc(p.x * c.width, p.y * c.height, 4, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

// =============================================================================
// GIROSCOPIO: inclinar el celular para conducir
// =============================================================================

/**
 * Convierte la inclinación (relativa a la posición calibrada) en un comando.
 * adelante > 0 = parte superior del celular alejándose del usuario; derecha > 0 = inclinado a la derecha.
 */
export function comandoPorInclinacion(adelante, derecha, actual = null, umbral = 14, umbralSoltar = 9) {
    const absA = Math.abs(adelante);
    const absD = Math.abs(derecha);
    // Histéresis: se mantiene el comando actual mientras siga pasando el umbral de soltar
    if (actual) {
        const sigue =
            (actual === 'AVANZAR' && adelante > umbralSoltar && absA >= absD * 0.8) ||
            (actual === 'RETROCEDER' && adelante < -umbralSoltar && absA >= absD * 0.8) ||
            (actual === 'GIRAR_DERECHA' && derecha > umbralSoltar && absD >= absA * 0.8) ||
            (actual === 'GIRAR_IZQUIERDA' && derecha < -umbralSoltar && absD >= absA * 0.8);
        if (sigue) return actual;
    }
    if (Math.max(absA, absD) < umbral) return null;
    if (absA >= absD) return adelante > 0 ? 'AVANZAR' : 'RETROCEDER';
    return derecha > 0 ? 'GIRAR_DERECHA' : 'GIRAR_IZQUIERDA';
}

// Qué comando produce cada dirección de inclinación según el modo del giroscopio
export const MAPA_GIRO = {
    conducir: {
        AVANZAR: 'AVANZAR',               // adelante
        RETROCEDER: 'RETROCEDER',         // hacia ti
        GIRAR_IZQUIERDA: 'GIRAR_IZQUIERDA',
        GIRAR_DERECHA: 'GIRAR_DERECHA'
    },
    brazo: {
        AVANZAR: 'BAJAR_BRAZO',           // adelante = bajar (como empujar una palanca)
        RETROCEDER: 'SUBIR_BRAZO',        // hacia ti = subir (como jalar una palanca)
        GIRAR_IZQUIERDA: 'MOTOR_IZQUIERDA',
        GIRAR_DERECHA: 'MOTOR_DERECHA'
    },
    // Accesorios: un toque por inclinación (hay que volver al centro para activar otro)
    accesorios: {
        AVANZAR: 'VELOCIDAD',             // adelante = turbo
        RETROCEDER: null,                 // hacia ti = sin acción
        GIRAR_IZQUIERDA: 'LUZ',
        GIRAR_DERECHA: 'SONIDO'
    }
};
const MODOS_INSTANTANEOS = new Set(['accesorios']);

const TEXTO_MODO = {
    conducir: '📱 Modo conducir: inclina adelante/atrás para avanzar/retroceder y a los lados para girar',
    brazo: '📱 Modo brazo: inclina hacia ti para subir, adelante para bajar y a los lados para los motores',
    accesorios: '📱 Modo accesorios: inclina adelante = turbo, izquierda = luz, derecha = sonido (regresa al centro entre uno y otro)'
};

export class ControlGiroscopio {
    constructor(acciones, { indicador, punto }) {
        this.a = acciones;
        this.indicador = indicador;
        this.punto = punto;
        this.activo = false;
        this.base = null;
        this.dir = null;   // dirección de inclinación actual (AVANZAR, RETROCEDER, GIRAR_*)
        this.cmd = null;   // comando enviado según el modo
        this.modo = 'conducir';
        this._onOri = (e) => this._orientacion(e);
    }

    // Cambia entre 'conducir', 'brazo' y 'accesorios'. Si había un movimiento en curso, se detiene.
    setModo(modo) {
        if (!MAPA_GIRO[modo] || modo === this.modo) return;
        this.modo = modo;
        if (this.cmd) {
            this.cmd = null;
            this.a.soltar();
        }
        // En accesorios se ignora la inclinación actual hasta volver al centro (evita activar uno sin querer)
        this.dir = MODOS_INSTANTANEOS.has(modo) ? 'ESPERAR_CENTRO' : null;
        if (this.activo) this.a.estado(TEXTO_MODO[modo]);
    }

    async iniciar() {
        if (typeof window.DeviceOrientationEvent === 'undefined') {
            throw new Error('Este dispositivo no tiene giroscopio. Úsalo desde tu celular.');
        }
        // iPhone / iPad: hay que pedir permiso con un toque del usuario
        if (typeof DeviceOrientationEvent.requestPermission === 'function') {
            const r = await DeviceOrientationEvent.requestPermission();
            if (r !== 'granted') throw new Error('Permiso de movimiento denegado.');
        }
        this.activo = true;
        this.base = null;
        this.cmd = null;
        this.recibido = false;
        window.addEventListener('deviceorientation', this._onOri);
        this.a.estado('📱 Sostén el celular en la posición neutra… (calibrando)');

        await new Promise((r) => setTimeout(r, 1500));
        if (this.activo && !this.recibido) {
            this.detener();
            throw new Error('No se detectó giroscopio en este dispositivo. Úsalo desde tu celular.');
        }
    }

    detener() {
        this.activo = false;
        window.removeEventListener('deviceorientation', this._onOri);
        this.dir = null;
        if (this.cmd) {
            this.cmd = null;
            this.a.soltar();
        }
        if (this.punto) this.punto.style.transform = 'translate(-50%, -50%)';
    }

    // Recalibra la posición neutra con la inclinación actual
    calibrar() {
        this.base = null;
    }

    _orientacion(e) {
        if (!this.activo || e.beta === null || e.gamma === null) return;
        if (!this.recibido) {
            this.recibido = true;
            this.a.estado(TEXTO_MODO[this.modo]);
        }

        // Ejes según la orientación de la pantalla
        const ang = ((screen.orientation?.angle ?? window.orientation ?? 0) + 360) % 360;
        let pitch, roll;
        if (ang === 90) { pitch = e.gamma; roll = e.beta; }
        else if (ang === 270) { pitch = -e.gamma; roll = -e.beta; }
        else if (ang === 180) { pitch = -e.beta; roll = -e.gamma; }
        else { pitch = e.beta; roll = e.gamma; }

        if (!this.base) {
            this.base = { pitch, roll };
            return;
        }
        const adelante = -(pitch - this.base.pitch); // alejar la parte superior = avanzar
        const derecha = roll - this.base.roll;

        if (this.punto) {
            const x = Math.max(-1, Math.min(1, derecha / 30)) * 40;
            const y = Math.max(-1, Math.min(1, -adelante / 30)) * 40;
            this.punto.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
        }

        const previa = this.dir === 'ESPERAR_CENTRO' ? null : this.dir;
        const dir = comandoPorInclinacion(adelante, derecha, previa);

        // Modo accesorios: un solo toque por inclinación, sin "mantener"
        if (MODOS_INSTANTANEOS.has(this.modo)) {
            if (this.dir === 'ESPERAR_CENTRO') {
                if (dir === null) {
                    this.dir = null;
                    this.a.estado('📱 Listo: inclina adelante = turbo, izquierda = luz, derecha = sonido');
                }
                return;
            }
            if (dir === this.dir) return;
            this.dir = dir;
            const acc = dir ? MAPA_GIRO[this.modo][dir] : null;
            if (acc) {
                this.a.accesorio(acc);
                this.a.estado(`📱 Inclinación → ${nombreComando(acc)} (regresa al centro para otro)`);
            } else if (!dir) {
                this.a.estado('📱 Centro: listo para otro accesorio');
            }
            return;
        }

        if (dir === this.dir) return;
        this.dir = dir;
        const nuevo = dir ? MAPA_GIRO[this.modo][dir] : null;
        this.cmd = nuevo;
        if (nuevo) {
            this.a.presionar(nuevo);
            this.a.estado(`📱 Inclinación → ${nombreComando(nuevo)}`);
        } else {
            this.a.soltar();
            this.a.estado('📱 Posición neutra → Detener');
        }
    }
}
