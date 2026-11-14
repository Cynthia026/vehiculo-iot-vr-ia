// assets/js/vr-controls.js
import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';

export class VRManager {
    constructor(scene3d, callbacks, consola3d = null) {
        this.scene3d = scene3d;
        this.scene = scene3d.scene;
        this.renderer = scene3d.renderer;
        this.callbacks = callbacks; // { onPressCommand, onReleaseCommand, onStop, onStartDemo, onCancelDemo, onFeedback }
        this.consola3d = consola3d;

        this.currentSession = null;
        this.pcVRMode = false; // Modo VR visualizado directamente en la computadora
        this.xrSupported = false;
        this.raycaster = new THREE.Raycaster();
        this.tempMatrix = new THREE.Matrix4();

        // Estado reflejado en las consolas 3D
        this.state = {
            wss: 'Desconectado',
            aws: 'Comprobando...',
            rds: 'Sin verificar',
            ultimoComando: 'Sin registro',
            ultimaFecha: '--/--/---- --:--:--',
            historial: [],
            demos: [],
            selectedDemoIndex: 0,
            activeCmd: null
        };

        this.vrGroup = new THREE.Group();
        this.vrGroup.visible = false; // Solo visible dentro de la sesión VR
        this.scene.add(this.vrGroup);

        this.interactiveMeshes = [];
        this.controllers = [];
        this.activeTriggerHold = new Map(); // controllerIndex -> { type, cmd }

        this._buildSpatialPanels();
        this._setupControllers();
        this._setupXRButton();

        this.scene3d.registerVRUpdate(() => this._updateVRControllers());
    }

    async _setupXRButton() {
        const btnVr = document.getElementById('btn-vr');
        const label = document.getElementById('btn-vr-label');
        if (!btnVr) return;

        if ('xr' in navigator) {
            try {
                this.xrSupported = await navigator.xr.isSessionSupported('immersive-vr');
            } catch {
                this.xrSupported = false;
            }
        }

        if (!this.xrSupported && label) {
            label.textContent = 'Modo VR';
        }

        btnVr.addEventListener('click', async () => {
            // Si hay sesión WebXR activa en gafas, salir
            if (this.currentSession) {
                await this.currentSession.end();
                return;
            }

            // Si estamos en Modo VR de computadora, salir y volver a la vista normal
            if (this.pcVRMode) {
                this._setPCVRMode(false);
                return;
            }

            // Si hay gafas WebXR conectadas, iniciar sesión inmersiva en los lentes
            if (this.xrSupported) {
                try {
                    const session = await navigator.xr.requestSession('immersive-vr', {
                        optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking']
                    });
                    await this._onSessionStarted(session);
                    return;
                } catch (err) {
                    console.warn('WebXR no pudo abrirse en visor externo, activando Modo VR en pantalla:', err);
                }
            }

            // En computadora sin gafas conectadas: activar Modo VR con la Consola 3D junto a la excavadora
            this._setPCVRMode(true);
        });
    }

    _setPCVRMode(activo) {
        this.pcVRMode = Boolean(activo);
        const btnVr = document.getElementById('btn-vr');
        const label = document.getElementById('btn-vr-label');

        document.body.classList.toggle('vr-mode-pc', this.pcVRMode);
        this.consola3d?.setModoVR(this.pcVRMode);
        this.scene3d?.setModoConsolaVR?.(this.pcVRMode);

        btnVr?.classList.toggle('vr-active', this.pcVRMode);
        if (label) label.textContent = this.pcVRMode ? 'Salir VR' : 'Modo VR';

        if (this.pcVRMode) {
            this.callbacks.onFeedback?.(
                'Modo VR activo: Usa la Consola 3D junto a la excavadora (Movimiento, Brazo, IA, Asistente y Demos)',
                'info',
                3800
            );
        } else {
            this.callbacks.onStop?.();
            this.callbacks.onFeedback?.('Vista normal de computadora restaurada', 'info', 2000);
        }
    }

    async _onSessionStarted(session) {
        this.currentSession = session;
        await this.renderer.xr.setSession(session);
        this.vrGroup.visible = true;
        this.consola3d?.setModoVR(true);

        try {
            const base = this.renderer.xr.getReferenceSpace();
            if (base && typeof XRRigidTransform !== 'undefined') {
                const offset = base.getOffsetReferenceSpace(new XRRigidTransform({ x: 0, y: 0, z: -2.4 }));
                this.renderer.xr.setReferenceSpace(offset);
            }
        } catch (e) {
            console.warn('No se pudo ajustar la posición inicial en VR:', e);
        }

        const btnVr = document.getElementById('btn-vr');
        const label = document.getElementById('btn-vr-label');
        btnVr?.classList.add('vr-active');
        if (label) label.textContent = 'Salir VR';

        this._redrawMonitorCanvas();

        session.addEventListener('end', () => {
            this.currentSession = null;
            this.vrGroup.visible = false;
            this.consola3d?.setModoVR(false);
            btnVr?.classList.remove('vr-active');
            if (label) label.textContent = 'Modo VR';
            this.callbacks.onStop?.();
        });
    }

