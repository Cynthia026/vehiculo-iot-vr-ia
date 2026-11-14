// assets/js/vr-controls.js
import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';

export class VRManager {
    constructor(scene3d, callbacks) {
        this.scene3d = scene3d;
        this.scene = scene3d.scene;
        this.renderer = scene3d.renderer;
        this.callbacks = callbacks; // { onPressCommand, onReleaseCommand, onStop, onStartDemo, onCancelDemo, onFeedback }

        this.currentSession = null;
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
        this.activeTriggerHold = new Map(); // controllerIndex -> { cmd }

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
            if (this.currentSession) {
                await this.currentSession.end();
                return;
            }

            if (!this.xrSupported) {
                this.callbacks.onFeedback?.(
                    'Visor VR no detectado. Ábrelo desde el navegador de tus gafas VR (ej. Meta Quest).',
                    'warning',
                    4000
                );
                return;
            }

            try {
                const session = await navigator.xr.requestSession('immersive-vr', {
                    optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking']
                });
                await this._onSessionStarted(session);
            } catch (err) {
                console.error('Error iniciando WebXR:', err);
                this.callbacks.onFeedback?.('No se pudo iniciar la sesión VR', 'danger');
            }
        });
    }

    async _onSessionStarted(session) {
        this.currentSession = session;
        await this.renderer.xr.setSession(session);
        this.vrGroup.visible = true;

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

        this._redrawControlCanvas();
        this._redrawMonitorCanvas();

        session.addEventListener('end', () => {
            this.currentSession = null;
            this.vrGroup.visible = false;
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
        // Panel Izquierdo: 4.1 Control
        this.controlCanvas = document.createElement('canvas');
        this.controlCanvas.width = 1024;
        this.controlCanvas.height = 860;
        this.controlCtx = this.controlCanvas.getContext('2d');
        this.controlTexture = new THREE.CanvasTexture(this.controlCanvas);
        this.controlHitboxes = [];

        const controlMesh = new THREE.Mesh(
            new THREE.PlaneGeometry(1.45, 1.22),
            new THREE.MeshBasicMaterial({ map: this.controlTexture, transparent: true })
        );
        controlMesh.position.set(-1.38, 1.32, 0.72);
        controlMesh.rotation.y = 0.44;
        controlMesh.userData.panelType = 'control';
        this.vrGroup.add(controlMesh);
        this.interactiveMeshes.push(controlMesh);

        // Panel Derecho: 4.2 Monitoreo y Salud
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
        monitorMesh.position.set(1.38, 1.32, 0.72);
        monitorMesh.rotation.y = -0.44;
        monitorMesh.userData.panelType = 'monitor';
        this.vrGroup.add(monitorMesh);
        this.interactiveMeshes.push(monitorMesh);
        this.monitorMesh = monitorMesh;

        this._redrawControlCanvas();
        this._redrawMonitorCanvas();
    }

    syncState(partial) {
        Object.assign(this.state, partial);
        if (this.vrGroup.visible) {
            this._redrawControlCanvas();
            this._redrawMonitorCanvas();
        }
    }

    // Velocidad mostrada en el panel VR (solo se redibuja si cambia el texto)
    actualizarVelocidad(kmh, turbo, estado) {
        const texto = `${kmh.toFixed(1)} km/h · ${turbo ? 'TURBO' : 'Normal'} · ${estado}`;
        if (texto === this._velocidadTexto) return;
        this._velocidadTexto = texto;
        this.state.velocidadTexto = texto;
        this.state.velocidadTurbo = turbo;
        if (this.vrGroup.visible) this._redrawControlCanvas();
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

    _redrawControlCanvas() {
        const ctx = this.controlCtx;
        const W = this.controlCanvas.width;
        const H = this.controlCanvas.height;
        this.controlHitboxes = [];

        ctx.clearRect(0, 0, W, H);
        this._drawRoundRect(ctx, 8, 8, W - 16, H - 16, 36, 'rgba(10, 16, 34, 0.92)', 'rgba(92, 200, 255, 0.45)');

        ctx.fillStyle = '#eef1f8';
        ctx.font = 'bold 34px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('4.1 CONTROL IOT · VR', 42, 64);

        ctx.fillStyle = '#9aa6c4';
        ctx.font = '22px sans-serif';
        ctx.fillText('Mantén gatillo para mover · Botón lateral (Grip) = DETENER', 42, 98);

        // Velocidad actual
        ctx.fillStyle = this.state.velocidadTurbo ? '#ffb43a' : '#3ddc97';
        ctx.font = 'bold 22px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(`⏱ ${this.state.velocidadTexto || '0.0 km/h · Normal · Detenido'}`, W - 42, 64);

        const addButton = (id, label, x, y, w, h, rgb, hold = false, action = null) => {
            const active = this.state.activeCmd === id;
            const fill = active ? `rgb(${rgb})` : `rgba(${rgb}, 0.22)`;
            const stroke = active ? '#ffffff' : `rgba(${rgb}, 0.75)`;
            this._drawRoundRect(ctx, x, y, w, h, 20, fill, stroke);

            ctx.fillStyle = active ? '#051020' : '#eef1f8';
            ctx.font = 'bold 23px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(label, x + w / 2, y + h / 2 + 8);

            this.controlHitboxes.push({ id, x, y, w, h, hold, action });
        };

        // Bloque Movimiento (Ámbar)
        ctx.fillStyle = '#ffb43a';
        ctx.font = 'bold 24px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('MOVIMIENTO', 46, 150);

        addButton('AVANZAR', '▲ AVANZAR', 180, 170, 175, 82, '255, 180, 58', true);
        addButton('GIRAR_IZQUIERDA', '◄ IZQ', 46, 266, 155, 82, '255, 180, 58', true);
        addButton('GIRAR_DERECHA', 'DER ►', 334, 266, 155, 82, '255, 180, 58', true);
        addButton('RETROCEDER', '▼ ATRÁS', 180, 362, 175, 82, '255, 180, 58', true);

        // Bloque Brazo y Motores (Cian)
        ctx.fillStyle = '#5cc8ff';
        ctx.textAlign = 'left';
        ctx.fillText('BRAZO Y MOTORES', 535, 150);

        addButton('SUBIR_BRAZO', '▲ SUBIR BRAZO', 665, 170, 195, 82, '92, 200, 255', true);
        addButton('MOTOR_IZQUIERDA', '↺ MOT IZQ', 535, 266, 160, 82, '92, 200, 255', true);
        addButton('MOTOR_DERECHA', 'MOT DER ↻', 820, 266, 160, 82, '92, 200, 255', true);
        addButton('BAJAR_BRAZO', '▼ BAJAR BRAZO', 665, 362, 195, 82, '92, 200, 255', true);

        // Accesorios
        ctx.fillStyle = '#3ddc97';
        ctx.textAlign = 'left';
        ctx.fillText('ACCESORIOS', 46, 495);

        addButton('VELOCIDAD', 'VELOCIDAD', 46, 515, 295, 76, '255, 180, 58', false);
        addButton('SONIDO', 'SONIDO', 364, 515, 295, 76, '92, 200, 255', false);
        addButton('LUZ', 'LUZ LED', 682, 515, 298, 76, '61, 220, 151', false);

        // Demos
        const demoObj = this.state.demos[this.state.selectedDemoIndex];
        const demoLabel = demoObj ? `DEMO: ${demoObj.nombre}` : 'SIN DEMOS';
        addButton('DEMO_CYCLE', demoLabel, 46, 616, 480, 76, '160, 195, 255', false, 'cycle_demo');
        addButton('DEMO_START', '▶ INICIAR', 544, 616, 210, 76, '61, 220, 151', false, 'start_demo');
        addButton('DEMO_CANCEL', '✕ CANCELAR', 770, 616, 210, 76, '255, 93, 108', false, 'cancel_demo');

        // Botón DETENER
        addButton('DETENER', '🛑 DETENER VEHÍCULO', 46, 720, 934, 96, '255, 93, 108', false, 'stop');

        this.controlTexture.needsUpdate = true;
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

    _raycastPanel(controller) {
        this.tempMatrix.identity().extractRotation(controller.matrixWorld);
        this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
        this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMatrix);

        const hits = this.raycaster.intersectObjects(this.interactiveMeshes, false);
        const laser = controller.getObjectByName('laser');

        if (hits.length === 0) {
            if (laser) laser.scale.z = 1;
            return null;
        }

        const hit = hits[0];
        if (laser) laser.scale.z = hit.distance / 4;

        if (hit.object.userData.panelType === 'control' && hit.uv) {
            const px = hit.uv.x * this.controlCanvas.width;
            const py = (1 - hit.uv.y) * this.controlCanvas.height;
            const btn = this.controlHitboxes.find(
                (b) => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h
            );
            return btn || null;
        }
        return null;
    }

    _updateVRControllers() {
        if (!this.currentSession) return;
        for (const controller of this.controllers) {
            this._raycastPanel(controller);
        }
    }

    _onTriggerDown(controller) {
        const hitBtn = this._raycastPanel(controller);
        if (!hitBtn) return;

        this._pulseHaptic(controller, 0.45, 40);

        if (hitBtn.action === 'stop') {
            this.callbacks.onStop?.();
            return;
        }
        if (hitBtn.action === 'cycle_demo') {
            if (this.state.demos.length > 0) {
                this.state.selectedDemoIndex = (this.state.selectedDemoIndex + 1) % this.state.demos.length;
                const sel = document.getElementById('demo-select');
                if (sel) sel.value = this.state.demos[this.state.selectedDemoIndex].id_demo;
                this._redrawControlCanvas();
            }
            return;
        }
        if (hitBtn.action === 'start_demo') {
            const demo = this.state.demos[this.state.selectedDemoIndex];
            if (demo) this.callbacks.onStartDemo?.(demo.id_demo);
            return;
        }
        if (hitBtn.action === 'cancel_demo') {
            this.callbacks.onCancelDemo?.();
            return;
        }

        if (hitBtn.hold) {
            this.activeTriggerHold.set(controller.userData.index, hitBtn.id);
            this.callbacks.onPressCommand?.(hitBtn.id);
        } else {
            this.callbacks.onPressCommand?.(hitBtn.id, true);
        }
    }

    _onTriggerUp(controller) {
        const idx = controller.userData.index;
        if (this.activeTriggerHold.has(idx)) {
            this.activeTriggerHold.delete(idx);
            this.callbacks.onReleaseCommand?.();
        }
    }
}
