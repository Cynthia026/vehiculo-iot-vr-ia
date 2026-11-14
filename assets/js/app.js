// assets/js/app.js
import { api } from './api.js?v=24';
import { wsManager } from './websocket.js?v=24';
import { ui, normalizar } from './ui.js?v=24';
import { CONFIG } from './config.js?v=24';
import { adminManager } from './admin.js?v=24';
import { ControlVoz, ControlGestos, ControlGiroscopio } from './control-ia.js?v=24';
import { AsistenteIA, describirPaso } from './asistente-ia.js?v=24';

let catalogoComandos = [];
let idComandoDetener = null;
let vistaActual = 'control'; // 'control' | 'monitoreo' | 'admin'
let comandoActivoActual = null; // Evita envíos duplicados mientras se mantiene presionado un botón
let asistente = null;           // Asistente IA conversacional (plan en curso se cancela con Detener)
let vrCelular = null;           // Modo VR celular (Cardboard)
let controlIA = null;           // Acceso a los modos Voz / Gestos / Giroscopio

let reintentoTimer = null;
let primerFallo = true;

// --- MODO SIMULACIÓN ---
// Mientras AWS no responde, todos los botones siguen funcionando: mueven el gemelo 3D,
// registran un historial local en Monitoreo y ejecutan demos locales. No se envía nada al vehículo real.
let modoSimulacion = true;
const historialSim = [];
let demoSimTimers = [];

const DEMOS_SIM = [
    {
        id_demo: 'sim-recorrido',
        nombre: 'Recorrido cuadrado (simulación)',
        pasos: [
            ['AVANZAR', 1400], ['GIRAR_DERECHA', 1000],
            ['AVANZAR', 1400], ['GIRAR_DERECHA', 1000],
            ['AVANZAR', 1400], ['GIRAR_DERECHA', 1000],
            ['AVANZAR', 1400], ['GIRAR_DERECHA', 1000]
        ]
    },
    {
        id_demo: 'sim-excavacion',
        nombre: 'Excavación (simulación)',
        pasos: [
            ['LUZ', 400], ['BAJAR_BRAZO', 1100], ['MOTOR_IZQUIERDA', 1100],
            ['SUBIR_BRAZO', 1100], ['MOTOR_DERECHA', 1100], ['BAJAR_BRAZO', 700], ['LUZ', 400]
        ]
    },
    {
        id_demo: 'sim-exhibicion',
        nombre: 'Exhibición (simulación)',
        pasos: [
            ['SONIDO', 700], ['VELOCIDAD', 400], ['GIRAR_IZQUIERDA', 2400],
            ['AVANZAR', 1100], ['RETROCEDER', 1100], ['VELOCIDAD', 400], ['SONIDO', 700]
        ]
    }
];

// Mapa de respaldo por ID de comando en caso de que aún no esté en catálogo
const MAPA_COMANDOS_ID = {
    1: 'AVANZAR',
    2: 'RETROCEDER',
    3: 'GIRAR_IZQUIERDA',
    4: 'GIRAR_DERECHA',
    5: 'SUBIR_BRAZO',
    6: 'BAJAR_BRAZO',
    7: 'MOTOR_IZQUIERDA',
    8: 'MOTOR_DERECHA',
    9: 'VELOCIDAD',
    10: 'SONIDO',
    11: 'LUZ',
    12: 'Detener'
};

const MOVIMIENTOS = new Set([
    'AVANZAR', 'RETROCEDER', 'GIRAR_IZQUIERDA', 'GIRAR_DERECHA',
    'SUBIR_BRAZO', 'BAJAR_BRAZO', 'MOTOR_IZQUIERDA', 'MOTOR_DERECHA'
]);

// "GIRAR_IZQUIERDA" -> "Girar izquierda"
const etiquetaCmd = (n) => {
    const t = String(n || '').replace(/_/g, ' ').toLowerCase();
    return t.charAt(0).toUpperCase() + t.slice(1);
};

