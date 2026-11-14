// assets/js/vr-celular.js
// "VR celular" estilo Cardboard: pantalla dividida (un ojo en cada mitad), vista controlada con
// el giroscopio del celular y botones 3D que se activan con la mirada o tocando la pantalla.
// Es independiente del Modo VR (WebXR) de las gafas Meta Quest.
import * as THREE from 'three';
import { StereoEffect } from 'three/addons/effects/StereoEffect.js';

const TIEMPO_MIRADA = 1.6;        // segundos mirando un botón para activarlo
const DURACION_MOVIMIENTO = 2.5;  // segundos que dura un movimiento activado con la mirada
const OFFSET_JUGADOR = new THREE.Vector3(0, 1.7, 3.2); // dónde está el usuario respecto al vehículo

const AMBAR = '#ffb43a', CIAN = '#5cc8ff', VERDE = '#3ddc97', ROJO = '#ff4d5e', GRIS = '#9aa6c4';

// Tablero de botones (coordenadas locales x, y en metros)
const D = 0.17;
const BOTONES = [
    // Movimiento (izquierda)
    { id: 'AVANZAR', glifo: '▲', texto: 'AVANZAR', x: -0.56, y: D, color: AMBAR, tipo: 'mover' },
    { id: 'RETROCEDER', glifo: '▼', texto: 'ATRÁS', x: -0.56, y: -D, color: AMBAR, tipo: 'mover' },
    { id: 'GIRAR_IZQUIERDA', glifo: '◀', texto: 'IZQ', x: -0.56 - D, y: 0, color: AMBAR, tipo: 'mover' },
    { id: 'GIRAR_DERECHA', glifo: '▶', texto: 'DER', x: -0.56 + D, y: 0, color: AMBAR, tipo: 'mover' },
    // Brazo y motores (derecha)
    { id: 'SUBIR_BRAZO', glifo: '▲', texto: 'SUBIR', x: 0.56, y: D, color: CIAN, tipo: 'mover' },
    { id: 'BAJAR_BRAZO', glifo: '▼', texto: 'BAJAR', x: 0.56, y: -D, color: CIAN, tipo: 'mover' },
    { id: 'MOTOR_IZQUIERDA', glifo: '↺', texto: 'MOTOR I', x: 0.56 - D, y: 0, color: CIAN, tipo: 'mover' },
    { id: 'MOTOR_DERECHA', glifo: '↻', texto: 'MOTOR D', x: 0.56 + D, y: 0, color: CIAN, tipo: 'mover' },
    // Accesorios y paro (centro)
    { id: 'VELOCIDAD', glifo: '»', texto: 'TURBO', x: -0.15, y: 0.2, color: AMBAR, tipo: 'accesorio' },
    { id: 'SONIDO', glifo: '♪', texto: 'SONIDO', x: 0, y: 0.2, color: CIAN, tipo: 'accesorio' },
    { id: 'LUZ', glifo: '☀', texto: 'LUZ', x: 0.15, y: 0.2, color: VERDE, tipo: 'accesorio' },
    { id: 'DETENER', glifo: '■', texto: 'STOP', x: 0, y: -0.02, color: ROJO, tipo: 'parar', grande: true },
    { id: 'CENTRAR', glifo: '◎', texto: 'CENTRAR', x: -0.1, y: -0.24, color: GRIS, tipo: 'centrar', chico: true },
    { id: 'SALIR', glifo: '✕', texto: 'SALIR', x: 0.1, y: -0.24, color: GRIS, tipo: 'salir', chico: true }
];

