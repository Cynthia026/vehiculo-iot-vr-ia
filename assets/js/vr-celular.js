// assets/js/vr-celular.js
// "VR celular" estilo Cardboard: pantalla dividida (un ojo en cada mitad), vista controlada con
// el giroscopio del celular y la Consola 3D física que se activa con la mirada o tocando la pantalla.
import * as THREE from 'three';
import { StereoEffect } from 'three/addons/effects/StereoEffect.js';

const TIEMPO_MIRADA = 1.6;        // segundos mirando un botón para activarlo
const DURACION_MOVIMIENTO = 2.5;  // segundos que dura un movimiento activado con la mirada
const OFFSET_JUGADOR = new THREE.Vector3(0, 1.75, 3.15); // dónde está el usuario respecto al vehículo

const AMBAR = '#ffb43a', VERDE = '#3ddc97', GRIS = '#9aa6c4';

// Botones auxiliares de navegación VR Celular (Centrar vista / Salir)
const BOTONES_AUX = [
    { id: 'CENTRAR', glifo: '◎', texto: 'CENTRAR', x: -0.14, y: -0.32, color: GRIS, tipo: 'centrar', chico: true },
    { id: 'SALIR', glifo: '✕', texto: 'SALIR', x: 0.14, y: -0.32, color: GRIS, tipo: 'salir', chico: true }
];

// Orientación del dispositivo -> cuaternión de la cámara
const _zee = new THREE.Vector3(0, 0, 1);
const _euler = new THREE.Euler();
const _q0 = new THREE.Quaternion();
const _q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // -90° en X
function cuaternionDispositivo(q, alpha, beta, gamma, orient) {
    _euler.set(beta, alpha, -gamma, 'YXZ');
    q.setFromEuler(_euler);
    q.multiply(_q1);
    q.multiply(_q0.setFromAxisAngle(_zee, -orient));
}
const rumbo = (q) => {
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    return Math.atan2(-f.x, -f.z);
};

/** ¿Mostrar el botón? Solo en pantallas táctiles sin WebXR inmersivo (no en Meta Quest). */
export async function vrCelularDisponible() {
    if (new URLSearchParams(location.search).get('vrcelular') === '1') return true;
    const tactil = window.matchMedia('(pointer: coarse)').matches;
    if (!tactil) return false;
    try {
        if (navigator.xr && await navigator.xr.isSessionSupported('immersive-vr')) return false;
    } catch { /* sin WebXR */ }
    return true;
}

export class VRCelular {
    /**
     * @param {import('./scene3d.js').Scene3DManager} scene3d
     * @param {object} acciones presionar, soltar, accesorio, parar, activarVoz, alSalir
     * @param {import('./botones3d.js').Consola3D} [consola3d]
     */
    constructor(scene3d, acciones, consola3d = null) {
        this.s = scene3d;
        this.a = acciones;
        this.consola3d = consola3d;
        this.activo = false;
        this.efecto = new StereoEffect(scene3d.renderer);
        this.efecto.setEyeSeparation(0.064);

        this.rig = new THREE.Group();           // posición del usuario (sigue al vehículo, sin girar)
        this.tablero = new THREE.Group();       // HUD + botones auxiliares Centrar/Salir
        this.raycaster = new THREE.Raycaster();
        this.centro = new THREE.Vector2(0, 0);
        this.qSensor = new THREE.Quaternion();
        this.qOffset = new THREE.Quaternion();
        this.recalibrar = true;
        this.conSensor = false;
        this.arrastre = { yaw: 0, pitch: 0 };
        this.mirando = null;
        this.progreso = 0;

        this._construirTableroAux();
        this._construirMira();
        this._construirHUD();

        this._onOri = (e) => this._orientacion(e);
        this._onResize = () => this._ajustarTamano();
        this._onPointerDown = (e) => this._tocar(e);
        this._onPointerMove = (e) => this._arrastrar(e);
        this._onPointerUp = () => { this._puntero = null; };
        this._onFullscreen = () => {
            if (this.activo && !document.fullscreenElement && this._pantallaCompleta) this.salir();
        };
        scene3d.registerVRUpdate((dt) => this._actualizar(dt));
    }

    // --- Entrar / salir ---------------------------------------------------------

