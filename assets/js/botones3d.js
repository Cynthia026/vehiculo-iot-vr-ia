// assets/js/botones3d.js
// Consola de mando 3D dentro del escenario: botones físicos que se hunden al presionarlos.
// Visible exclusivamente en Modo VR (WebXR en gafas, Modo VR en computadora y VR Celular).
// Incluye: Brazo y Motores, Accesorios, STOP, Movimiento, Control con IA (Voz, Gestos, Giroscopio),
// Asistente IA y Secuencias Demo.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const AMBAR = 0xffb43a;
const CIAN = 0x5cc8ff;
const VERDE = 0x3ddc97;
const ROJO = 0xff4d5e;
const ROSA = 0xff78aa;
const VIOLETA = 0x9a6bff;
const AZUL = 0x74b9ff;

// Posición de cada botón sobre el tablero (coordenadas locales x, z en metros)
// Tablero de 2.28 m de ancho x 1.44 m de fondo
const D = 0.20; // separación de las cruces direccionales
const Z_CRUZ = -0.14;
const Z_FILA_INF = 0.46;

const BOTONES = [
    // --- BRAZO Y MOTORES (izquierda superior) ---
    { cmd: 'SUBIR_BRAZO', glifo: '▲', texto: 'SUBIR', x: -0.66, z: Z_CRUZ - D, color: CIAN, tipo: 'hold' },
    { cmd: 'BAJAR_BRAZO', glifo: '▼', texto: 'BAJAR', x: -0.66, z: Z_CRUZ + D, color: CIAN, tipo: 'hold' },
    { cmd: 'MOTOR_IZQUIERDA', glifo: '↺', texto: 'MOTOR I', x: -0.66 - D, z: Z_CRUZ, color: CIAN, tipo: 'hold' },
    { cmd: 'MOTOR_DERECHA', glifo: '↻', texto: 'MOTOR D', x: -0.66 + D, z: Z_CRUZ, color: CIAN, tipo: 'hold' },

    // --- MOVIMIENTO (derecha superior) ---
    { cmd: 'AVANZAR', glifo: '▲', texto: 'AVANZAR', x: 0.66, z: Z_CRUZ - D, color: AMBAR, tipo: 'hold' },
    { cmd: 'RETROCEDER', glifo: '▼', texto: 'ATRÁS', x: 0.66, z: Z_CRUZ + D, color: AMBAR, tipo: 'hold' },
    { cmd: 'GIRAR_IZQUIERDA', glifo: '◀', texto: 'IZQ', x: 0.66 - D, z: Z_CRUZ, color: AMBAR, tipo: 'hold' },
    { cmd: 'GIRAR_DERECHA', glifo: '▶', texto: 'DER', x: 0.66 + D, z: Z_CRUZ, color: AMBAR, tipo: 'hold' },

    // --- ACCESORIOS (centro arriba) ---
    { cmd: 'VELOCIDAD', glifo: '»', texto: 'VEL', x: -0.18, z: -0.44, color: AMBAR, tipo: 'instant', redondo: true },
    { cmd: 'SONIDO', glifo: '♪', texto: 'SON', x: 0, z: -0.44, color: CIAN, tipo: 'instant', redondo: true },
    { cmd: 'LUZ', glifo: '☀', texto: 'LUZ', x: 0.18, z: -0.44, color: VERDE, tipo: 'instant', redondo: true },

    // --- PARO DE EMERGENCIA (centro) ---
    { cmd: 'DETENER', glifo: '■', texto: 'STOP', x: 0, z: -0.06, color: ROJO, tipo: 'stop', redondo: true, grande: true },

    // --- CONTROL CON IA + ASISTENTE IA (abajo izquierda) ---
    { cmd: 'IA_VOZ', glifo: '🎤', texto: 'VOZ', x: -0.84, z: Z_FILA_INF, color: ROSA, tipo: 'ia', modoIA: 'voz', compacto: true },
    { cmd: 'IA_GESTOS', glifo: '✋', texto: 'GESTOS', x: -0.60, z: Z_FILA_INF, color: CIAN, tipo: 'ia', modoIA: 'gestos', compacto: true },
    { cmd: 'IA_GIRO', glifo: '📱', texto: 'GIRO', x: -0.36, z: Z_FILA_INF, color: VERDE, tipo: 'ia', modoIA: 'giro', compacto: true },
    { cmd: 'ASISTENTE', glifo: '✨', texto: 'ASIST. IA', x: -0.12, z: Z_FILA_INF, color: VIOLETA, tipo: 'asistente', compacto: true },

    // --- SECUENCIAS DEMO (abajo derecha) ---
    { cmd: 'DEMO_CYCLE', glifo: '⟳', texto: 'CAMBIAR', x: 0.24, z: Z_FILA_INF, color: AZUL, tipo: 'demo_cycle', compacto: true },
    { cmd: 'DEMO_START', glifo: '▶', texto: 'INICIAR', x: 0.54, z: Z_FILA_INF, color: VERDE, tipo: 'demo_start', compacto: true },
    { cmd: 'DEMO_CANCEL', glifo: '✕', texto: 'CANCELAR', x: 0.82, z: Z_FILA_INF, color: ROJO, tipo: 'demo_cancel', compacto: true }
];

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