    _setupControllers() {
        const modelFactory = new XRControllerModelFactory();

        for (let i = 0; i < 2; i++) {
            const controller = this.renderer.xr.getController(i);
            controller.userData.index = i;

            // Puntero láser
            const lineGeo = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(0, 0, 0),
                new THREE.Vector3(0, 0, -4)
            ]);
            const lineMat = new THREE.LineBasicMaterial({ color: 0x5cc8ff });
            const laser = new THREE.Line(lineGeo, lineMat);
            laser.name = 'laser';
            controller.add(laser);

            // Gatillo principal (selectstart / selectend)
            controller.addEventListener('selectstart', () => this._onTriggerDown(controller));
            controller.addEventListener('selectend', () => this._onTriggerUp(controller));

            // Botón lateral físico (squeeze): Paro de emergencia inmediato
            controller.addEventListener('squeezestart', () => {
                this._pulseHaptic(controller, 0.9, 120);
                this.callbacks.onStop?.();
            });

            this.vrGroup.add(controller);
            this.controllers.push(controller);

            const grip = this.renderer.xr.getControllerGrip(i);
            grip.add(modelFactory.createControllerModel(grip));
            this.vrGroup.add(grip);
        }
    }

    _pulseHaptic(controller, intensity = 0.5, durationMs = 45) {
        const gp = controller?.userData?.inputSource?.gamepad;
        if (gp?.hapticActuators?.[0]) {
            gp.hapticActuators[0].pulse(intensity, durationMs);
        }
    }

    _buildSpatialPanels() {
        // En gafas VR el control principal es la Consola 3D física (Consola3D) junto a la excavadora;
        // a la derecha se muestra el panel espacial de Monitoreo RDS (4.2)
        this.monitorCanvas = document.createElement('canvas');
        this.monitorCanvas.width = 1024;
        this.monitorCanvas.height = 860;
        this.monitorCtx = this.monitorCanvas.getContext('2d');
        this.monitorTexture = new THREE.CanvasTexture(this.monitorCanvas);
        this.monitorHitboxes = [];

        const monitorMesh = new THREE.Mesh(
            new THREE.PlaneGeometry(1.45, 1.22),
            new THREE.MeshBasicMaterial({ map: this.monitorTexture, transparent: true })
        );
        monitorMesh.position.set(1.45, 1.32, 0.72);
        monitorMesh.rotation.y = -0.44;
        monitorMesh.userData.panelType = 'monitor';
        this.vrGroup.add(monitorMesh);
        this.interactiveMeshes.push(monitorMesh);
        this.monitorMesh = monitorMesh;

        this._redrawMonitorCanvas();
    }

    syncState(partial) {
        Object.assign(this.state, partial);
        if (partial.demos || partial.selectedDemoIndex !== undefined) {
            const demoObj = this.state.demos?.[this.state.selectedDemoIndex];
            if (demoObj) {
                this.consola3d?.setDemoActual(demoObj.nombre);
            }
        }
        if (this.vrGroup.visible) {
            this._redrawMonitorCanvas();
        }
    }

    actualizarVelocidad(kmh, turbo, estado) {
        const texto = `${kmh.toFixed(1)} km/h · ${turbo ? 'TURBO' : 'Normal'} · ${estado}`;
        if (texto === this._velocidadTexto) return;
        this._velocidadTexto = texto;
        this.state.velocidadTexto = texto;
        this.state.velocidadTurbo = turbo;
    }

    _drawRoundRect(ctx, x, y, w, h, r, fill, stroke) {
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, r);
        if (fill) {
            ctx.fillStyle = fill;
            ctx.fill();
        }
        if (stroke) {
            ctx.strokeStyle = stroke;
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    }

    _redrawMonitorCanvas() {
        const ctx = this.monitorCtx;
        const W = this.monitorCanvas.width;
        const H = this.monitorCanvas.height;
        this.monitorHitboxes = [];

        ctx.clearRect(0, 0, W, H);
        this._drawRoundRect(ctx, 8, 8, W - 16, H - 16, 36, 'rgba(10, 16, 34, 0.92)', 'rgba(61, 220, 151, 0.45)');

        ctx.fillStyle = '#eef1f8';
        ctx.font = 'bold 34px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('4.2 MONITOREO RDS & TELEMETRÍA', 42, 64);

        // Badges de estado
        const badges = [
            { text: `WSS: ${this.state.wss}`, ok: this.state.wss === 'En línea', x: 42 },
            { text: `AWS: ${this.state.aws}`, ok: this.state.aws === 'Disponible', x: 365 },
            { text: `RDS: ${this.state.rds}`, ok: this.state.rds === 'Disponible', x: 688 }
        ];
        badges.forEach((b) => {
            const rgb = b.ok ? '61, 220, 151' : '255, 180, 58';
            this._drawRoundRect(ctx, b.x, 90, 294, 48, 24, `rgba(${rgb}, 0.2)`, `rgba(${rgb}, 0.7)`);
            ctx.fillStyle = b.ok ? '#3ddc97' : '#ffb43a';
            ctx.font = 'bold 21px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(b.text, b.x + 147, 121);
        });

        // Tarjeta Último Movimiento
        this._drawRoundRect(ctx, 42, 162, 940, 145, 24, 'rgba(28, 39, 68, 0.85)', 'rgba(92, 200, 255, 0.5)');
        ctx.fillStyle = '#5cc8ff';
        ctx.font = 'bold 22px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('ÚLTIMO MOVIMIENTO REGISTRADO', 70, 202);

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 42px sans-serif';
        ctx.fillText(String(this.state.ultimoComando || 'Sin registro'), 70, 252);

        ctx.fillStyle = '#9aa6c4';
        ctx.font = '22px sans-serif';
        ctx.fillText(String(this.state.ultimaFecha || '--/--/---- --:--:--'), 70, 288);

        // Tabla Últimos 10 movimientos
        ctx.fillStyle = '#eef1f8';
        ctx.font = 'bold 24px sans-serif';
        ctx.fillText('ÚLTIMOS 10 MOVIMIENTOS (AMAZON RDS)', 42, 348);

        this._drawRoundRect(ctx, 42, 366, 940, 452, 20, 'rgba(8, 13, 28, 0.85)', 'rgba(160, 195, 255, 0.22)');

        const rows = (this.state.historial || []).slice(0, 10);
        if (rows.length === 0) {
            ctx.fillStyle = '#9aa6c4';
            ctx.font = '24px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Sin registros en el historial', W / 2, 580);
        } else {
            rows.forEach((reg, idx) => {
                const y = 408 + idx * 41;
                if (idx % 2 === 1) {
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
                    ctx.fillRect(52, y - 26, 920, 36);
                }
                const nombre = reg.comando || reg.nombre_comando || reg.nombre || 'Comando';
                const fecha = reg.fecha_formateada || reg.fecha_hora || '';

                ctx.textAlign = 'left';
                ctx.fillStyle = '#5cc8ff';
                ctx.font = 'bold 21px sans-serif';
                ctx.fillText(`#${idx + 1}`, 70, y);

                ctx.fillStyle = '#eef1f8';
                ctx.fillText(String(nombre), 145, y);

                ctx.textAlign = 'right';
                ctx.fillStyle = '#9aa6c4';
                ctx.font = '20px sans-serif';
                ctx.fillText(String(fecha), 955, y);
            });
        }

        this.monitorTexture.needsUpdate = true;
    }

    _raycastConsola(controller) {
        this.tempMatrix.identity().extractRotation(controller.matrixWorld);
        this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
        this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMatrix);

        const laser = controller.getObjectByName('laser');

        // 1. Primero verificamos intersección con los botones 3D de Consola3D
        const hitConsola = this.consola3d?.intersectarRayo(this.raycaster);
        if (hitConsola) {
            if (laser) laser.scale.z = hitConsola.distance / 4;
            return { tipo: 'consola3d', boton: hitConsola.boton };
        }

        // 2. Intersección con el panel de Monitoreo
        const hits = this.raycaster.intersectObjects(this.interactiveMeshes, false);
        if (hits.length > 0) {
            if (laser) laser.scale.z = hits[0].distance / 4;
        } else if (laser) {
            laser.scale.z = 1;
        }
        return null;
    }

    _updateVRControllers() {
        if (!this.currentSession) return;
        for (const controller of this.controllers) {
            this._raycastConsola(controller);
        }
    }

    _onTriggerDown(controller) {
        const hit = this._raycastConsola(controller);
        if (!hit) return;

        this._pulseHaptic(controller, 0.45, 40);

        if (hit.tipo === 'consola3d' && hit.boton) {
            const esHold = hit.boton.userData?.tipo === 'hold';
            if (esHold) {
                this.activeTriggerHold.set(controller.userData.index, { tipo: 'consola3d' });
            }
            this.consola3d.activarBoton3D(hit.boton);
        }
    }

    _onTriggerUp(controller) {
        const idx = controller.userData.index;
        if (this.activeTriggerHold.has(idx)) {
            this.activeTriggerHold.delete(idx);
            this.consola3d?._soltar();
        }
    }
}
