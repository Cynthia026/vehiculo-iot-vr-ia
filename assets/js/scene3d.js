// assets/js/scene3d.js
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class Scene3DManager {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) return;

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x040711);
        this.scene.fog = new THREE.FogExp2(0x040711, 0.032);

        this.camera = new THREE.PerspectiveCamera(
            55,
            window.innerWidth / window.innerHeight,
            0.1,
            150
        );
        // Cámara elevada para ver la excavadora y, delante, la consola de botones 3D
        this.defaultCamPos = new THREE.Vector3(3.3, 3.7, 4.5);
        this.defaultTarget = new THREE.Vector3(0.35, 0.3, 0.25);
        this.camera.position.copy(this._camPosParaPantalla());

        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
            powerPreference: 'high-performance'
        });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.xr.enabled = true;

        this._ajustarEncuadre();
        this.camera.updateProjectionMatrix();

        this.controls = new OrbitControls(this.camera, this.canvas);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.06;
        this.controls.target.copy(this.defaultTarget);
        this.controls.minDistance = 1.6;
        this.controls.maxDistance = 9.5;
        this.controls.maxPolarAngle = Math.PI * 0.48;
        // Si el usuario rota la cámara con el vehículo quieto, se respeta su vista
        this.controls.addEventListener('start', () => {
            if (this.motionState.drive === 0 && this.motionState.turn === 0) this._recentrar = false;
        });

        // Estado cinemático del gemelo digital
        this.motionState = {
            drive: 0,         // -1 atrás, 0 quieto, +1 adelante
            turn: 0,          // -1 izquierda, 0 recto, +1 derecha
            arm: 0,           // -1 bajar, 0 quieto, +1 subir
            turret: 0,        // -1 izq, 0 quieto, +1 der
            armAngle: 0.35,   // Ángulo actual del brazo hidráulico
            turretAngle: 0,   // Rotación de la cabina/motores
            lightsOn: true,
            highSpeed: false,
            soundPulse: 0
        };

        this.clock = new THREE.Clock();
        this.wheels = [];
        this.vrHooks = [];
        this.obstaculos = []; // Zonas que el vehículo no puede atravesar ({ x, z, r })
        this.modoExterno = false;  // true mientras otro modo (VR celular) controla la cámara
        this.renderizador = null;  // función de render alternativa (pantalla dividida)

        // Seguimiento de cámara: cada vez que el vehículo avanza o gira, la vista se recentra
        // (con el mismo ángulo inicial) para no perder la excavadora ni la consola de controles.
        this.desplazamiento = new THREE.Vector3();  // Cuánto se ha movido el vehículo desde su posición inicial
        this._recentrar = false;
        this._prevPos = new THREE.Vector3();
        this.velocidad = 0;          // m/s (suavizada)
        this.VELOCIDAD_BASE = 1.35;  // m/s en modo normal
        this.FACTOR_TURBO = 1.85;

        this._initLights();
        this._initSpaceEnvironment();
        this._initArenaPlatform();
        this._initExcavatorModel();
        this._bindResize();

        this.renderer.setAnimationLoop(() => this._animate());
    }

    registerVRUpdate(fn) {
        if (typeof fn === 'function') this.vrHooks.push(fn);
    }

    resetCamera() {
        if (this.renderer.xr.isPresenting) return;
        this._recentrar = false;
        this.camera.position.copy(this._camPosParaPantalla()).add(this.desplazamiento);
        this.controls.target.copy(this.defaultTarget).add(this.desplazamiento);
        this.controls.update();
    }

    // Velocidad lineal actual del vehículo en km/h y la máxima posible en el modo actual
    getVelocidadKmh() {
        return this.velocidad * 3.6;
    }
    getVelocidadMaxKmh() {
        return this.VELOCIDAD_BASE * this.FACTOR_TURBO * 3.6;
    }

    // Lleva la cámara suavemente a la vista inicial, desplazada hasta donde está el vehículo
    _seguirVehiculo(dt) {
        const ms = this.motionState;
        const enMovimiento = ms.drive !== 0 || ms.turn !== 0;
        if (enMovimiento) this._recentrar = true;
        if (!this._recentrar || this.renderer.xr.isPresenting) return;

        const k = 1 - Math.exp(-dt * 4.5);
        const objetivo = this.defaultTarget.clone().add(this.desplazamiento);
        const posCam = this._camPosParaPantalla().add(this.desplazamiento);
        this.controls.target.lerp(objetivo, k);
        this.camera.position.lerp(posCam, k);

        if (!enMovimiento && this.camera.position.distanceTo(posCam) < 0.01 && this.controls.target.distanceTo(objetivo) < 0.01) {
            this._recentrar = false;
        }
    }

    // En celular vertical los controles ocupan la parte alta: se baja el modelo al espacio libre
    _ajustarEncuadre() {
        const w = window.innerWidth, h = window.innerHeight;
        if (w / h < 1) this.camera.setViewOffset(w, h, 0, -h * 0.2, w, h);
        else this.camera.clearViewOffset();
    }

    // En pantallas verticales (celular) la cámara se aleja para que la excavadora quepa completa
    _camPosParaPantalla() {
        const aspect = window.innerWidth / window.innerHeight;
        return this.defaultCamPos.clone().multiplyScalar(aspect < 1 ? 1.75 : 1);
    }

    _initLights() {
        const hemi = new THREE.HemisphereLight(0x8ec5ff, 0x0c1328, 0.95);
        this.scene.add(hemi);

        const keyLight = new THREE.DirectionalLight(0xffffff, 1.4);
        keyLight.position.set(5, 8, 5);
        keyLight.castShadow = true;
        keyLight.shadow.mapSize.set(1024, 1024);
        this.scene.add(keyLight);

        const rimAmber = new THREE.PointLight(0xffb43a, 2.2, 12);
        rimAmber.position.set(-3.5, 2.2, -2.5);
        this.scene.add(rimAmber);

        const rimCyan = new THREE.PointLight(0x5cc8ff, 2.2, 12);
        rimCyan.position.set(3.5, 2.2, -2.5);
        this.scene.add(rimCyan);
    }

    _initSpaceEnvironment() {
        const starCount = 1200;
        const positions = new Float32Array(starCount * 3);
        const colors = new Float32Array(starCount * 3);
        const palette = [
            new THREE.Color(0xffffff),
            new THREE.Color(0x9bd2ff),
            new THREE.Color(0xffd488),
            new THREE.Color(0x6dd5ff)
        ];

        for (let i = 0; i < starCount; i++) {
            const r = 18 + Math.random() * 55;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);

            positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
            positions[i * 3 + 1] = Math.abs(r * Math.cos(phi)) + 1.5;
            positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

            const c = palette[i % palette.length];
            colors[i * 3] = c.r;
            colors[i * 3 + 1] = c.g;
            colors[i * 3 + 2] = c.b;
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const mat = new THREE.PointsMaterial({
            size: 0.22,
            vertexColors: true,
            transparent: true,
            opacity: 0.85
        });

        this.starField = new THREE.Points(geo, mat);
        this.scene.add(this.starField);
    }

    _initArenaPlatform() {
        // Plataforma base circular
        const baseGeo = new THREE.CylinderGeometry(4.4, 4.7, 0.16, 48);
        const baseMat = new THREE.MeshStandardMaterial({
            color: 0x0b1224,
            metalness: 0.65,
            roughness: 0.35
        });
        const platform = new THREE.Mesh(baseGeo, baseMat);
        platform.position.set(0, -0.08, -0.4);
        platform.receiveShadow = true;
        this.scene.add(platform);

        // Cuadrícula táctica
        const grid = new THREE.GridHelper(7.2, 18, 0x5cc8ff, 0x1c2b4d);
        grid.position.set(0, 0.005, -0.4);
        this.scene.add(grid);

        // Anillo luminoso perimetral
        const ringGeo = new THREE.RingGeometry(4.25, 4.35, 64);
        const ringMat = new THREE.MeshBasicMaterial({
            color: 0x5cc8ff,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.65
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(0, 0.01, -0.4);
        this.scene.add(ring);
    }

    _initExcavatorModel() {
        this.vehicleGroup = new THREE.Group();
        this.vehicleGroup.position.set(0, 0, -0.4);
        this.posInicialVehiculo = this.vehicleGroup.position.clone();
        this.scene.add(this.vehicleGroup);

        const darkMetal = new THREE.MeshStandardMaterial({ color: 0x1a233a, metalness: 0.7, roughness: 0.3 });
        const amberPaint = new THREE.MeshStandardMaterial({ color: 0xffb43a, metalness: 0.35, roughness: 0.35 });
        const cyanAccent = new THREE.MeshStandardMaterial({
            color: 0x5cc8ff,
            emissive: 0x1e6fa8,
            emissiveIntensity: 0.6,
            metalness: 0.5,
            roughness: 0.2
        });
        const trackMat = new THREE.MeshStandardMaterial({ color: 0x10141f, roughness: 0.85 });

        // Chasis inferior
        const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.22, 1.45), darkMetal);
        chassis.position.y = 0.24;
        chassis.castShadow = true;
        this.vehicleGroup.add(chassis);

        // Orugas izquierda y derecha + ruedas internas
        [-0.68, 0.68].forEach((xPos) => {
            const track = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.3, 1.65), trackMat);
            track.position.set(xPos, 0.17, 0);
            track.castShadow = true;
            this.vehicleGroup.add(track);

            [-0.58, 0, 0.58].forEach((zPos) => {
                const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.28, 16), cyanAccent);
                wheel.rotation.z = Math.PI / 2;
                wheel.position.set(xPos, 0.17, zPos);
                this.vehicleGroup.add(wheel);
                this.wheels.push(wheel);
            });
        });

        // Torreta giratoria superior (responde a MOTOR_IZQUIERDA / MOTOR_DERECHA)
        this.turretGroup = new THREE.Group();
        this.turretGroup.position.set(0, 0.36, 0);
        this.vehicleGroup.add(this.turretGroup);

        const bodyBox = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.42, 1.15), amberPaint);
        bodyBox.position.set(0, 0.22, -0.08);
        bodyBox.castShadow = true;
        this.turretGroup.add(bodyBox);

        // Cabina acristalada
        const cabinMat = new THREE.MeshStandardMaterial({
            color: 0x6dd5ff,
            emissive: 0x14385c,
            metalness: 0.8,
            roughness: 0.15,
            transparent: true,
            opacity: 0.82
        });
        const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.44, 0.56), cabinMat);
        cabin.position.set(-0.26, 0.56, 0.12);
        this.turretGroup.add(cabin);

        // Faros LED frontales (responden a comando LUZ)
        this.headlightMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            emissive: 0xa6ebff,
            emissiveIntensity: 1.8
        });
        [-0.32, 0.32].forEach((x) => {
            const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.065, 12, 12), this.headlightMat);
            lamp.position.set(x, 0.3, 0.52);
            this.turretGroup.add(lamp);
        });

        this.headSpotLight = new THREE.SpotLight(0xa6ebff, 4.5, 8, Math.PI / 5, 0.45);
        this.headSpotLight.position.set(0, 0.42, 0.55);
        this.headSpotLight.target.position.set(0, 0, 3.2);
        this.turretGroup.add(this.headSpotLight);
        this.turretGroup.add(this.headSpotLight.target);

        // Pivote del brazo excavador (responde a SUBIR_BRAZO / BAJAR_BRAZO)
        this.armPivot = new THREE.Group();
        this.armPivot.position.set(0.22, 0.38, 0.42);
        this.turretGroup.add(this.armPivot);

        const boom = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 1.05), amberPaint);
        boom.position.set(0, 0.25, 0.42);
        boom.rotation.x = -0.45;
        boom.castShadow = true;
        this.armPivot.add(boom);

        const forearm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.68, 0.14), darkMetal);
        forearm.position.set(0, 0.12, 0.92);
        forearm.rotation.x = 0.25;
        forearm.castShadow = true;
        this.armPivot.add(forearm);

        const bucket = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.22, 0.28), cyanAccent);
        bucket.position.set(0, -0.22, 1.02);
        bucket.castShadow = true;
        this.armPivot.add(bucket);

        // Onda visual para comando SONIDO / CLAXON
        const soundGeo = new THREE.RingGeometry(0.5, 0.62, 32);
        this.soundMat = new THREE.MeshBasicMaterial({
            color: 0x3ddc97,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0
        });
        this.soundRing = new THREE.Mesh(soundGeo, this.soundMat);
        this.soundRing.rotation.x = -Math.PI / 2;
        this.soundRing.position.y = 0.03;
        this.vehicleGroup.add(this.soundRing);
    }

    applyCommand(normCmd) {
        if (!normCmd) return;

        if (normCmd === 'DETENER' || normCmd === 'STOP') {
            this.motionState.drive = 0;
            this.motionState.turn = 0;
            this.motionState.arm = 0;
            this.motionState.turret = 0;
            return;
        }

        // Un movimiento nuevo reemplaza al anterior (voz, gestos o giroscopio pueden cambiar sin soltar)
        const MOVIMIENTOS = ['AVANZAR', 'ADELANTE', 'RETROCEDER', 'ATRAS', 'GIRAR_IZQUIERDA', 'GIRAR_DERECHA', 'IZQUIERDA', 'DERECHA',
            'SUBIR_BRAZO', 'BAJAR_BRAZO', 'MOTOR_IZQUIERDA', 'MOTOR_DERECHA'];
        if (MOVIMIENTOS.includes(normCmd)) {
            this.motionState.drive = 0;
            this.motionState.turn = 0;
            this.motionState.arm = 0;
            this.motionState.turret = 0;
        }

        if (normCmd === 'AVANZAR' || normCmd === 'ADELANTE') {
            this.motionState.drive = 1;
            this.motionState.turn = 0;
        } else if (normCmd === 'RETROCEDER' || normCmd === 'ATRAS') {
            this.motionState.drive = -1;
            this.motionState.turn = 0;
        } else if (normCmd === 'GIRAR_IZQUIERDA' || normCmd === 'IZQUIERDA') {
            this.motionState.turn = 1;
            this.motionState.drive = 0;
        } else if (normCmd === 'GIRAR_DERECHA' || normCmd === 'DERECHA') {
            this.motionState.turn = -1;
            this.motionState.drive = 0;
        } else if (normCmd === 'SUBIR_BRAZO') {
            this.motionState.arm = 1;
        } else if (normCmd === 'BAJAR_BRAZO') {
            this.motionState.arm = -1;
        } else if (normCmd === 'MOTOR_IZQUIERDA') {
            this.motionState.turret = 1;
        } else if (normCmd === 'MOTOR_DERECHA') {
            this.motionState.turret = -1;
        } else if (normCmd.includes('LUZ')) {
            this.motionState.lightsOn = !this.motionState.lightsOn;
            this.headSpotLight.visible = this.motionState.lightsOn;
            this.headlightMat.emissiveIntensity = this.motionState.lightsOn ? 1.8 : 0.05;
        } else if (normCmd.includes('VELOC')) {
            this.motionState.highSpeed = !this.motionState.highSpeed;
        } else if (normCmd.includes('SONIDO') || normCmd.includes('CLAXON')) {
            this.motionState.soundPulse = 1.0;
        }
    }

    _animate() {
        const dt = Math.min(this.clock.getDelta(), 0.05);
        const speedMult = this.motionState.highSpeed ? this.FACTOR_TURBO : 1.0;

        if (this.starField) {
            this.starField.rotation.y += dt * 0.015;
        }

        if (this.vehicleGroup) {
            this._prevPos.copy(this.vehicleGroup.position);

            // Giro del chasis
            if (this.motionState.turn !== 0) {
                this.vehicleGroup.rotation.y += this.motionState.turn * dt * 1.55 * speedMult;
            }

            // Avance / retroceso dentro del límite seguro de la plataforma
            if (this.motionState.drive !== 0) {
                const forward = new THREE.Vector3(0, 0, 1).applyAxisAngle(
                    new THREE.Vector3(0, 1, 0),
                    this.vehicleGroup.rotation.y
                );
                const nextPos = this.vehicleGroup.position.clone().addScaledVector(
                    forward,
                    this.motionState.drive * dt * this.VELOCIDAD_BASE * speedMult
                );
                const distFromCenter = Math.hypot(nextPos.x, nextPos.z + 0.4);
                const choca = this.obstaculos.some((o) => Math.hypot(nextPos.x - o.x, nextPos.z - o.z) < o.r);
                if (distFromCenter < 3.1 && !choca) {
                    this.vehicleGroup.position.copy(nextPos);
                }
            }

            // Animación de ruedas de las orugas
            if (this.motionState.drive !== 0 || this.motionState.turn !== 0) {
                const wheelDir = this.motionState.drive || this.motionState.turn;
                this.wheels.forEach((w) => {
                    w.rotation.x += wheelDir * dt * 6.5 * speedMult;
                });
            }

            // Rotación de la cabina/motores
            if (this.motionState.turret !== 0) {
                this.motionState.turretAngle += this.motionState.turret * dt * 1.6 * speedMult;
                this.turretGroup.rotation.y = this.motionState.turretAngle;
            }

            // Elevación del brazo hidráulico con topes mecánicos
            if (this.motionState.arm !== 0) {
                this.motionState.armAngle = THREE.MathUtils.clamp(
                    this.motionState.armAngle + this.motionState.arm * dt * 1.25 * speedMult,
                    -0.35,
                    0.78
                );
                this.armPivot.rotation.x = -this.motionState.armAngle;
            }

            // Onda visual de sonido
            if (this.motionState.soundPulse > 0) {
                this.motionState.soundPulse = Math.max(0, this.motionState.soundPulse - dt * 1.4);
                const scale = 1 + (1 - this.motionState.soundPulse) * 3.2;
                this.soundRing.scale.set(scale, scale, 1);
                this.soundMat.opacity = this.motionState.soundPulse * 0.85;
            }
        }

        if (this.vehicleGroup) {
            // Velocidad real (si choca con el borde de la plataforma, es 0)
            const v = dt > 0 ? this.vehicleGroup.position.distanceTo(this._prevPos) / dt : 0;
            this.velocidad += (v - this.velocidad) * Math.min(1, dt * 8);
            if (this.velocidad < 0.01 || this.motionState.drive === 0) this.velocidad = 0;

            this.desplazamiento.copy(this.vehicleGroup.position).sub(this.posInicialVehiculo);
            if (!this.modoExterno) this._seguirVehiculo(dt);
        }

        for (const hook of this.vrHooks) {
            hook(dt);
        }

        if (!this.renderer.xr.isPresenting && !this.modoExterno) {
            this.controls.update();
        }

        if (this.renderizador && !this.renderer.xr.isPresenting) this.renderizador();
        else this.renderer.render(this.scene, this.camera);
    }

    _bindResize() {
        const onResize = () => {
            if (this.renderer.xr.isPresenting || this.modoExterno) return;
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this._ajustarEncuadre();
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        };
        window.addEventListener('resize', onResize);
        window.addEventListener('orientationchange', () => setTimeout(onResize, 120));
    }
}