export class Consola3D {
    /**
     * @param {import('./scene3d.js').Scene3DManager} scene3d
     * @param {{
     *   onPress: (cmd: string, instantaneo: boolean) => void,
     *   onRelease: () => void,
     *   onStop: () => void,
     *   onToggleIA?: (modo: 'voz'|'gestos'|'giro') => void,
     *   onToggleAsistente?: () => void,
     *   onCycleDemo?: () => void,
     *   onStartDemo?: () => void,
     *   onCancelDemo?: () => void
     * }} callbacks
     * @param {{ x: number, z: number }} posicion  Posición de la consola sobre la plataforma
     */
    constructor(scene3d, callbacks, posicion = { x: 1.05, z: 1.45 }) {
        this.s = scene3d;
        this.cb = callbacks;
        this.raycaster = new THREE.Raycaster();
        this.ndc = new THREE.Vector2();
        this.botones = [];
        this.presionado = null;   // botón "hold" mantenido con el puntero
        this.pointerId = null;
        this.hover = null;
        this.activo = null;       // comando activo (botones web, teclado, demos)

        // Estado de modos IA, Asistente y Demo reflejado en la consola 3D
        this.modoIAActivo = null;      // 'voz' | 'gestos' | 'giro' | null
        this.asistenteActivo = false;
        this.nombreDemoActual = 'Seleccionar rutina';

        // Control de visibilidad: OCULTO en vista normal de computadora, VISIBLE solo en Modo VR
        this.modoVR = false;

        this.posicionBase = { ...posicion };
        this._construir(posicion);
        this._eventos();

        // La consola acompaña al vehículo (sin girar con él) cuando Modo VR está activo
        this.s.registerVRUpdate((dt) => this._actualizar(dt));
    }

    // Activa o desactiva la visibilidad de la consola 3D para Modo VR
    setModoVR(activo) {
        this.modoVR = Boolean(activo);
        if (!this.modoVR) {
            this._soltar();
            this._setHover(null);
        }
    }

    // Resalta el botón 3D que corresponde al comando activo (null = ninguno)
    setActive(normCmd) {
        this.activo = normCmd && normCmd !== 'DETENER' && normCmd !== 'STOP' ? normCmd : null;
    }

    // Sincroniza el estado de los botones de Control con IA y Asistente IA
    setEstadoIA({ modo = null, asistente = false } = {}) {
        const cambio = this.modoIAActivo !== modo || this.asistenteActivo !== asistente;
        this.modoIAActivo = modo;
        this.asistenteActivo = Boolean(asistente);
        if (cambio && this._tableroCanvas) {
            this._dibujarSuperficieTablero();
        }
    }

    // Actualiza el nombre de la secuencia Demo mostrada sobre la consola 3D
    setDemoActual(nombre) {
        const texto = String(nombre || 'Sin demos disponibles').trim();
        if (texto === this.nombreDemoActual) return;
        this.nombreDemoActual = texto;
        if (this._tableroCanvas) {
            this._dibujarSuperficieTablero();
        }
    }

    // --- Construcción ---------------------------------------------------------