async function inicializar() {
    try {
        // 1. Escenario 3D, consola de botones 3D y modo VR (opcional: si falla, el control sigue funcionando)
        let scene3d = null;
        let vrManager = null;
        let consola3d = null;
        try {
            const { Scene3DManager } = await import('./scene3d.js?v=24');
            const { VRManager } = await import('./vr-controls.js?v=24');
            const { Consola3D } = await import('./botones3d.js?v=24');
            const { VRCelular, vrCelularDisponible } = await import('./vr-celular.js?v=24');
            scene3d = new Scene3DManager('three-canvas');

            const callbacksBotones = {
                // Movimiento: mientras se mantiene presionado; accesorios: un solo envío
                onPress: (normCmd, instantaneo = false) => {
                    if (instantaneo) accionAccesorio(normCmd);
                    else presionarBotonDireccion(normCmd);
                },
                onRelease: () => soltarBotonDireccion(),
                onStop: () => pararTodo()
            };

            consola3d = new Consola3D(scene3d, callbacksBotones);

            // VR celular (Cardboard): solo en celulares sin WebXR, así no aparece en Meta Quest
            vrCelular = new VRCelular(scene3d, {
                presionar: (cmd) => presionarBotonDireccion(cmd),
                soltar: () => soltarBotonDireccion(),
                accesorio: (cmd) => accionAccesorio(cmd),
                parar: () => pararTodo(),
                activarVoz: () => controlIA?.activar('voz'),
                alSalir: () => ui.showFeedback('Saliste de VR celular', 'info', 2000)
            });
            ui.vrCelular = vrCelular;
            configurarVRCelular(vrCelularDisponible);

            vrManager = new VRManager(scene3d, {
                onPressCommand: (normCmd, isInstant = false) => callbacksBotones.onPress(normCmd, isInstant),
                onReleaseCommand: callbacksBotones.onRelease,
                onStop: callbacksBotones.onStop,
                onStartDemo: (idDemo) => iniciarDemo(idDemo),
                onCancelDemo: () => cancelarDemo(),
                onFeedback: (msg, type, duration) => ui.showFeedback(msg, type, duration)
            });
        } catch (err3d) {
            console.error('Escenario 3D/VR no disponible:', err3d);
            document.getElementById('btn-vr')?.setAttribute('disabled', '');
            document.getElementById('btn-reset-cam')?.setAttribute('disabled', '');
        }

        ui.attach3DAndVR(scene3d, vrManager, consola3d);

        // Velocímetro (se actualiza ~10 veces por segundo con la velocidad real del gemelo 3D)
        if (scene3d) {
            let acumulado = 0;
            scene3d.registerVRUpdate((dt) => {
                acumulado += dt;
                if (acumulado < 0.1) return;
                acumulado = 0;
                const ms = scene3d.motionState;
                const kmh = scene3d.getVelocidadKmh();
                let estado = 'Detenido';
                if (ms.drive > 0) estado = kmh > 0.05 ? 'Avanzando' : 'Bloqueado (borde)';
                else if (ms.drive < 0) estado = kmh > 0.05 ? 'Retrocediendo' : 'Bloqueado (borde)';
                else if (ms.turn > 0) estado = 'Girando a la izquierda';
                else if (ms.turn < 0) estado = 'Girando a la derecha';
                ui.actualizarVelocimetro(kmh, scene3d.getVelocidadMaxKmh(), ms.highSpeed, estado);
            });
        }

        // 2. Mostrar la interfaz de inmediato en MODO SIMULACIÓN hasta que AWS responda
        activarSimulacion();
        configurarControles(scene3d);
        configurarControlIA();

        // 3. Inicializar módulo de Administración (Práctica 4.3: RBAC, inventario, demos y sesiones)
        adminManager.init({
            onUnitChanged: async (idVehiculoRds) => {
                wsManager.reconnectForVehicle(idVehiculoRds);
                await cargarCatalogos();
                if (vistaActual === 'monitoreo') {
                    await cargarDatosMonitoreo();
                }
            },
            onStopVehicle: async () => {
                pararTodo();
            }
        });

        // 4. Conectar WSS y enlazar la escucha de mensajes
        wsManager.onMessage = procesarMensajeWSS;
        wsManager.connect();

        // 5. Verificar estado de Amazon RDS
        await verificarRDS();

        // 6. Cargar Catálogos para Control y sincronizar inventario con RDS
        await cargarCatalogos();
        adminManager.sincronizarDesdeRds();

    } catch (error) {
        console.error('Error en la inicialización:', error);
        ui.showFeedback('Error de conexión con el servidor AWS', 'danger');
    }
}

// Configura los eventos de botones direccionales, teclado, pestañas y demos
function configurarControles(scene3d) {
    // Botón centrar cámara 3D
    document.getElementById('btn-reset-cam')?.addEventListener('click', () => {
        ui.playSound('tap');
        scene3d?.resetCamera();
    });

    // Configurar botones direccionales (Movimiento + Brazo y motores)
    document.querySelectorAll('.dir-btn').forEach((btn) => {
        const cmdNorm = btn.dataset.cmd;

        btn.addEventListener('pointerdown', (e) => {
            if (btn.disabled) return;
            e.preventDefault();
            presionarBotonDireccion(cmdNorm);
        });

        const soltar = (e) => {
            if (btn.disabled) return;
            e.preventDefault();
            soltarBotonDireccion();
        };

        btn.addEventListener('pointerup', soltar);
        btn.addEventListener('pointerleave', soltar);
        btn.addEventListener('pointercancel', soltar);
    });

    // Soporte de teclado en escritorio (WASD / Flechas / Espacio = Detener)
    const mapaTeclas = {
        'KeyW': 'AVANZAR',
        'ArrowUp': 'AVANZAR',
        'KeyS': 'RETROCEDER',
        'ArrowDown': 'RETROCEDER',
        'KeyA': 'GIRAR_IZQUIERDA',
        'ArrowLeft': 'GIRAR_IZQUIERDA',
        'KeyD': 'GIRAR_DERECHA',
        'ArrowRight': 'GIRAR_DERECHA',
        'KeyR': 'SUBIR_BRAZO',
        'KeyF': 'BAJAR_BRAZO',
        'KeyQ': 'MOTOR_IZQUIERDA',
        'KeyE': 'MOTOR_DERECHA'
    };

    document.addEventListener('keydown', (e) => {
        if (e.repeat || vistaActual !== 'control') return;
        if (e.target.closest?.('select, input, textarea')) return;
        if (e.code === 'Space') {
            e.preventDefault();
            pararTodo();
            return;
        }
        const cmd = mapaTeclas[e.code];
        if (cmd) presionarBotonDireccion(cmd);
    });

    document.addEventListener('keyup', (e) => {
        if (vistaActual !== 'control') return;
        if (mapaTeclas[e.code]) {
            soltarBotonDireccion();
        }
    });

    // Botón Detener
    document.getElementById('btn-stop').addEventListener('click', () => pararTodo());

    document.getElementById('demo-select').addEventListener('change', () => {
        ui.playSound('tap');
    });

    document.getElementById('btn-demo-start').addEventListener('click', () => {
        iniciarDemo(document.getElementById('demo-select').value);
    });

    document.getElementById('btn-demo-cancel').addEventListener('click', () => cancelarDemo());

    // Pestañas SPA (Control | Monitoreo | Administración)
    document.getElementById('btn-tab-control').addEventListener('click', () => {
        vistaActual = 'control';
        ui.switchView('control');
    });

    document.getElementById('btn-tab-monitoreo').addEventListener('click', () => {
        vistaActual = 'monitoreo';
        ui.switchView('monitoreo');
        cargarDatosMonitoreo();
    });

    const btnTabAdmin = document.getElementById('btn-tab-admin');
    if (btnTabAdmin) {
        btnTabAdmin.addEventListener('click', () => {
            vistaActual = 'admin';
            ui.switchView('admin');
            adminManager.sincronizarDesdeRds();
        });
    }
}