// Orientación del dispositivo -> cuaternión de la cámara (método clásico de DeviceOrientationControls)
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
    if (new URLSearchParams(location.search).get('vrcelular') === '1') return true; // forzar (pruebas)
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
     */
    constructor(scene3d, acciones) {
        this.s = scene3d;
        this.a = acciones;
        this.activo = false;
        this.efecto = new StereoEffect(scene3d.renderer);
        this.efecto.setEyeSeparation(0.064);

        this.rig = new THREE.Group();           // posición del usuario (sigue al vehículo, sin girar)
        this.tablero = new THREE.Group();       // botones frente al usuario
        this.raycaster = new THREE.Raycaster();
        this.centro = new THREE.Vector2(0, 0);
        this.qSensor = new THREE.Quaternion();
        this.qOffset = new THREE.Quaternion();
        this.recalibrar = true;
        this.conSensor = false;
        this.arrastre = { yaw: 0, pitch: 0 };
        this.mirando = null;
        this.progreso = 0;
        this.timerMov = null;

        this._construirTablero();
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

        // iPhone: permiso del sensor de movimiento (debe pedirse dentro del toque del usuario)
        if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
            try { await DeviceOrientationEvent.requestPermission(); } catch { /* se usa el arrastre */ }
        }
        // Pantalla completa y horizontal (Android); en iPhone se ignora si no se puede
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
        this.arrastre = { yaw: 0, pitch: -0.15 };
        document.body.classList.add('vr-celular');

        const s = this.s;
        this._pixelRatio = s.renderer.getPixelRatio();
        s.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5)); // menos carga para el celular
        s.modoExterno = true;
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

        this.mostrarEstado('Mira un botón 1.6 s para activarlo · toca la pantalla para activarlo al instante');
        this.a.activarVoz?.();
    }

    salir() {
        if (!this.activo) return;
        this.activo = false;
        this._cancelarMovimiento(true);

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

    // Comandos de voz propios de este modo ("salir", "centrar")
    comandoVoz(texto) {
        if (!this.activo) return false;
        const t = String(texto).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        if (/\b(salir|sal|cerrar|terminar vr|quitar vr)\b/.test(t)) { this.salir(); return true; }
        if (/\b(centra|centrar|recentra|recentrar|calibra|calibrar)\b/.test(t)) { this.centrar(); return true; }
        return false;
    }

    centrar() {
        this.recalibrar = true;
        this.arrastre.yaw = 0;
        this.arrastre.pitch = -0.15;
        this.mostrarEstado('Vista centrada');
    }

    mostrarEstado(texto) {
        if (!this.activo || texto === this._ultimoEstado) return;
        this._ultimoEstado = texto;
        this._dibujarHUD();
    }

    // --- Construcción de la escena del modo ----------------------------------------

    _construirTablero() {
        // Tablero frente al usuario, más abajo que los ojos e inclinado hacia él
        this.tablero.position.set(0, -0.8, -0.9);
        this.tablero.rotation.x = -0.75;

        const fondo = new THREE.Mesh(
            new THREE.PlaneGeometry(1.75, 0.68),
            new THREE.MeshBasicMaterial({ color: 0x0a1022, transparent: true, opacity: 0.82 })
        );
        fondo.position.z = -0.01;
        this.tablero.add(fondo);

        this.botones = BOTONES.map((def) => {
            const tam = def.grande ? 0.2 : def.chico ? 0.1 : 0.15;
            const mat = new THREE.MeshBasicMaterial({ map: this._texturaBoton(def), transparent: true });
            const m = new THREE.Mesh(new THREE.PlaneGeometry(tam, tam), mat);
            m.position.set(def.x, def.y, 0);
            m.userData = { ...def, mat, flash: 0 };
            this.tablero.add(m);
            return m;
        });
    }

    _texturaBoton(def) {
        const c = document.createElement('canvas');
        c.width = c.height = 256;
        const ctx = c.getContext('2d');
        ctx.fillStyle = def.tipo === 'parar' ? def.color : '#18233f';
        ctx.strokeStyle = def.color;
        ctx.lineWidth = 10;
        ctx.beginPath();
        if (def.tipo === 'parar') ctx.arc(128, 128, 118, 0, Math.PI * 2);
        else ctx.roundRect(8, 8, 240, 240, 46);
        ctx.fill();
        ctx.stroke();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = def.tipo === 'parar' ? '#ffffff' : def.color;
        ctx.font = '700 112px "Segoe UI Symbol", "DejaVu Sans", system-ui, sans-serif';
        ctx.fillText(def.tipo === 'parar' ? '' : def.glifo, 128, 100);
        ctx.font = `800 ${def.tipo === 'parar' ? 64 : 38}px system-ui, "Segoe UI", sans-serif`;
        ctx.fillStyle = '#eef1f8';
        ctx.fillText(def.texto, 128, def.tipo === 'parar' ? 132 : 200);
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
    }

    _construirMira() {
        // Punto de mira en el centro de la vista + anillo de progreso
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
        this.hud.position.set(0, -0.45, -0.01); // debajo del tablero para no tapar la excavadora
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
            // La dirección actual del celular pasa a ser "de frente a la excavadora"
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
        // Tocar la pantalla (o el botón del visor) activa al instante el botón que estás mirando
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
        // Tiempo real (no depende de los cuadros por segundo del celular)
        const ahora = performance.now();
        const dt = Math.min(0.25, (ahora - (this._ultimoCuadro || ahora)) / 1000);
        this._ultimoCuadro = ahora;

        // El usuario acompaña al vehículo (sin girar con él)
        this.rig.position.copy(s.vehicleGroup.position).add(OFFSET_JUGADOR);

        // Vista: sensor (con calibración) o arrastre
        if (this.conSensor) {
            s.camera.quaternion.copy(this.qOffset).multiply(this.qSensor);
        } else {
            s.camera.quaternion.setFromEuler(new THREE.Euler(this.arrastre.pitch, this.arrastre.yaw, 0, 'YXZ'));
        }
        if (this.mira.parent !== s.camera) s.camera.add(this.mira);

        // Mirada
        s.camera.updateMatrixWorld();
        this.raycaster.setFromCamera(this.centro, s.camera);
        const hit = this.raycaster.intersectObjects(this.botones, false)[0];
        const objetivo = hit ? hit.object : null;
        if (objetivo !== this.mirando) {
            this.mirando = objetivo;
            this.progreso = 0;
        } else if (objetivo && !objetivo.userData.bloqueado) {
            this.progreso += dt / TIEMPO_MIRADA;
            if (this.progreso >= 1) {
                this._activar(objetivo);
                this.progreso = 0;
                objetivo.userData.bloqueado = true; // no repetir hasta dejar de mirarlo
            }
        }
        for (const b of this.botones) {
            if (b !== this.mirando) b.userData.bloqueado = false;
            const u = b.userData;
            if (u.flash > 0) u.flash = Math.max(0, u.flash - dt);
            const activo = u.tipo === 'mover' && this.cmdActivo === u.id;
            const encendido = (u.id === 'LUZ' && s.motionState.lightsOn) || (u.id === 'VELOCIDAD' && s.motionState.highSpeed);
            const escala = u.flash > 0 || activo ? 1.12 : b === this.mirando ? 1.06 : 1;
            b.scale.setScalar(escala);
            u.mat.color.setScalar(activo || u.flash > 0 ? 1.35 : encendido ? 1.15 : b === this.mirando ? 1.1 : 0.85);
        }

        // Anillo de progreso
        const ang = Math.max(0.001, this.progreso * Math.PI * 2);
        this.anillo.geometry.dispose();
        this.anillo.geometry = new THREE.RingGeometry(0.016, 0.024, 32, 1, Math.PI / 2, ang);

        // Velocidad en el HUD (solo se redibuja si cambia)
        const kmh = (s.getVelocidadKmh?.() || 0).toFixed(1);
        if (kmh !== this._kmhDibujado) this._dibujarHUD();
    }

    _activar(boton) {
        const u = boton.userData;
        u.flash = 0.35;
        switch (u.tipo) {
            case 'mover':
                this._cancelarMovimiento(false);
                this.cmdActivo = u.id;
                this.a.presionar(u.id);
                this.timerMov = setTimeout(() => this._cancelarMovimiento(true), DURACION_MOVIMIENTO * 1000);
                this.mostrarEstado(`${u.texto} · ${DURACION_MOVIMIENTO} s (mira STOP para detener)`);
                break;
            case 'accesorio':
                this.a.accesorio(u.id);
                this.mostrarEstado(u.texto);
                break;
            case 'parar':
                this._cancelarMovimiento(false);
                this.a.parar();
                this.mostrarEstado('STOP');
                break;
            case 'centrar':
                this.centrar();
                break;
            case 'salir':
                this.salir();
                break;
        }
    }

    _cancelarMovimiento(soltar) {
        clearTimeout(this.timerMov);
        this.timerMov = null;
        if (this.cmdActivo && soltar) this.a.soltar();
        this.cmdActivo = null;
    }
}
