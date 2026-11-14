// assets/js/botones3d.js
// Consola de mando 3D dentro del escenario: botones físicos que se hunden al presionarlos.
// Movimiento y brazo funcionan "mientras se mantiene presionado" (al soltar se envía DETENER),
// los accesorios son de un solo toque y el botón rojo es el paro inmediato.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const AMBAR = 0xffb43a;
const CIAN = 0x5cc8ff;
const VERDE = 0x3ddc97;
const ROJO = 0xff4d5e;

// Posición de cada botón sobre el tablero (coordenadas locales x, z en metros)
const D = 0.21; // separación de las cruces
const BOTONES = [
    // Brazo y motores (izquierda)
    { cmd: 'SUBIR_BRAZO', glifo: '▲', texto: 'SUBIR', x: -0.62, z: 0.06 - D, color: CIAN, tipo: 'hold' },
    { cmd: 'BAJAR_BRAZO', glifo: '▼', texto: 'BAJAR', x: -0.62, z: 0.06 + D, color: CIAN, tipo: 'hold' },
    { cmd: 'MOTOR_IZQUIERDA', glifo: '↺', texto: 'MOTOR I', x: -0.62 - D, z: 0.06, color: CIAN, tipo: 'hold' },
    { cmd: 'MOTOR_DERECHA', glifo: '↻', texto: 'MOTOR D', x: -0.62 + D, z: 0.06, color: CIAN, tipo: 'hold' },
    // Movimiento (derecha)
    { cmd: 'AVANZAR', glifo: '▲', texto: 'AVANZAR', x: 0.62, z: 0.06 - D, color: AMBAR, tipo: 'hold' },
    { cmd: 'RETROCEDER', glifo: '▼', texto: 'ATRÁS', x: 0.62, z: 0.06 + D, color: AMBAR, tipo: 'hold' },
    { cmd: 'GIRAR_IZQUIERDA', glifo: '◀', texto: 'IZQ', x: 0.62 - D, z: 0.06, color: AMBAR, tipo: 'hold' },
    { cmd: 'GIRAR_DERECHA', glifo: '▶', texto: 'DER', x: 0.62 + D, z: 0.06, color: AMBAR, tipo: 'hold' },
    // Accesorios (centro arriba)
    { cmd: 'VELOCIDAD', glifo: '»', texto: 'VEL', x: -0.18, z: -0.27, color: AMBAR, tipo: 'instant', redondo: true },
    { cmd: 'SONIDO', glifo: '♪', texto: 'SON', x: 0, z: -0.27, color: CIAN, tipo: 'instant', redondo: true },
    { cmd: 'LUZ', glifo: '☀', texto: 'LUZ', x: 0.18, z: -0.27, color: VERDE, tipo: 'instant', redondo: true },
    // Paro (centro abajo)
    { cmd: 'DETENER', glifo: '■', texto: 'STOP', x: 0, z: 0.15, color: ROJO, tipo: 'stop', redondo: true, grande: true }
];

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

export class Consola3D {
    /**
     * @param {import('./scene3d.js').Scene3DManager} scene3d
     * @param {{ onPress: (cmd: string, instantaneo: boolean) => void, onRelease: () => void, onStop: () => void }} callbacks
     * @param {{ x: number, z: number }} posicion  Posición de la consola sobre la plataforma
     */
    constructor(scene3d, callbacks, posicion = { x: 1.2, z: 1.3 }) {
        this.s = scene3d;
        this.cb = callbacks;
        this.raycaster = new THREE.Raycaster();
        this.ndc = new THREE.Vector2();
        this.botones = [];
        this.presionado = null;   // botón "hold" mantenido con el puntero
        this.pointerId = null;
        this.hover = null;
        this.activo = null;       // comando activo (botones web, teclado, demos)

        this.posicionBase = { ...posicion };
        this._construir(posicion);
        this._eventos();

        // La consola acompaña al vehículo (sin girar con él) para que siempre quede en pantalla
        this.s.registerVRUpdate((dt) => this._actualizar(dt));
    }

    // Resalta el botón 3D que corresponde al comando activo (null = ninguno)
    setActive(normCmd) {
        this.activo = normCmd && normCmd !== 'DETENER' && normCmd !== 'STOP' ? normCmd : null;
    }