// --- CONTROL CON IA: voz, gestos (cámara) y giroscopio --------------------------

function configurarControlIA() {
    const estadoEl = document.getElementById('ia-estado');
    const normalizarTexto = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    const acciones = {
        presionar: (cmd) => presionarBotonDireccion(cmd),
        soltar: () => soltarBotonDireccion(),
        accesorio: (cmd) => accionAccesorio(cmd),
        parar: () => pararTodo(),
        cancelarDemo: () => cancelarDemo(),
        estado: (texto) => {
            if (estadoEl) estadoEl.textContent = texto;
            vrCelular?.mostrarEstado(texto);
        },
        interceptar: (texto) => vrCelular?.comandoVoz(texto) || false,
        feedback: (msg, tipo, dur) => ui.showFeedback(msg, tipo, dur),
        cambioEstado: (modo, activo) => marcar(modo, activo),
        // Frases complejas de la voz ("haz un cuadrado y luego enciende la luz") van al asistente
        consultarAsistente: (texto) => abrirAsistente?.(texto),
        // Estado actual de Luz / Velocidad para "enciende" / "apaga"
        estadoAccesorio: (cmd) => {
            const ms = ui.scene3d?.motionState;
            if (!ms) return null;
            if (cmd === 'LUZ') return ms.lightsOn;
            if (cmd === 'VELOCIDAD') return ms.highSpeed;
            return null;
        },
        // Busca la demo por nombre ("excavación", "recorrido") o la primera si no se dice cuál
        iniciarDemo: (texto) => {
            const select = document.getElementById('demo-select');
            const opciones = [...select.options].filter((o) => o.value);
            if (!opciones.length) return false;
            const palabras = normalizarTexto(texto).split(/\s+/).filter((p) => p.length > 3);
            const numero = parseInt(texto, 10);
            let opcion = null;
            if (!Number.isNaN(numero)) opcion = opciones[numero - 1];
            if (!opcion && palabras.length) opcion = opciones.find((o) => palabras.some((p) => normalizarTexto(o.textContent).includes(p)));
            if (!opcion && !palabras.length) opcion = opciones[0];
            if (!opcion) return false;
            select.value = opcion.value;
            iniciarDemo(opcion.value);
            return true;
        }
    };

    const modos = {
        voz: {
            btn: document.getElementById('btn-ia-voz'),
            ctrl: new ControlVoz(acciones)
        },
        gestos: {
            btn: document.getElementById('btn-ia-gestos'),
            panel: document.getElementById('ia-camara'),
            ctrl: new ControlGestos(acciones, {
                video: document.getElementById('ia-video'),
                canvas: document.getElementById('ia-canvas'),
                etiqueta: document.getElementById('ia-gesto')
            })
        },
        giro: {
            btn: document.getElementById('btn-ia-giro'),
            panel: document.getElementById('ia-giro'),
            ctrl: new ControlGiroscopio(acciones, {
                punto: document.getElementById('ia-giro-punto')
            })
        }
    };

    function marcar(modo, activo) {
        const m = modos[modo];
        m.activo = activo;
        m.btn.classList.toggle('activo', activo);
        m.btn.setAttribute('aria-pressed', String(activo));
        m.panel?.classList.toggle('d-none', !activo);
        document.querySelector('.area-ia')?.classList.toggle('con-modo', Object.values(modos).some((x) => x.activo));
    }

    const mensajeError = (modo, e) => {
        if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError') {
            return modo === 'gestos' ? 'Permiso de cámara denegado.' : 'Permiso denegado.';
        }
        if (e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError') return 'No se encontró una cámara en este dispositivo.';
        if (modo === 'gestos' && /import|fetch|module|Failed/i.test(String(e?.message))) {
            return 'No se pudo cargar el modelo de IA de gestos. Revisa tu conexión a internet.';
        }
        return e?.message || 'No se pudo activar este modo.';
    };

    async function alternar(modo) {
        const m = modos[modo];
        if (m.activo) {
            m.ctrl.detener();
            marcar(modo, false);
            ui.playSound('cancel');
            acciones.estado('Modo desactivado.');
            return;
        }
        // Solo un método a la vez: se apaga el que estuviera activo (o cargando)
        Object.entries(modos).forEach(([otro, o]) => {
            if (otro !== modo && (o.activo || o.btn.classList.contains('cargando'))) {
                o.cancelado = true;
                o.ctrl.detener();
                marcar(otro, false);
            }
        });

        m.cancelado = false;
        m.btn.classList.add('cargando');
        if (modo === 'gestos') m.panel.classList.remove('d-none');
        try {
            await m.ctrl.iniciar();
            if (!m.ctrl.activo && modo !== 'voz') throw new Error('Activación cancelada.');
            marcar(modo, true);
            ui.playSound('start');
        } catch (e) {
            m.ctrl.detener();
            marcar(modo, false);
            if (m.cancelado) return;
            console.error(`Control con IA (${modo}):`, e);
            const msg = mensajeError(modo, e);
            acciones.estado(`⚠ ${msg}`);
            ui.showFeedback(msg, 'warning', 4000);
        } finally {
            m.btn.classList.remove('cargando');
        }
    }

    modos.voz.btn.addEventListener('click', () => alternar('voz'));
    modos.gestos.btn.addEventListener('click', () => alternar('gestos'));
    modos.giro.btn.addEventListener('click', () => alternar('giro'));
    // Selector de modo del giroscopio: Conducir / Brazo y motores / Accesorios
    document.querySelectorAll('.ia-giro-modo').forEach((btn) => {
        btn.addEventListener('click', () => {
            const modo = btn.dataset.modo;
            modos.giro.ctrl.setModo(modo);
            document.querySelectorAll('.ia-giro-modo').forEach((b) => {
                const activo = b === btn;
                b.classList.toggle('activo', activo);
                b.setAttribute('aria-pressed', String(activo));
            });
            document.getElementById('ia-giro-mira').dataset.modo = modo;
            ui.playSound('tap');
            ui.vibrar(10);
        });
    });

    document.getElementById('btn-ia-calibrar').addEventListener('click', () => {
        modos.giro.ctrl.calibrar();
        acciones.estado('📱 Posición neutra recalibrada');
        ui.playSound('tap');
    });

    const btnAyuda = document.getElementById('btn-ia-ayuda');
    btnAyuda.addEventListener('click', () => {
        const ayuda = document.getElementById('ia-ayuda');
        const abierta = ayuda.classList.toggle('d-none') === false;
        btnAyuda.setAttribute('aria-expanded', String(abierta));
    });

    const abrirAsistente = configurarAsistente(acciones, modos);

    controlIA = {
        // Activa un modo si no está activo (lo usa VR celular para encender la voz)
        activar: (modo) => {
            if (modos[modo] && !modos[modo].activo && modos[modo].ctrl.soportado !== false) alternar(modo);
        }
    };

    // Al ocultar la página se apagan cámara, micrófono y giroscopio (y el vehículo se detiene)
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) return;
        Object.entries(modos).forEach(([modo, m]) => {
            if (m.activo) {
                m.ctrl.detener();
                marcar(modo, false);
            }
        });
    });
}