    _construir(pos) {
        const g = (this.grupo = new THREE.Group());
        g.position.set(pos.x, 0, pos.z);
        g.visible = false; // Oculta por defecto en modo normal de computadora
        // Orientada hacia la cámara inicial
        const cam = this.s.defaultCamPos;
        g.rotation.y = Math.atan2(cam.x - pos.x, cam.z - pos.z);
        this.s.scene.add(g);

        const metal = new THREE.MeshStandardMaterial({ color: 0x141c33, metalness: 0.7, roughness: 0.35 });
        const neon = new THREE.MeshStandardMaterial({ color: CIAN, emissive: 0x1e6fa8, emissiveIntensity: 1.1 });

        // Base holográfica flotante (la consola se desplaza junto con el vehículo)
        const halo = new THREE.Mesh(
            new THREE.RingGeometry(0.62, 1.08, 48),
            new THREE.MeshBasicMaterial({ color: CIAN, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false })
        );
        halo.rotation.x = -Math.PI / 2;
        halo.position.y = 0.02;
        g.add(halo);
        const haz = new THREE.Mesh(
            new THREE.CylinderGeometry(0.55, 0.85, 0.55, 32, 1, true),
            new THREE.MeshBasicMaterial({ color: CIAN, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false })
        );
        haz.position.y = 0.3;
        g.add(haz);

        // Tablero inclinado hacia el usuario
        const mesa = (this.mesa = new THREE.Group());
        mesa.position.set(0, 0.62, 0);
        mesa.rotation.x = 0.42;
        g.add(mesa);

        const ANCHO = 2.28;
        const FONDO = 1.44;

        const tablero = new THREE.Mesh(new RoundedBoxGeometry(ANCHO, 0.08, FONDO, 3, 0.03), metal);
        tablero.castShadow = true;
        tablero.receiveShadow = true;
        mesa.add(tablero);

        const tira = new THREE.Mesh(new THREE.BoxGeometry(ANCHO - 0.04, 0.018, 0.018), neon);
        tira.position.set(0, 0.0, FONDO / 2 + 0.01);
        mesa.add(tira);

        // Superficie con títulos, zonas y pantalla de Demo dibujadas
        this._tableroCanvas = document.createElement('canvas');
        this._tableroCanvas.width = 1140;
        this._tableroCanvas.height = 720;
        this._tableroTexture = new THREE.CanvasTexture(this._tableroCanvas);
        this._tableroTexture.colorSpace = THREE.SRGBColorSpace;
        this._tableroTexture.anisotropy = 4;
        this._dibujarSuperficieTablero();

        const sup = new THREE.Mesh(
            new THREE.PlaneGeometry(ANCHO - 0.06, FONDO - 0.05),
            new THREE.MeshStandardMaterial({
                map: this._tableroTexture,
                roughness: 0.6,
                metalness: 0.2,
                transparent: true
            })
        );
        sup.rotation.x = -Math.PI / 2;
        sup.position.y = 0.041;
        mesa.add(sup);

        BOTONES.forEach((def) => this._crearBoton(def));
    }

    _crearBoton(def) {
        const alto = def.grande ? 0.075 : 0.06;
        const lado = def.compacto ? 0.185 : 0.165;
        const fondoBtn = def.compacto ? 0.155 : 0.165;
        const geo = def.redondo
            ? new THREE.CylinderGeometry(def.grande ? 0.145 : 0.064, def.grande ? 0.15 : 0.068, alto, 40)
            : new RoundedBoxGeometry(lado, alto, fondoBtn, 4, 0.028);

        const mat = new THREE.MeshStandardMaterial({
            color: def.color,
            emissive: def.color,
            emissiveIntensity: 0.22,
            metalness: 0.25,
            roughness: 0.38
        });

        const boton = new THREE.Mesh(geo, mat);
        const baseY = 0.04 + alto / 2;
        boton.position.set(def.x, baseY, def.z);
        boton.castShadow = true;

        // Etiqueta sobre la cara superior (se mueve con el botón)
        const tamX = def.redondo ? (def.grande ? 0.25 : 0.115) : (def.compacto ? 0.17 : 0.15);
        const tamZ = def.redondo ? (def.grande ? 0.25 : 0.115) : (def.compacto ? 0.145 : 0.15);
        const etiqueta = new THREE.Mesh(
            new THREE.PlaneGeometry(tamX, tamZ),
            new THREE.MeshBasicMaterial({ map: this._texturaEtiqueta(def), transparent: true, depthWrite: false })
        );
        etiqueta.rotation.x = -Math.PI / 2;
        etiqueta.position.y = alto / 2 + 0.0015;
        boton.add(etiqueta);

        // Base / aro del botón de paro
        if (def.tipo === 'stop') {
            const aro = new THREE.Mesh(
                new THREE.CylinderGeometry(0.185, 0.19, 0.03, 40),
                new THREE.MeshStandardMaterial({ color: 0xffc928, metalness: 0.3, roughness: 0.5 })
            );
            aro.position.set(def.x, 0.055, def.z);
            this.mesa.add(aro);
        }

        boton.userData = { ...def, baseY, mat, flash: 0, profundidad: 0 };
        etiqueta.userData.boton = boton;
        this.mesa.add(boton);
        this.botones.push(boton);
    }