    async entrar() {
        if (this.activo) return;

        if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
            try { await DeviceOrientationEvent.requestPermission(); } catch { /* se usa el arrastre */ }
        }
        this._pantallaCompleta = false;
        try {
            await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
            this._pantallaCompleta = !!document.fullscreenElement;
        } catch { /* sin pantalla completa */ }
        try { await screen.orientation?.lock?.('landscape'); } catch { /* sin bloqueo de orientación */ }

        this.activo = true;
        this._ultimoCuadro = 0;
        this.conSensor = false;
        this.recalibrar = true;
        this.arrastre = { yaw: 0, pitch: -0.22 };
        document.body.classList.add('vr-celular');

        const s = this.s;
        this._pixelRatio = s.renderer.getPixelRatio();
        s.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        s.modoExterno = true;
        this.consola3d?.setModoVR(true);
        s.controls.enabled = false;
        s.camera.clearViewOffset();
        this._fovPrevio = s.camera.fov;
        s.camera.fov = 75;

        s.scene.add(this.rig);
        this.rig.add(this.tablero);
        this.rig.add(s.camera);
        s.camera.position.set(0, 0, 0);
        s.camera.quaternion.identity();

        s.renderizador = () => this.efecto.render(s.scene, s.camera);
        this._ajustarTamano();

        window.addEventListener('deviceorientation', this._onOri);
        window.addEventListener('resize', this._onResize);
        s.renderer.domElement.addEventListener('pointerdown', this._onPointerDown, { capture: true });
        window.addEventListener('pointermove', this._onPointerMove);
        window.addEventListener('pointerup', this._onPointerUp);
        document.addEventListener('fullscreenchange', this._onFullscreen);