// --- VR CELULAR (Cardboard) --------------------------------------------------------

async function configurarVRCelular(disponible) {
    const btn = document.getElementById('btn-vr-celular');
    const intro = document.getElementById('vrc-intro');
    if (!btn || !(await disponible())) return;
    btn.classList.remove('d-none');

    btn.addEventListener('click', () => {
        ui.playSound('tap');
        intro.classList.remove('d-none');
    });
    document.getElementById('vrc-cancelar').addEventListener('click', () => intro.classList.add('d-none'));
    document.getElementById('vrc-comenzar').addEventListener('click', async () => {
        intro.classList.add('d-none');
        ui.playSound('start');
        await vrCelular.entrar();
    });
    document.getElementById('vrc-salir').addEventListener('click', () => vrCelular.salir());
}

// --- ASISTENTE IA CONVERSACIONAL ---------------------------------------------------

function configurarAsistente(acciones, modos) {
    const $ = (id) => document.getElementById(id);
    const panel = $('asistente');
    const lista = $('asis-mensajes');
    const entrada = $('asis-texto');
    const btnAbrir = $('btn-asistente');
    const formConfig = $('asis-config');

    asistente = new AsistenteIA({
        ...acciones,
        estadoVehiculo: () => ({
            luz: !!ui.scene3d?.motionState.lightsOn,
            turbo: !!ui.scene3d?.motionState.highSpeed,
            simulacion: modoSimulacion,
            demos: [...$('demo-select').options].filter((o) => o.value).map((o) => o.textContent)
        })
    });

    const actualizarModo = () => {
        $('asis-modo').textContent = asistente.iaConfigurada
            ? `IA de Claude · ${asistente.config.modelo}`
            : 'Intérprete local (sin IA conectada)';
    };
    actualizarModo();

    const abrir = (abierto) => {
        panel.classList.toggle('d-none', !abierto);
        btnAbrir.classList.toggle('activo', abierto);
        btnAbrir.setAttribute('aria-expanded', String(abierto));
        if (abierto) setTimeout(() => entrada.focus({ preventScroll: true }), 50);
    };

    const burbuja = (rol, texto) => {
        const div = document.createElement('div');
        div.className = `asis-msg ${rol}`;
        const p = document.createElement('p');
        p.textContent = texto;
        div.appendChild(p);
        lista.appendChild(div);
        lista.scrollTop = lista.scrollHeight;
        return div;
    };

    burbuja('bot', '¡Hola! Dime qué hacer con la excavadora. Por ejemplo: "haz un cuadrado", "gira 90 grados a la izquierda y enciende la luz" o "sube y baja el brazo 3 veces". Con el botón Detener paras cualquier plan.');

    let ocupado = false;
    async function enviar(texto) {
        texto = String(texto || '').trim();
        if (!texto || ocupado) return;
        ocupado = true;
        entrada.value = '';
        burbuja('user', texto);
        const pensando = burbuja('bot pensando', asistente.iaConfigurada ? 'Pensando…' : 'Interpretando…');

        let res;
        try {
            res = await asistente.procesar(texto);
        } catch (e) {
            res = { respuesta: `Ocurrió un error: ${e.message}`, pasos: [] };
        }
        pensando.remove();
        const msg = burbuja('bot', res.respuesta);
        if (res.error) {
            const nota = document.createElement('small');
            nota.className = 'asis-error';
            nota.textContent = `La IA no respondió (${res.error}). Usé el intérprete local.`;
            msg.appendChild(nota);
        }
        ocupado = false;

        if (!res.pasos.length) return;

        // Lista de pasos con progreso
        const ol = document.createElement('ol');
        ol.className = 'asis-pasos';
        res.pasos.forEach((p) => {
            const li = document.createElement('li');
            li.textContent = describirPaso(p);
            ol.appendChild(li);
        });
        msg.appendChild(ol);
        const pie = document.createElement('div');
        pie.className = 'asis-pie';
        const btnParar = document.createElement('button');
        btnParar.type = 'button';
        btnParar.className = 'asis-btn-parar';
        btnParar.innerHTML = '<i class="bi bi-stop-fill"></i> Detener plan';
        btnParar.onclick = () => pararTodo();
        pie.appendChild(btnParar);
        msg.appendChild(pie);
        lista.scrollTop = lista.scrollHeight;

        ui.playSound('start');
        const items = ol.children;
        let terminado = false;
        try {
            terminado = await asistente.ejecutar(res.pasos, (i, fase) => {
                items[i].classList.toggle('en-curso', fase === 'inicio');
                if (fase === 'fin') items[i].classList.add('hecho');
            });
        } catch (e) {
            console.error('Plan del asistente:', e);
        }
        [...items].forEach((li) => li.classList.remove('en-curso'));
        pie.innerHTML = terminado
            ? '<span class="asis-ok"><i class="bi bi-check-circle-fill"></i> Plan completado</span>'
            : '<span class="asis-cancel"><i class="bi bi-stop-circle-fill"></i> Plan detenido</span>';
        lista.scrollTop = lista.scrollHeight;
    }

    btnAbrir.addEventListener('click', () => {
        ui.playSound('tap');
        abrir(panel.classList.contains('d-none'));
    });
    $('asis-btn-cerrar').addEventListener('click', () => abrir(false));
    $('asis-btn-limpiar').addEventListener('click', () => {
        asistente.reiniciarConversacion();
        lista.innerHTML = '';
        burbuja('bot', 'Conversación nueva. ¿Qué hacemos?');
    });
    $('asis-form').addEventListener('submit', (e) => {
        e.preventDefault();
        enviar(entrada.value);
    });
    $('asis-sugerencias').addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON') enviar(e.target.textContent);
    });
    // Las teclas del chat no deben mover el vehículo
    entrada.addEventListener('keydown', (e) => e.stopPropagation());
    entrada.addEventListener('keyup', (e) => e.stopPropagation());

    // Configuración de la IA
    $('asis-btn-config').addEventListener('click', () => {
        const abierta = formConfig.classList.toggle('d-none') === false;
        if (abierta) {
            $('asis-api-key').value = asistente.config.apiKey || '';
            $('asis-proxy').value = asistente.config.proxyUrl || '';
            $('asis-modelo').value = asistente.config.modelo || '';
        }
    });
    formConfig.querySelectorAll('input').forEach((i) => {
        i.addEventListener('keydown', (e) => e.stopPropagation());
        i.addEventListener('keyup', (e) => e.stopPropagation());
    });
    formConfig.addEventListener('submit', (e) => {
        e.preventDefault();
        asistente.guardarConfig({
            apiKey: $('asis-api-key').value.trim(),
            proxyUrl: $('asis-proxy').value.trim(),
            modelo: $('asis-modelo').value.trim()
        });
        formConfig.classList.add('d-none');
        actualizarModo();
        burbuja('bot', asistente.iaConfigurada ? 'IA conectada. Ahora puedes hablarme con más libertad.' : 'Sin IA: usaré el intérprete local.');
    });
    $('asis-config-borrar').addEventListener('click', () => {
        asistente.guardarConfig({ apiKey: '', proxyUrl: '' });
        $('asis-api-key').value = '';
        $('asis-proxy').value = '';
        actualizarModo();
        burbuja('bot', 'Clave borrada de este navegador.');
    });

    // Dictado de una sola frase para el chat
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const btnMic = $('asis-mic');
    if (!SR) btnMic.classList.add('d-none');
    btnMic.addEventListener('click', () => {
        if (modos.voz.activo) {
            ui.showFeedback('El modo Voz ya está activo: di tu orden en voz alta', 'info', 2500);
            return;
        }
        const rec = new SR();
        rec.lang = 'es-MX';
        rec.interimResults = false;
        btnMic.classList.add('escuchando');
        rec.onresult = (e) => enviar(e.results[0][0].transcript);
        rec.onend = () => btnMic.classList.remove('escuchando');
        rec.onerror = () => btnMic.classList.remove('escuchando');
        try { rec.start(); } catch { btnMic.classList.remove('escuchando'); }
    });

    // Para la voz: abre el chat y envía la frase
    return (texto) => {
        abrir(true);
        enviar(texto);
    };
}