    _texturaEtiqueta(def) {
        const c = document.createElement('canvas');
        c.width = c.height = 256;
        const ctx = c.getContext('2d');
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const tinta = def.tipo === 'stop' ? '#ffffff' : '#0a1222';
        ctx.fillStyle = tinta;
        if (def.tipo === 'stop') {
            ctx.font = '800 74px system-ui, "Segoe UI", sans-serif';
            ctx.fillText('STOP', 128, 132);
        } else {
            ctx.font = `700 ${def.redondo ? 126 : (def.compacto ? 96 : 110)}px "Segoe UI Symbol", "Apple Color Emoji", "Segoe UI Emoji", "DejaVu Sans", system-ui, sans-serif`;
            ctx.fillText(def.glifo, 128, def.redondo ? 128 : 98);
            if (!def.redondo) {
                ctx.font = `800 ${def.compacto ? 34 : 38}px system-ui, "Segoe UI", sans-serif`;
                ctx.fillText(def.texto, 128, 204);
            }
        }
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 4;
        return t;
    }

    _dibujarSuperficieTablero() {
        const c = this._tableroCanvas;
        const W = c.width, H = c.height;
        const ctx = c.getContext('2d');
        const ANCHO_SUP = 2.22;
        const FONDO_SUP = 1.39;
        const px = (x) => (x / ANCHO_SUP + 0.5) * W;
        const pz = (z) => (z / FONDO_SUP + 0.5) * H;

        ctx.clearRect(0, 0, W, H);

        // Fondo del tablero
        const grad = ctx.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, '#16213d');
        grad.addColorStop(1, '#0b1224');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.roundRect(4, 4, W - 8, H - 8, 28);
        ctx.fill();

        // Círculos de las cruces direccionales
        const zonaCircular = (cx, cz, r, color) => {
            ctx.beginPath();
            ctx.arc(px(cx), pz(cz), r, 0, Math.PI * 2);
            ctx.fillStyle = `${color}14`;
            ctx.fill();
            ctx.strokeStyle = `${color}66`;
            ctx.lineWidth = 3;
            ctx.stroke();
        };
        zonaCircular(-0.66, Z_CRUZ, 152, hex(CIAN));
        zonaCircular(0.66, Z_CRUZ, 152, hex(AMBAR));

        // Títulos superiores
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '700 28px system-ui, "Segoe UI", sans-serif';
        ctx.fillStyle = hex(CIAN);
        ctx.fillText('BRAZO Y MOTORES', px(-0.66), pz(-0.58));
        ctx.fillStyle = hex(AMBAR);
        ctx.fillText('MOVIMIENTO', px(0.66), pz(-0.58));
        ctx.fillStyle = '#c7d2ec';
        ctx.fillText('ACCESORIOS', px(0), pz(-0.58));

        // Etiquetas bajo los botones redondos de accesorios
        ctx.font = '700 19px system-ui, "Segoe UI", sans-serif';
        ctx.fillStyle = '#9aa6c4';
        [['VEL', -0.18], ['SON', 0], ['LUZ', 0.18]].forEach(([t, x]) => ctx.fillText(t, px(x), pz(-0.33)));

        // Línea divisoria luminosa entre la zona superior y los módulos IA / Demo
        ctx.strokeStyle = 'rgba(92, 200, 255, 0.26)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(42, pz(0.20));
        ctx.lineTo(W - 42, pz(0.20));
        ctx.stroke();