    // --- Construcción ---------------------------------------------------------

    _construir(pos) {
        const g = (this.grupo = new THREE.Group());
        g.position.set(pos.x, 0, pos.z);
        // Orientada hacia la cámara inicial
        const cam = this.s.defaultCamPos;
        g.rotation.y = Math.atan2(cam.x - pos.x, cam.z - pos.z);
        this.s.scene.add(g);

        const metal = new THREE.MeshStandardMaterial({ color: 0x141c33, metalness: 0.7, roughness: 0.35 });
        const neon = new THREE.MeshStandardMaterial({ color: CIAN, emissive: 0x1e6fa8, emissiveIntensity: 1.1 });

        // Base holográfica flotante (la consola se desplaza junto con el vehículo)
        const halo = new THREE.Mesh(
            new THREE.RingGeometry(0.55, 0.95, 48),
            new THREE.MeshBasicMaterial({ color: CIAN, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false })
        );
        halo.rotation.x = -Math.PI / 2;
        halo.position.y = 0.02;
        g.add(halo);
        const haz = new THREE.Mesh(
            new THREE.CylinderGeometry(0.5, 0.75, 0.55, 32, 1, true),
            new THREE.MeshBasicMaterial({ color: CIAN, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false })
        );
        haz.position.y = 0.3;
        g.add(haz);

        // Tablero inclinado hacia el usuario
        const mesa = (this.mesa = new THREE.Group());
        mesa.position.set(0, 0.6, 0);
        mesa.rotation.x = 0.42;
        g.add(mesa);

        const tablero = new THREE.Mesh(new RoundedBoxGeometry(2.1, 0.08, 1.05, 3, 0.03), metal);
        tablero.castShadow = true;
        tablero.receiveShadow = true;
        mesa.add(tablero);

        const tira = new THREE.Mesh(new THREE.BoxGeometry(2.06, 0.018, 0.018), neon);
        tira.position.set(0, 0.0, 0.535);
        mesa.add(tira);

        // Superficie con títulos y zonas dibujadas
        const sup = new THREE.Mesh(
            new THREE.PlaneGeometry(2.04, 1.0),
            new THREE.MeshStandardMaterial({ map: this._texturaTablero(), roughness: 0.6, metalness: 0.2, transparent: true })
        );
        sup.rotation.x = -Math.PI / 2;
        sup.position.y = 0.041;
        mesa.add(sup);

        BOTONES.forEach((def) => this._crearBoton(def));
    }

    _crearBoton(def) {
        const alto = def.grande ? 0.075 : 0.06;
        const geo = def.redondo
            ? new THREE.CylinderGeometry(def.grande ? 0.15 : 0.066, def.grande ? 0.155 : 0.07, alto, 40)
            : new RoundedBoxGeometry(0.165, alto, 0.165, 4, 0.03);

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
        const tam = def.redondo ? (def.grande ? 0.26 : 0.12) : 0.15;
        const etiqueta = new THREE.Mesh(
            new THREE.PlaneGeometry(tam, tam),
            new THREE.MeshBasicMaterial({ map: this._texturaEtiqueta(def), transparent: true, depthWrite: false })
        );
        etiqueta.rotation.x = -Math.PI / 2;
        etiqueta.position.y = alto / 2 + 0.0015;
        boton.add(etiqueta);

        // Base / aro del botón de paro
        if (def.tipo === 'stop') {
            const aro = new THREE.Mesh(
                new THREE.CylinderGeometry(0.195, 0.2, 0.03, 40),
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
            ctx.font = '800 76px system-ui, "Segoe UI", sans-serif';
            ctx.fillText('STOP', 128, 132);
        } else {
            ctx.font = `700 ${def.redondo ? 130 : 112}px "Segoe UI Symbol", "DejaVu Sans", system-ui, sans-serif`;
            ctx.fillText(def.glifo, 128, def.redondo ? 128 : 104);
            if (!def.redondo) {
                ctx.font = '800 40px system-ui, "Segoe UI", sans-serif';
                ctx.fillText(def.texto, 128, 205);
            }
        }
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 4;
        return t;
    }

    _texturaTablero() {
        const W = 1024, H = 502;
        const c = document.createElement('canvas');
        c.width = W;
        c.height = H;
        const ctx = c.getContext('2d');
        const px = (x) => (x / 2.04 + 0.5) * W;
        const pz = (z) => (z / 1.0 + 0.5) * H;

        const grad = ctx.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, '#16213d');
        grad.addColorStop(1, '#0c1326');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.roundRect(4, 4, W - 8, H - 8, 26);
        ctx.fill();

        const zona = (cx, cz, r, color) => {
            ctx.beginPath();
            ctx.arc(px(cx), pz(cz), r, 0, Math.PI * 2);
            ctx.fillStyle = `${color}14`;
            ctx.fill();
            ctx.strokeStyle = `${color}66`;
            ctx.lineWidth = 3;
            ctx.stroke();
        };
        zona(-0.62, 0.06, 165, hex(CIAN));
        zona(0.62, 0.06, 165, hex(AMBAR));

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '700 30px system-ui, "Segoe UI", sans-serif';
        ctx.fillStyle = hex(CIAN);
        ctx.fillText('BRAZO Y MOTORES', px(-0.62), pz(-0.43));
        ctx.fillStyle = hex(AMBAR);
        ctx.fillText('MOVIMIENTO', px(0.62), pz(-0.43));
        ctx.fillStyle = '#c7d2ec';
        ctx.fillText('ACCESORIOS', px(0), pz(-0.43));

        ctx.font = '700 20px system-ui, "Segoe UI", sans-serif';
        ctx.fillStyle = '#8d98b5';
        [['VEL', -0.18], ['SON', 0], ['LUZ', 0.18]].forEach(([t, x]) => ctx.fillText(t, px(x), pz(-0.16)));

        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 4;
        return t;
    }