// Paro inmediato (botón Detener, barra espaciadora, botón rojo 3D y grip en VR)
function pararTodo() {
    if (asistente?.cancelar()) ui.showFeedback('Plan del asistente detenido', 'warning', 2000);
    cancelarDemoSimulada(false);
    ui.limpiarResaltadoDemo();
    ui.playSound('stop');
    ui.vibrar(25);
    detenerVehiculo();
}

function presionarBotonDireccion(cmdNorm) {
    if (!cmdNorm || comandoActivoActual === cmdNorm) return;

    // Validar permiso RBAC/BOLA antes de animar o enviar si estamos conectados a AWS
    if (!modoSimulacion) {
        const idLogico = CONFIG.VEHICULO_ACTIVO_LOGICO || CONFIG.VEHICULO_ID;
        const perm = adminManager.verificarPermisoOperacion(idLogico, false);
        if (!perm.ok) {
            ui.playSound('cancel');
            return;
        }
        const unidadInfo = adminManager.obtenerUnidadEnriquecida(idLogico);
        const modeloObj = adminManager.state.modelos.find((m) => Number(m.id_modelo) === Number(unidadInfo.id_modelo));
        if (modeloObj && !modeloObj.tiene_brazo && /BRAZO/.test(cmdNorm)) {
            ui.playSound('cancel');
            ui.showFeedback('Este modelo comercial no incluye brazo hidráulico', 'warning', 2000);
            return;
        }
    }

    comandoActivoActual = cmdNorm;
    ui.playSound('joy');
    ui.vibrar(12);
    ui.setActiveDirectionalButton(cmdNorm);
    ejecutarPorNombreNormalizado(cmdNorm);
}