        // Enmarcado inferior izquierdo: CONTROL CON IA Y ASISTENTE
        const xIaIzq = px(-1.02), xIaDer = px(0.03);
        const yInfTop = pz(0.24), yInfBot = pz(0.64);
        ctx.fillStyle = 'rgba(154, 107, 255, 0.08)';
        ctx.strokeStyle = 'rgba(154, 107, 255, 0.38)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(xIaIzq, yInfTop, xIaDer - xIaIzq, yInfBot - yInfTop, 18);
        ctx.fill();
        ctx.stroke();

        ctx.font = '700 23px system-ui, "Segoe UI", sans-serif';
        ctx.fillStyle = '#d4c4ff';
        ctx.textAlign = 'left';
        const estadoIaTxt = this.modoIAActivo
            ? ` · ACTIVO: ${this.modoIAActivo.toUpperCase()}`
            : (this.asistenteActivo ? ' · ASISTENTE ABIERTO' : '');
        ctx.fillText(`CONTROL CON IA & ASISTENTE${estadoIaTxt}`, xIaIzq + 18, pz(0.30));

        // Enmarcado inferior derecho: SECUENCIAS DEMO
        const xDemoIzq = px(0.08), xDemoDer = px(1.02);
        ctx.fillStyle = 'rgba(61, 220, 151, 0.08)';
        ctx.strokeStyle = 'rgba(61, 220, 151, 0.38)';
        ctx.beginPath();
        ctx.roundRect(xDemoIzq, yInfTop, xDemoDer - xDemoIzq, yInfBot - yInfTop, 18);
        ctx.fill();
        ctx.stroke();

        ctx.font = '700 22px system-ui, "Segoe UI", sans-serif';
        ctx.fillStyle = hex(VERDE);
        ctx.textAlign = 'left';
        const demoRecortada = String(this.nombreDemoActual || 'Seleccionar rutina').slice(0, 26);
        ctx.fillText(`DEMO: ${demoRecortada}`, xDemoIzq + 18, pz(0.30));