    // --- Interacción ----------------------------------------------------------

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

    _botonBajoPuntero(e) {
        if (!this.grupo.visible) return null;
        const rect = this.s.renderer.domElement.getBoundingClientRect();
        this.ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
        this.raycaster.setFromCamera(this.ndc, this.s.camera);
        const hit = this.raycaster.intersectObjects(this.botones, true)[0];
        if (!hit) return null;
        return hit.object.userData.boton || hit.object;
    }

    _down(e) {
        if (this.s.renderer.xr.isPresenting || (e.pointerType === 'mouse' && e.button !== 0)) return;
        const boton = this._botonBajoPuntero(e);
        if (!boton) return;

        e.stopImmediatePropagation();
        e.preventDefault();
        const { cmd, tipo } = boton.userData;

        if (tipo === 'hold') {
            this._soltar();
            this.presionado = boton;
            this.pointerId = e.pointerId;
            this.cb.onPress?.(cmd, false);
        } else if (tipo === 'instant') {
            boton.userData.flash = 0.22;
            this.cb.onPress?.(cmd, true);
        } else {
            boton.userData.flash = 0.3;
            this.cb.onStop?.();
        }
    }

    _up(e) {
        if (this.presionado && e.pointerId === this.pointerId) this._soltar();
    }

    _soltar() {
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
        // En VR se usan los paneles flotantes; la consola se oculta
        this.grupo.visible = !this.s.renderer.xr.isPresenting && !this.s.modoExterno;
        if (!this.grupo.visible) return;

        const d = this.s.desplazamiento;
        if (d) this.grupo.position.set(this.posicionBase.x + d.x, 0, this.posicionBase.z + d.z);

        const ms = this.s.motionState;
        for (const b of this.botones) {
            const u = b.userData;
            if (u.flash > 0) u.flash = Math.max(0, u.flash - dt);

            const presionado = this.presionado === b || this.activo === u.cmd || u.flash > 0;
            const objetivo = presionado ? 1 : 0;
            u.profundidad += (objetivo - u.profundidad) * Math.min(1, dt * 22);
            b.position.y = u.baseY - u.profundidad * 0.026;

            // Brillo: presionado > encendido (luz / velocidad) > hover > reposo
            let brillo = 0.22;
            if ((u.cmd === 'LUZ' && ms.lightsOn) || (u.cmd === 'VELOCIDAD' && ms.highSpeed)) brillo = 0.75;
            if (this.hover === b) brillo = Math.max(brillo, 0.55);
            if (presionado) brillo = 1.3;
            u.mat.emissiveIntensity += (brillo - u.mat.emissiveIntensity) * Math.min(1, dt * 16);
        }
    }
}