function soltarBotonDireccion() {
    if (!comandoActivoActual) return;
    comandoActivoActual = null;
    ui.setActiveDirectionalButton(null);
    detenerVehiculo();
}

// Accesorio (Velocidad, Sonido, Luz) desde la consola 3D o el modo VR
function accionAccesorio(normCmd) {
    ui.sonidoAccesorio(normCmd);
    ui.vibrar(12);
    ejecutarPorNombreNormalizado(normCmd);
}

function ejecutarPorNombreNormalizado(normCmd) {
    const comando = catalogoComandos.find(
        (c) => normalizar(c.nombre || c.comando || '') === normCmd
    );
    if (comando) {
        ejecutarComando(comando.id_comando, comando.nombre);
    } else {
        // Fallback por mapa de IDs conocido si el catálogo aún no responde
        const entry = Object.entries(MAPA_COMANDOS_ID).find(([, v]) => normalizar(v) === normCmd);
        if (entry) {
            ejecutarComando(Number(entry[0]), entry[1]);
        } else if (modoSimulacion) {
            ejecutarComando(null, normCmd);
        }
    }
}

// --- MODO SIMULACIÓN ---------------------------------------------------------

function activarSimulacion() {
    modoSimulacion = true;
    ui.setOffline(true);
    ui.renderComandosPlaceholder((id, nombre) => ejecutarPorNombreNormalizado(normalizar(nombre)));
    ui.renderDemos(DEMOS_SIM);
    ui.renderHistorial(historialSim);
}

function registrarSim(nombre) {
    const registro = { comando: nombre, fecha_hora: new Date().toISOString() };
    historialSim.unshift(registro);
    historialSim.length = Math.min(historialSim.length, 10);
    ui.renderUltimoEstado(registro);
    ui.renderHistorial(historialSim);
}

function simularComando(nombreComando) {
    const norm = normalizar(nombreComando);
    // Los movimientos ya se aplicaron al presionar; los accesorios se aplican aquí (una sola vez)
    if (!MOVIMIENTOS.has(norm)) ui.scene3d?.applyCommand(norm);
    registrarSim(etiquetaCmd(norm));
    ui.showFeedback(`Simulación: ${etiquetaCmd(norm)}`, 'info', 1500);
}

function iniciarDemoSimulada(idDemo) {
    cancelarDemoSimulada(false);
    const demo = DEMOS_SIM.find((d) => d.id_demo === idDemo);
    if (!demo) return;

    ui.showFeedback(`Simulación: ${demo.nombre}`, 'success', 2500);
    registrarSim(`Inicio DEMO: ${demo.nombre}`);

    let t = 0;
    demo.pasos.forEach(([cmd, ms]) => {
        demoSimTimers.push(setTimeout(() => {
            if (MOVIMIENTOS.has(cmd)) ui.playSound('joy');
            else ui.sonidoAccesorio(cmd);
            ui.resaltarMovimientoDemo(cmd);
            registrarSim(`${etiquetaCmd(cmd)} (DEMO)`);
        }, t));
        t += ms;
    });

    demoSimTimers.push(setTimeout(() => {
        demoSimTimers = [];
        ui.limpiarResaltadoDemo();
        ui.playSound('stop');
        registrarSim('Detener (DEMO)');
        ui.showFeedback('DEMO finalizada', 'info', 2000);
    }, t));
}

function cancelarDemoSimulada(avisar = true) {
    const habiaDemo = demoSimTimers.length > 0;
    demoSimTimers.forEach(clearTimeout);
    demoSimTimers = [];
    if (habiaDemo) {
        ui.limpiarResaltadoDemo();
        registrarSim('DEMO CANCELADA');
        if (avisar) ui.showFeedback('DEMO cancelada', 'warning', 2000);
    }
}