        this.mostrarEstado('Mira un botón de la Consola 3D 1.6 s o toca la pantalla para activarlo');
        this.a.activarVoz?.();
    }

    salir() {
        if (!this.activo) return;
        this.activo = false;
        this.consola3d?._soltar();
        this.consola3d?.setModoVR(false);

        window.removeEventListener('deviceorientation', this._onOri);
        window.removeEventListener('resize', this._onResize);
        this.s.renderer.domElement.removeEventListener('pointerdown', this._onPointerDown, { capture: true });
        window.removeEventListener('pointermove', this._onPointerMove);
        window.removeEventListener('pointerup', this._onPointerUp);
        document.removeEventListener('fullscreenchange', this._onFullscreen);

        const s = this.s;
        s.renderizador = null;
        this.rig.remove(s.camera);
        s.scene.remove(this.rig);
        s.camera.fov = this._fovPrevio || 55;
        s.renderer.setPixelRatio(this._pixelRatio || 1);
        s.renderer.setScissorTest(false);
        s.renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
        s.renderer.setSize(window.innerWidth, window.innerHeight);
        s.camera.aspect = window.innerWidth / window.innerHeight;
        s.modoExterno = false;
        s._ajustarEncuadre();
        s.camera.updateProjectionMatrix();
        s.controls.enabled = true;
        s.resetCamera();

        document.body.classList.remove('vr-celular');
        try { screen.orientation?.unlock?.(); } catch { /* nada */ }
        if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
        this.a.alSalir?.();
    }

    comandoVoz(texto) {
        if (!this.activo) return false;
        const t = String(texto).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (/\b(salir|sal|cerrar|terminar vr|quitar vr)\b/.test(t)) { this.salir(); return true; }
        if (/\b(centra|centrar|recentra|recentrar|calibra|calibrar)\b/.test(t)) { this.centrar(); return true; }
        return false;
    }

    centrar() {
        this.recalibrar = true;
        this.arrastre.yaw = 0;
        this.arrastre.pitch = -0.22;
        this.mostrarEstado('Vista centrada');
    }

    mostrarEstado(texto) {
        if (!this.activo || texto === this._ultimoEstado) return;
        this._ultimoEstado = texto;
        this._dibujarHUD();
    }

    // --- Construcción de HUD y botones auxiliares -------------------------------

    _construirTableroAux() {
        this.tablero.position.set(0, -0.82, -1.0);
        this.tablero.rotation.x = -0.65;

        this.botonesAux = BOTONES_AUX.map((def) => {
            const tam = 0.11;
            const mat = new THREE.MeshBasicMaterial({ map: this._texturaBoton(def), transparent: true });
            const m = new THREE.Mesh(new THREE.PlaneGeometry(tam, tam), mat);
            m.position.set(def.x, def.y, 0);
            m.userData = { ...def, mat, flash: 0, esAux: true };
            this.tablero.add(m);
            return m;
        });
    }

    _texturaBoton(def) {
        const c = document.createElement('canvas');
        c.width = c.height = 256;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#18233f';
        ctx.strokeStyle = def.color;
        ctx.lineWidth = 10;
        ctx.beginPath();
        ctx.roundRect(8, 8, 240, 240, 46);
        ctx.fill();
        ctx.stroke();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = def.color;
        ctx.font = '700 112px "Segoe UI Symbol", "DejaVu Sans", system-ui, sans-serif';
        ctx.fillText(def.glifo, 128, 100);
        ctx.font = '800 38px system-ui, "Segoe UI", sans-serif';
        ctx.fillStyle = '#eef1f8';
        ctx.fillText(def.texto, 128, 200);
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
    }

    _construirMira() {
        this.mira = new THREE.Group();
        this.mira.position.set(0, 0, -0.9);
        const punto = new THREE.Mesh(
            new THREE.RingGeometry(0.006, 0.011, 24),
            new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true })
        );
        punto.renderOrder = 999;
        this.matProgreso = new THREE.MeshBasicMaterial({ color: 0x3ddc97, depthTest: false, transparent: true, side: THREE.DoubleSide });
        this.anillo = new THREE.Mesh(new THREE.RingGeometry(0.016, 0.024, 32, 1, Math.PI / 2, 0.001), this.matProgreso);
        this.anillo.renderOrder = 1000;
        this.mira.add(punto, this.anillo);
    }

    _construirHUD() {
        this.hudCanvas = document.createElement('canvas');
        this.hudCanvas.width = 1024;
        this.hudCanvas.height = 128;
        this.hudTextura = new THREE.CanvasTexture(this.hudCanvas);
        this.hudTextura.colorSpace = THREE.SRGBColorSpace;
        this.hud = new THREE.Mesh(
            new THREE.PlaneGeometry(1.4, 0.175),
            new THREE.MeshBasicMaterial({ map: this.hudTextura, transparent: true })
        );
        this.hud.position.set(0, -0.48, -0.01);
        this.tablero.add(this.hud);
    }

    _dibujarHUD() {
        const ctx = this.hudCanvas.getContext('2d');
        const { width: W, height: H } = this.hudCanvas;
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = 'rgba(10, 16, 34, .85)';
        ctx.beginPath();
        ctx.roundRect(4, 4, W - 8, H - 8, 30);
        ctx.fill();
        const kmh = this.s.getVelocidadKmh?.() || 0;
        const turbo = this.s.motionState.highSpeed;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.font = '800 46px system-ui, sans-serif';
        ctx.fillStyle = turbo ? AMBAR : VERDE;
        ctx.fillText(`${kmh.toFixed(1)} km/h${turbo ? ' · TURBO' : ''}`, 32, 44);
        ctx.font = '500 30px system-ui, sans-serif';
        ctx.fillStyle = '#c7d2ec';
        const texto = (this._ultimoEstado || '').slice(0, 70);
        ctx.fillText(texto, 32, 96);
        this.hudTextura.needsUpdate = true;
        this._kmhDibujado = kmh.toFixed(1);
    }

    _ajustarTamano() {
        if (!this.activo) return;
        const w = window.innerWidth, h = window.innerHeight;
        this.s.camera.aspect = w / h;
        this.s.camera.updateProjectionMatrix();
        this.efecto.setSize(w, h);
    }

    // --- Entrada: sensor, arrastre y toques ----------------------------------------

    _orientacion(e) {
        if (e.alpha === null || e.beta === null || e.gamma === null) return;
        this.conSensor = true;
        const orient = THREE.MathUtils.degToRad((screen.orientation?.angle ?? window.orientation ?? 0));
        cuaternionDispositivo(
            this.qSensor,
            THREE.MathUtils.degToRad(e.alpha),
            THREE.MathUtils.degToRad(e.beta),
            THREE.MathUtils.degToRad(e.gamma),
            orient
        );
        if (this.recalibrar) {
            this.qOffset.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -rumbo(this.qSensor));
            this.recalibrar = false;
        }
    }

    _arrastrar(e) {
        if (!this._puntero || this.conSensor) return;
        const dx = e.clientX - this._puntero.x;
        const dy = e.clientY - this._puntero.y;
        if (Math.hypot(dx, dy) > 6) this._puntero.movido = true;
        this.arrastre.yaw = this._puntero.yaw + dx * 0.005;
        this.arrastre.pitch = THREE.MathUtils.clamp(this._puntero.pitch + dy * 0.005, -1.3, 1.3);
    }

    _tocar(e) {
        if (!this.activo) return;
        e.stopImmediatePropagation();
        e.preventDefault();
        this._puntero = { x: e.clientX, y: e.clientY, yaw: this.arrastre.yaw, pitch: this.arrastre.pitch, movido: false };
        const pid = e.pointerId;
        const toque = this._puntero;
        const alSoltar = (ev) => {
            if (ev.pointerId !== pid) return;
            window.removeEventListener('pointerup', alSoltar, true);
            if (!toque.movido && this.mirando) this._activar(this.mirando);
        };
        window.addEventListener('pointerup', alSoltar, true);
    }

    // --- Ciclo por cuadro ------------------------------------------------------------

    _actualizar() {
        if (!this.activo) return;
        const s = this.s;
        const ahora = performance.now();
        const dt = Math.min(0.25, (ahora - (this._ultimoCuadro || ahora)) / 1000);
        this._ultimoCuadro = ahora;

        this.rig.position.copy(s.vehicleGroup.position).add(OFFSET_JUGADOR);

        if (this.conSensor) {
            s.camera.quaternion.copy(this.qOffset).multiply(this.qSensor);
        } else {
            s.camera.quaternion.setFromEuler(new THREE.Euler(this.arrastre.pitch, this.arrastre.yaw, 0, 'YXZ'));
        }
        if (this.mira.parent !== s.camera) s.camera.add(this.mira);

        // Mirada: primero contra los botones 3D de Consola3D, luego contra los auxiliares (Centrar/Salir)
        s.camera.updateMatrixWorld();
        this.raycaster.setFromCamera(this.centro, s.camera);

        let objetivo = null;
        const hitConsola = this.consola3d?.intersectarRayo(this.raycaster);
        if (hitConsola) {
            objetivo = hitConsola.boton;
        } else {
            const hitAux = this.raycaster.intersectObjects(this.botonesAux, false)[0];
            if (hitAux) objetivo = hitAux.object;
        }

        if (this.consola3d) {
            this.consola3d._setHover(objetivo && !objetivo.userData.esAux ? objetivo : null);
        }

        if (objetivo !== this.mirando) {
            this.mirando = objetivo;
            this.progreso = 0;
        } else if (objetivo && !objetivo.userData.bloqueado) {
            this.progreso += dt / TIEMPO_MIRADA;
            if (this.progreso >= 1) {
                this._activar(objetivo);
                this.progreso = 0;
                objetivo.userData.bloqueado = true;
            }
        }

        const todos = [...(this.consola3d?.botones || []), ...this.botonesAux];
        for (const b of todos) {
            if (b !== this.mirando) b.userData.bloqueado = false;
        }

        // Anillo de progreso
        const ang = Math.max(0.001, this.progreso * Math.PI * 2);
        this.anillo.geometry.dispose();
        this.anillo.geometry = new THREE.RingGeometry(0.016, 0.024, 32, 1, Math.PI / 2, ang);

        const kmh = (s.getVelocidadKmh?.() || 0).toFixed(1);
        if (kmh !== this._kmhDibujado) this._dibujarHUD();
    }

    _activar(boton) {
        const u = boton.userData;
        // Reinicia la mirada para que un toque no se sume a la activación por mirada (evita doble activación)
        this.progreso = 0;
        u.bloqueado = true;
        if (u.esAux) {
            if (u.tipo === 'centrar') this.centrar();
            else if (u.tipo === 'salir') this.salir();
            return;
        }
        // Botón de la Consola 3D física
        this.consola3d?.activarBoton3D(boton, { autoSoltarMs: DURACION_MOVIMIENTO * 1000 });
        this.mostrarEstado(`${u.texto || u.cmd}`);
    }
}