        this._tableroTexture.needsUpdate = true;
    }

    // --- Interacción (Puntero + Raycaster para VR WebXR y VR Celular) ---------

    _eventos() {
        const canvas = this.s.renderer.domElement;
        // Fase de captura: se atiende antes que OrbitControls para no rotar la cámara al presionar un botón
        canvas.addEventListener('pointerdown', (e) => this._down(e), { capture: true });
        canvas.addEventListener('pointermove', (e) => this._move(e));
        canvas.addEventListener('pointerleave', () => this._setHover(null));
        window.addEventListener('pointerup', (e) => this._up(e));
        window.addEventListener('pointercancel', (e) => this._up(e));
        window.addEventListener('blur', () => this._soltar());
    }

    /**
     * Permite a WebXR (lentes VR) y VR Celular intersectar un rayo contra los botones 3D de esta consola.
     * @param {THREE.Raycaster} raycaster
     * @returns {{ boton: THREE.Mesh, distance: number } | null}
     */
    intersectarRayo(raycaster) {
        if (!this.grupo.visible) return null;
        const hit = raycaster.intersectObjects(this.botones, true)[0];
        if (!hit) return null;
        const boton = hit.object.userData.boton || hit.object;
        return { boton, distance: hit.distance };
    }

    /**
     * Ejecuta la acción de un botón 3D (llamado por clic/toque en pantalla, gatillo WebXR o mirada en VR Celular)
     * @param {THREE.Mesh} boton
     * @param {{ autoSoltarMs?: number }} opciones
     */
    activarBoton3D(boton, { autoSoltarMs = 0 } = {}) {
        if (!boton || !boton.userData) return;
        const { cmd, tipo, modoIA } = boton.userData;

        if (tipo === 'hold') {
            this._soltar();
            this.presionado = boton;
            this.cb.onPress?.(cmd, false);
            if (autoSoltarMs > 0) {
                clearTimeout(this._autoReleaseTimer);
                this._autoReleaseTimer = setTimeout(() => this._soltar(), autoSoltarMs);
            }
        } else if (tipo === 'instant') {
            boton.userData.flash = 0.24;
            this.cb.onPress?.(cmd, true);
        } else if (tipo === 'stop') {
            boton.userData.flash = 0.32;
            this._soltar();
            this.cb.onStop?.();
        } else if (tipo === 'ia') {
            boton.userData.flash = 0.28;
            this.cb.onToggleIA?.(modoIA);
        } else if (tipo === 'asistente') {
            boton.userData.flash = 0.28;
            this.cb.onToggleAsistente?.();
        } else if (tipo === 'demo_cycle') {
            boton.userData.flash = 0.24;
            this.cb.onCycleDemo?.();
        } else if (tipo === 'demo_start') {
            boton.userData.flash = 0.28;
            this.cb.onStartDemo?.();
        } else if (tipo === 'demo_cancel') {
            boton.userData.flash = 0.28;
            this.cb.onCancelDemo?.();
        }
    }

    _botonBajoPuntero(e) {
        if (!this.grupo.visible) return null;
        const rect = this.s.renderer.domElement.getBoundingClientRect();
        this.ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
        this.raycaster.setFromCamera(this.ndc, this.s.camera);
        const res = this.intersectarRayo(this.raycaster);
        return res ? res.boton : null;
    }

    _down(e) {
        if (this.s.renderer.xr.isPresenting || (e.pointerType === 'mouse' && e.button !== 0)) return;
        const boton = this._botonBajoPuntero(e);
        if (!boton) return;

        e.stopImmediatePropagation();
        e.preventDefault();
        this.pointerId = e.pointerId;
        this.activarBoton3D(boton);
    }

    _up(e) {
        if (this.presionado && (this.pointerId === null || e.pointerId === this.pointerId)) {
            this._soltar();
        }
    }

    _soltar() {
        clearTimeout(this._autoReleaseTimer);
        if (!this.presionado) return;
        this.presionado = null;
        this.pointerId = null;
        this.cb.onRelease?.();
    }

    _move(e) {
        if (e.pointerType !== 'mouse') return;
        this._setHover(this._botonBajoPuntero(e));
    }

    _setHover(boton) {
        this.hover = boton;
        this.s.renderer.domElement.style.cursor = boton ? 'pointer' : '';
    }

    // --- Animación ------------------------------------------------------------

    _actualizar(dt = 0.016) {
        // SOLO visible cuando estamos en Modo VR (WebXR en gafas, Modo VR en computadora o VR Celular)
        const enVR = this.modoVR || this.s.renderer.xr.isPresenting || this.s.modoExterno;
        this.grupo.visible = enVR;
        if (!this.grupo.visible) return;

        const d = this.s.desplazamiento;
        if (this.s.renderer.xr.isPresenting) {
            // En gafas WebXR colocamos la consola centrada frente al usuario junto a la excavadora
            this.grupo.position.set((d ? d.x : 0), 0.12, (d ? d.z : 0) + 1.45);
            this.grupo.rotation.y = 0;
        } else if (this.s.modoExterno) {
            // En VR Celular (Cardboard) colocamos la consola centrada frente a la vista del jugador
            this.grupo.position.set((d ? d.x : 0), 0.18, (d ? d.z : 0) + 1.65);
            this.grupo.rotation.y = 0;
        } else {
            // En Modo VR de computadora
            if (d) this.grupo.position.set(this.posicionBase.x + d.x, 0, this.posicionBase.z + d.z);
            const cam = this.s.defaultCamPos;
            this.grupo.rotation.y = Math.atan2(cam.x - this.posicionBase.x, cam.z - this.posicionBase.z);
        }

        const ms = this.s.motionState;
        for (const b of this.botones) {
            const u = b.userData;
            if (u.flash > 0) u.flash = Math.max(0, u.flash - dt);

            const iaActivo =
                (u.tipo === 'ia' && this.modoIAActivo === u.modoIA) ||
                (u.tipo === 'asistente' && this.asistenteActivo);

            const presionado = this.presionado === b || this.activo === u.cmd || u.flash > 0 || iaActivo;
            const objetivo = presionado ? 1 : 0;
            u.profundidad += (objetivo - u.profundidad) * Math.min(1, dt * 22);
            b.position.y = u.baseY - u.profundidad * 0.026;

            // Brillo: presionado > encendido (luz / velocidad / IA) > hover > reposo
            let brillo = 0.22;
            if ((u.cmd === 'LUZ' && ms.lightsOn) || (u.cmd === 'VELOCIDAD' && ms.highSpeed) || iaActivo) {
                brillo = 0.82;
            }
            if (this.hover === b) brillo = Math.max(brillo, 0.58);
            if (presionado) brillo = 1.3;
            u.mat.emissiveIntensity += (brillo - u.mat.emissiveIntensity) * Math.min(1, dt * 16);
        }
    }
}