// --- DEMOS (reales o simuladas) ---------------------------------------------

async function iniciarDemo(idDemo) {
    if (!idDemo) {
        ui.playSound('cancel');
        ui.showFeedback('Selecciona una DEMO', 'warning', 1800);
        return;
    }

    if (!modoSimulacion && !String(idDemo).startsWith('sim-')) {
        const idLogico = CONFIG.VEHICULO_ACTIVO_LOGICO || CONFIG.VEHICULO_ID;
        const perm = adminManager.verificarPermisoOperacion(idLogico, false);
        if (!perm.ok) {
            ui.playSound('cancel');
            return;
        }
    }

    ui.limpiarResaltadoDemo();
    ui.playSound('start');
    ui.vibrar(15);

    if (modoSimulacion || String(idDemo).startsWith('sim-')) {
        iniciarDemoSimulada(idDemo);
        return;
    }
    try {
        ui.showFeedback('Iniciando DEMO...', 'success');
        await api.ejecutarDemo(idDemo);
    } catch (error) {
        ui.limpiarResaltadoDemo();
        ui.showFeedback(error.message || 'No se pudo iniciar la DEMO', 'danger');
    }
}

async function cancelarDemo() {
    ui.limpiarResaltadoDemo();
    ui.playSound('cancel');
    ui.vibrar(15);

    if (modoSimulacion) {
        if (demoSimTimers.length) cancelarDemoSimulada(true);
        else ui.showFeedback('No hay una DEMO en curso', 'info', 1800);
        return;
    }
    try {
        ui.showFeedback('Cancelando DEMO...', 'warning');
        await api.cancelarDemo();
    } catch {
        ui.showFeedback('No se pudo cancelar la DEMO', 'danger');
    }
}

// Carga los catálogos de comandos y demos (reintenta cada 8 s si AWS no responde)
async function cargarCatalogos() {
    clearTimeout(reintentoTimer);
    ui.updateAwsStatus('Comprobando...');
    try {
        const comandosRaw = await api.obtenerComandos();
        const demos = await api.obtenerDemos();

        // Filtrar comandos según capacidades reales del modelo comercial activo
        const idLogico = CONFIG.VEHICULO_ACTIVO_LOGICO || CONFIG.VEHICULO_ID;
        const unidadInfo = adminManager.obtenerUnidadEnriquecida(idLogico);
        const modeloObj = adminManager.state.modelos.find((m) => Number(m.id_modelo) === Number(unidadInfo.id_modelo));

        catalogoComandos = (Array.isArray(comandosRaw) ? comandosRaw : []).filter((c) => {
            if (c.activo === false || c.activo === 0) return false;
            if (modeloObj && !modeloObj.tiene_brazo && /BRAZO/.test(normalizar(c.nombre))) return false;
            return true;
        });

        const cmdDetener = catalogoComandos.find((c) => normalizar(c.nombre) === 'DETENER')
            || (Array.isArray(comandosRaw) ? comandosRaw.find((c) => normalizar(c.nombre) === 'DETENER') : null);
        if (cmdDetener) idComandoDetener = cmdDetener.id_comando;

        // Atenuar visualmente el pad de Brazo si el modelo comercial no incluye brazo
        const padArm = document.querySelector('.area-arm');
        if (padArm) {
            const sinBrazo = Boolean(modeloObj && !modeloObj.tiene_brazo);
            padArm.style.opacity = sinBrazo ? '0.5' : '1';
            padArm.title = sinBrazo ? 'Este modelo comercial no incluye brazo hidráulico' : '';
            padArm.querySelectorAll('[data-cmd*="BRAZO"]').forEach((b) => {
                b.disabled = sinBrazo;
            });
        }

        // AWS respondió: se sale del modo simulación
        cancelarDemoSimulada(false);
        modoSimulacion = false;
        ui.renderComandos(catalogoComandos, ejecutarComando);
        ui.renderDemos(demos);
        ui.setOffline(false);

        if (!primerFallo) ui.showFeedback('Conectado con AWS · control real activo', 'success', 2500);
        primerFallo = true;

        // Si RDS no se pudo verificar al inicio (AWS aún no respondía), volver a consultarlo
        if (!document.getElementById('status-rds')?.classList.contains('bg-success')) {
            verificarRDS();
        }
    } catch (error) {
        console.error('Error cargando catálogos:', error);
        catalogoComandos = [];
        if (primerFallo) {
            ui.showFeedback('Sin conexión con AWS · Modo simulación activo', 'warning', 4000);
            primerFallo = false;
        }
        reintentoTimer = setTimeout(cargarCatalogos, 8000);
    }
}

// --- LÓGICA DE MONITOREO (REST + WSS) ---

async function cargarDatosMonitoreo() {
    if (modoSimulacion) {
        if (historialSim.length) ui.renderUltimoEstado(historialSim[0]);
        ui.renderHistorial(historialSim);
        return;
    }
    try {
        const [ultimoEstado, historial] = await Promise.all([
            api.obtenerUltimoEstado(),
            api.obtenerHistorial()
        ]);

        ui.renderUltimoEstado(ultimoEstado);
        ui.renderHistorial(historial);
    } catch (error) {
        console.error('Error al cargar datos de monitoreo:', error);
    }
}

async function procesarMensajeWSS(payload) {
    if (!payload) return;

    if (payload.tipo_evento === 'inicio_demo') {
        ui.showFeedback('Iniciando DEMO...', 'success', 2500);
        return;
    }

    if (payload.tipo_evento === 'movimiento_demo') {
        const cmdObj = catalogoComandos.find((c) => c.id_comando === payload.comando_en_ejecucion);
        const nombreBase = cmdObj
            ? cmdObj.nombre
            : (MAPA_COMANDOS_ID[payload.comando_en_ejecucion] || `Comando ID: ${payload.comando_en_ejecucion}`);

        const norm = normalizar(nombreBase);
        if (norm === 'DETENER' || norm === 'STOP') {
            ui.playSound('stop');
            ui.limpiarResaltadoDemo();
            ui.showFeedback(`Enviando: ${nombreBase}`, 'info', 2500);
        } else {
            ui.playSound('joy');
            ui.resaltarMovimientoDemo(nombreBase);
            ui.showFeedback(`Enviando: ${nombreBase}`, 'info', 4000);
        }

        ui.renderUltimoEstado({
            comando: `${nombreBase} (DEMO)`,
            fecha_actualizacion: new Date().toISOString()
        });
        return;
    }

    if (payload.tipo_evento === 'cancelacion_demo') {
        ui.limpiarResaltadoDemo();
        ui.showFeedback('DEMO cancelada', 'warning', 2500);
        ui.renderUltimoEstado({
            comando: 'DEMO CANCELADA',
            fecha_actualizacion: new Date().toISOString()
        });
        return;
    }

    if (payload.tipo_evento === 'estado_inicial' || payload.tipo_evento === 'movimiento_individual') {
        if (payload.datos) {
            if (payload.tipo_evento === 'movimiento_individual') {
                const d = payload.datos;
                ui.scene3d?.applyCommand(normalizar(d.comando || d.nombre_comando || d.nombre || d.movimiento || ''));
            }
            ui.renderUltimoEstado({
                ...payload.datos,
                fecha_actualizacion: payload.datos.fecha_actualizacion || payload.datos.fecha_hora || new Date().toISOString()
            });
        }

        if (vistaActual === 'monitoreo' && payload.tipo_evento === 'movimiento_individual') {
            setTimeout(async () => {
                try {
                    const historial = await api.obtenerHistorial();
                    ui.renderHistorial(historial);
                } catch (e) {
                    console.error('Error actualizando tabla tras WSS:', e);
                }
            }, 600);
        }
    }
}

// --- LÓGICA DE CONTROL Y SALUD ---

async function verificarRDS() {
    const rdsBadge = document.getElementById('status-rds');
    rdsBadge.innerHTML = `<i class="bi bi-arrow-repeat"></i> RDS: Consultando...`;

    try {
        const response = await fetch(`${CONFIG.API_BASE_URL}/api/health`);
        if (response.ok) {
            const data = await response.json();
            if (data.rds === 'Disponible') {
                rdsBadge.className = 'badge bg-success status-badge';
                rdsBadge.innerHTML = `<i class="bi bi-database-check"></i> RDS: Disponible`;
                ui.vrManager?.syncState({ rds: 'Disponible' });
            } else {
                rdsBadge.className = 'badge bg-danger status-badge';
                rdsBadge.innerHTML = `<i class="bi bi-database-x"></i> RDS: No disponible`;
                ui.vrManager?.syncState({ rds: 'No disponible' });
            }
        } else {
            throw new Error('Respuesta no OK de /api/health');
        }
    } catch (error) {
        console.error('Error al consultar RDS:', error);
        rdsBadge.className = 'badge bg-secondary status-badge';
        rdsBadge.innerHTML = `<i class="bi bi-database-dash"></i> RDS: Sin verificar`;
        ui.vrManager?.syncState({ rds: 'Sin verificar' });
    }
}

async function ejecutarComando(idComando, nombreComando) {
    if (modoSimulacion) {
        simularComando(nombreComando);
        return;
    }

    // Seguridad: DETENER siempre tiene prioridad física; el resto valida RBAC + BOLA + Soporte
    const esDetener = normalizar(nombreComando) === 'DETENER';
    if (!esDetener) {
        const idLogico = CONFIG.VEHICULO_ACTIVO_LOGICO || CONFIG.VEHICULO_ID;
        const perm = adminManager.verificarPermisoOperacion(idLogico, false);
        if (!perm.ok) return;
    }

    try {
        ui.showFeedback(`Enviando: ${nombreComando}`);
        await api.ejecutarMovimiento(idComando);
    } catch {
        // El error ya lo maneja api.js
    }
}

async function detenerVehiculo() {
    comandoActivoActual = null;
    ui.setActiveDirectionalButton(null);
    ui.scene3d?.applyCommand('DETENER');

    if (modoSimulacion) {
        registrarSim('Detener');
        return;
    }

    const stopId = idComandoDetener || 12;
    ui.showFeedback('Enviando: Detener');
    try {
        await api.ejecutarMovimiento(stopId, false); // no cancelable: ningún movimiento posterior puede abortarlo
    } catch {
        // El error ya lo maneja api.js
    }
}

// --- APP INSTALABLE (PWA) ------------------------------------------------------

function configurarPWA() {
    // Service worker: la app abre sin conexión (modo simulación) y carga más rápido
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
        navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('Service worker no registrado:', e));
    }

    // Atajo de la app instalada: abrir directamente el Asistente IA
    if (new URLSearchParams(location.search).get('asistente') === '1') {
        setTimeout(() => document.getElementById('btn-asistente')?.click(), 1200);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    inicializar();
    configurarPWA();
});
