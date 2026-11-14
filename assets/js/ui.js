// assets/js/ui.js
const ICONOS = [
    [/SONIDO|AUDIO|VOLUM/, 'volume-up-fill'],
    [/MOTOR/, 'gear-fill'],
    [/LUZ|LUCES/, 'lightbulb-fill'],
    [/CLAXON|BOCINA/, 'megaphone-fill'],
    [/VELOC|ACELER|RAPID|TURBO/, 'speedometer2'],
    [/LENT|FRENAR/, 'hourglass-split'],
    [/360|GIRO|VUELTA/, 'arrow-repeat'],
    [/ZIG/, 'bezier2']
];

// Normaliza nombres: sin acentos, mayúsculas y con guion bajo ("Subir brazo" -> SUBIR_BRAZO)
export const normalizar = (n) => String(n || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim().replace(/[\s-]+/g, '_');

const iconoPara = (nombre) => {
    const hit = ICONOS.find(([re]) => re.test(String(nombre || '').toUpperCase()));
    return hit ? hit[1] : 'lightning-charge-fill';
};

// Escapa texto de la API antes de insertarlo con innerHTML
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const etiqueta = (nombre) => {
    const t = String(nombre || '').replace(/_/g, ' ').toLowerCase();
    return t.charAt(0).toUpperCase() + t.slice(1);
};

// Accesorios que se muestran (modo simulación) mientras AWS no responde
const ACCESORIOS_BASE = ['Velocidad', 'Sonido', 'Luz'];

class UIController {
    constructor() {
        if (window.__uiSingleton) return window.__uiSingleton;
        window.__uiSingleton = this;

        this.feedback = document.getElementById('action-feedback');
        this.statusWss = document.getElementById('status-wss');
        this.statusAws = document.getElementById('status-aws');
        this._timer = null;
        this._audioCtx = null;
        this.onSwitchToMonitoreo = null;
        this.onSwitchToAdmin = null;
        this.scene3d = null;
        this.vrManager = null;
        this.consola3d = null;

        this.initSplashScreen();
    }

    // Velocímetro: km/h actuales, máximo posible, modo turbo y estado del movimiento
    actualizarVelocimetro(kmh, maxKmh, turbo, estado) {
        if (!this._velo) {
            this._velo = {
                num: document.getElementById('velo-num'),
                fill: document.getElementById('velo-fill'),
                modo: document.getElementById('velo-modo'),
                estado: document.getElementById('velo-estado'),
                caja: document.getElementById('velocimetro')
            };
        }
        const v = this._velo;
        if (!v.num) return;
        const texto = kmh.toFixed(1);
        if (v.num.textContent !== texto) v.num.textContent = texto;
        v.fill.style.width = `${Math.min(100, (kmh / maxKmh) * 100)}%`;
        const modo = turbo ? 'Turbo' : 'Normal';
        if (v.modo.textContent !== modo) v.modo.textContent = modo;
        v.caja.classList.toggle('turbo', turbo);
        v.caja.classList.toggle('en-marcha', kmh > 0.05);
        if (v.estado.textContent !== estado) v.estado.textContent = estado;
        this.vrManager?.actualizarVelocidad?.(kmh, turbo, estado);
    }

    attach3DAndVR(scene3d, vrManager, consola3d = null) {
        this.scene3d = scene3d;
        this.vrManager = vrManager;
        this.consola3d = consola3d;
    }

    // --- PANTALLA DE BIENVENIDA / CARGA INICIAL (SPLASH SCREEN) ---
    initSplashScreen() {
        const splash = document.getElementById('splash-screen');
        const bar = document.getElementById('splash-progress-bar');
        if (!splash || !bar) return;

        const pasos = [
            [120, '28%'],
            [520, '62%'],
            [1050, '86%'],
            [1550, '100%']
        ];

        pasos.forEach(([delay, pct]) => {
            setTimeout(() => {
                bar.style.width = pct;
            }, delay);
        });

        setTimeout(() => {
            splash.classList.add('is-hidden');
        }, 1950);
    }

    // --- NAVEGACIÓN DE VISTAS (Control / Monitoreo / Administración) ---
    switchView(viewName) {
        this.playSound('tap');
        this.vibrar(10);

        const vistaControl = document.getElementById('vista-control');
        const vistaMonitoreo = document.getElementById('vista-monitoreo');
        const vistaAdmin = document.getElementById('vista-admin');
        const btnControl = document.getElementById('btn-tab-control');
        const btnMonitoreo = document.getElementById('btn-tab-monitoreo');
        const btnAdmin = document.getElementById('btn-tab-admin');

        if (!vistaControl || !vistaMonitoreo) return;

        document.body.dataset.view = viewName;

        vistaControl.classList.toggle('d-none', viewName !== 'control');
        vistaMonitoreo.classList.toggle('d-none', viewName !== 'monitoreo');
        if (vistaAdmin) {
            vistaAdmin.classList.toggle('d-none', viewName !== 'admin');
        }

        btnControl?.classList.toggle('active', viewName === 'control');
        btnMonitoreo?.classList.toggle('active', viewName === 'monitoreo');
        btnAdmin?.classList.toggle('active', viewName === 'admin');

        if (viewName === 'monitoreo' && this.onSwitchToMonitoreo) {
            this.onSwitchToMonitoreo();
        }
        if (viewName === 'admin' && this.onSwitchToAdmin) {
            this.onSwitchToAdmin();
        }
    }

    // --- FORMATO FECHAS ---
    formatearFechaHora(fechaIso) {
        if (!fechaIso) return { fecha: '--/--/----', hora: '--:--:--' };

        let str = String(fechaIso).trim();
        if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(str)) {
            str = str.replace(' ', 'T') + 'Z';
        }

        const date = new Date(str);
        if (isNaN(date.getTime())) return { fecha: '--/--/----', hora: '--:--:--' };

        const dia = String(date.getDate()).padStart(2, '0');
        const mes = String(date.getMonth() + 1).padStart(2, '0');
        const anio = date.getFullYear();
        const horas = String(date.getHours()).padStart(2, '0');
        const minutos = String(date.getMinutes()).padStart(2, '0');
        const segundos = String(date.getSeconds()).padStart(2, '0');
        return {
            fecha: `${dia}/${mes}/${anio}`,
            hora: `${horas}:${minutos}:${segundos}`
        };
    }

    _configVisualMovimiento(comandoStr) {
        const norm = normalizar(comandoStr);
        if (norm === 'DETENER' || norm === 'STOP') {
            return { icon: 'bi-stop-circle-fill', stateClass: 'state-danger' };
        }
        if (norm.includes('RETROCEDER') || norm.includes('ATRAS') || norm.includes('BAJAR')) {
            return { icon: 'bi-arrow-down-circle-fill', stateClass: 'state-warn' };
        }
        if (norm.includes('IZQUIERDA')) {
            return { icon: 'bi-arrow-left-circle-fill', stateClass: 'state-info' };
        }
        if (norm.includes('DERECHA')) {
            return { icon: 'bi-arrow-right-circle-fill', stateClass: 'state-info' };
        }
        if (norm.includes('SUBIR')) {
            return { icon: 'bi-arrow-up-circle-fill', stateClass: 'state-info' };
        }
        if (norm.includes('VELOC')) {
            return { icon: 'bi-speedometer2', stateClass: 'state-warn' };
        }
        if (norm.includes('SONIDO') || norm.includes('CLAXON')) {
            return { icon: 'bi-volume-up-fill', stateClass: 'state-info' };
        }
        if (norm.includes('LUZ')) {
            return { icon: 'bi-lightbulb-fill', stateClass: 'state-ok' };
        }
        return { icon: 'bi-arrow-up-circle-fill', stateClass: 'state-ok' };
    }

    // --- RENDERIZADO MONITOREO ---
    renderUltimoEstado(datos) {
        if (!datos) return;
        const item = Array.isArray(datos) ? datos[0] : (datos.datos || datos);
        if (!item) return;

        const nombreCmd = item.comando || item.nombre_comando || item.nombre || item.movimiento || 'Sin registro';
        const fechaRaw = item.fecha_actualizacion || item.fecha_hora || item.fecha || item.timestamp || item.created_at;
        const { fecha, hora } = this.formatearFechaHora(fechaRaw);

        const cmdEl = document.getElementById('monitoreo-comando');
        const fechaEl = document.getElementById('monitoreo-fecha');
        const horaEl = document.getElementById('monitoreo-hora');
        const iconEl = document.getElementById('monitoreo-icono');
        const cardEl = document.getElementById('monitoreo-card');

        if (cmdEl) cmdEl.textContent = nombreCmd;
        if (fechaEl) fechaEl.textContent = `Fecha: ${fecha}`;
        if (horaEl) horaEl.textContent = `Hora: ${hora}`;

        const { icon, stateClass } = this._configVisualMovimiento(nombreCmd);
        if (iconEl) iconEl.innerHTML = `<i class="bi ${icon}"></i>`;
        if (cardEl) {
            cardEl.classList.remove('state-ok', 'state-danger', 'state-warn', 'state-info');
            cardEl.classList.add(stateClass);
        }

        this.vrManager?.syncState({
            ultimoComando: nombreCmd,
            ultimaFecha: `${fecha} · ${hora}`
        });
    }

    renderHistorial(registros) {
        const tbody = document.getElementById('tabla-historial');
        if (!tbody) return;
        tbody.innerHTML = '';

        const lista = Array.isArray(registros) ? registros.slice(0, 10) : [];

        if (lista.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="monitor-empty">Sin registros de movimientos</td></tr>';
            this.vrManager?.syncState({ historial: [] });
            return;
        }

        const vrHistorial = [];

        lista.forEach((reg, index) => {
            const tr = document.createElement('tr');
            const nombreCmd = reg.comando || reg.nombre_comando || reg.nombre || reg.movimiento || 'Desconocido';
            const fechaRaw = reg.fecha_hora || reg.fecha_actualizacion || reg.fecha || reg.timestamp || reg.created_at;
            const { fecha, hora } = this.formatearFechaHora(fechaRaw);
            const { icon } = this._configVisualMovimiento(nombreCmd);

            tr.innerHTML = `
                <td><span class="monitor-row-num">${index + 1}</span></td>
                <td><span class="monitor-cmd-badge"><i class="bi ${icon}"></i> ${esc(nombreCmd)}</span></td>
                <td>${fecha}</td>
                <td>${hora}</td>
            `;
            tbody.appendChild(tr);

            vrHistorial.push({
                comando: nombreCmd,
                fecha_formateada: `${fecha} ${hora}`
            });
        });

        this.vrManager?.syncState({ historial: vrHistorial });
    }

    // --- SONIDOS WEB AUDIO API ---
    _getAudioCtx() {
        if (!this._audioCtx) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx) this._audioCtx = new AudioCtx();
        }
        if (this._audioCtx && this._audioCtx.state === 'suspended') {
            this._audioCtx.resume();
        }
        return this._audioCtx;
    }

    playSound(tipo = 'tap') {
        try {
            const ctx = this._getAudioCtx();
            if (!ctx) return;
            const now = ctx.currentTime;

            const tone = (freq, endFreq, duration, wave = 'sine', vol = 0.14, delay = 0) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = wave;
                osc.frequency.setValueAtTime(freq, now + delay);
                if (endFreq && endFreq !== freq) {
                    osc.frequency.exponentialRampToValueAtTime(endFreq, now + delay + duration);
                }
                gain.gain.setValueAtTime(0.001, now + delay);
                gain.gain.linearRampToValueAtTime(vol, now + delay + 0.01);
                gain.gain.exponentialRampToValueAtTime(0.001, now + delay + duration);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(now + delay);
                osc.stop(now + delay + duration);
            };

            if (tipo === 'stop') {
                tone(440, 180, 0.22, 'triangle', 0.2);
                tone(320, 130, 0.22, 'sawtooth', 0.08);
            } else if (tipo === 'start') {
                tone(523.25, 523.25, 0.1, 'sine', 0.16, 0);
                tone(659.25, 783.99, 0.18, 'sine', 0.18, 0.09);
            } else if (tipo === 'cancel') {
                tone(520, 440, 0.1, 'triangle', 0.15, 0);
                tone(380, 260, 0.18, 'triangle', 0.15, 0.09);
            } else if (tipo === 'horn') {
                tone(480, 480, 0.2, 'sawtooth', 0.12, 0);
                tone(600, 600, 0.2, 'triangle', 0.14, 0);
            } else if (tipo === 'speed') {
                tone(320, 880, 0.18, 'sine', 0.16, 0);
            } else if (tipo === 'light') {
                tone(880, 1174, 0.1, 'sine', 0.14, 0);
            } else if (tipo === 'joy') {
                tone(420, 560, 0.06, 'sine', 0.09, 0);
            } else {
                tone(620, 820, 0.08, 'sine', 0.14, 0);
            }
        } catch {
            // Ignorar si el navegador bloquea audio
        }
    }

    vibrar(ms = 12) {
        if (navigator.vibrate) navigator.vibrate(ms);
    }

    updateWssStatus(text, type) {
        this.statusWss.className = `badge bg-${type} status-badge`;
        this.statusWss.innerHTML = `<i class="bi bi-broadcast"></i> WSS: ${text}`;
        this.vrManager?.syncState({ wss: text });
    }

    updateAwsStatus(text) {
        let type = 'secondary';
        if (text === 'Disponible') type = 'success';
        else if (text === 'Comprobando...') type = 'warning';
        else type = 'danger';

        this.statusAws.className = `badge bg-${type} status-badge`;
        this.statusAws.innerHTML = `<i class="bi bi-cloud-check"></i> AWS: ${text}`;
        this.vrManager?.syncState({ aws: text });
    }

    updateAws(isAvailable) {
        this.updateAwsStatus(isAvailable ? 'Disponible' : 'No disponible');
    }

    updateWss(state, type) {
        this.updateWssStatus(state, type);
    }

    showFeedback(message, type = 'info', duration = 2000) {
        clearTimeout(this._timer);
        this.feedback.textContent = message;
        this.feedback.className = `alert alert-${type}`;

        if (type !== 'danger' && duration > 0) {
            this._timer = setTimeout(() => this.feedback.classList.add('d-none'), duration);
        }
    }

    setActiveDirectionalButton(normCmd) {
        document.querySelectorAll('.dir-btn.is-active').forEach((b) => b.classList.remove('is-active'));
        if (normCmd && normCmd !== 'DETENER' && normCmd !== 'STOP') {
            const btn = document.querySelector(`.dir-btn[data-cmd="${normCmd}"]`);
            if (btn) btn.classList.add('is-active');
        }
        this.scene3d?.applyCommand(normCmd);
        this.consola3d?.setActive(normCmd);
        this.vrManager?.syncState({ activeCmd: normCmd });
    }

    limpiarResaltadoDemo() {
        document.querySelectorAll('.dir-btn.demo-active').forEach((b) => b.classList.remove('demo-active'));
        document.querySelectorAll('.cmd-btn.sent').forEach((b) => b.classList.remove('sent'));
        this.scene3d?.applyCommand('DETENER');
        this.consola3d?.setActive(null);
        this.vrManager?.syncState({ activeCmd: null });
    }

    resaltarMovimientoDemo(nombreComando) {
        this.limpiarResaltadoDemo();
        const norm = normalizar(String(nombreComando || ''));
        if (!norm || norm === 'DETENER' || norm === 'STOP') return;

        this.scene3d?.applyCommand(norm);
        this.vrManager?.syncState({ activeCmd: norm });

        const alias = {
            'ADELANTE': 'AVANZAR',
            'ATRAS': 'RETROCEDER',
            'IZQUIERDA': 'GIRAR_IZQUIERDA',
            'DERECHA': 'GIRAR_DERECHA'
        };
        const targetCmd = alias[norm] || norm;
        this.consola3d?.setActive(targetCmd);

        const dirBtn = document.querySelector(`.dir-btn[data-cmd="${targetCmd}"]`);
        if (dirBtn) {
            dirBtn.classList.add('demo-active');
            return;
        }

        document.querySelectorAll('.cmd-btn').forEach((btn) => {
            if (normalizar(btn.textContent || '') === norm) {
                btn.classList.add('sent');
                setTimeout(() => btn.classList.remove('sent'), 600);
            }
        });
    }

    renderComandos(comandos, onCommandClick) {
        const container = document.getElementById('extra-commands-container');
        container.innerHTML = '';

        const btnStop = document.getElementById('btn-stop');
        if (btnStop) btnStop.disabled = false;

        const excluidos = [
            'AVANZAR', 'RETROCEDER', 'GIRAR_IZQUIERDA', 'GIRAR_DERECHA', 'DETENER', 'STOP',
            'SUBIR_BRAZO', 'BAJAR_BRAZO', 'MOTOR_IZQUIERDA', 'MOTOR_DERECHA'
        ];

        comandos.forEach((cmd) => {
            const nombreCmd = cmd.nombre || cmd.comando;
            if (nombreCmd && !excluidos.includes(normalizar(nombreCmd))) {
                container.appendChild(this._crearBotonAccesorio(nombreCmd, () => onCommandClick(cmd.id_comando, nombreCmd)));
            }
        });
    }

    // Accesorios de respaldo (modo simulación): funcionan aunque AWS no responda
    renderComandosPlaceholder(onCommandClick) {
        const container = document.getElementById('extra-commands-container');
        container.innerHTML = '';
        ACCESORIOS_BASE.forEach((nombre) => {
            container.appendChild(this._crearBotonAccesorio(nombre, () => onCommandClick?.(null, nombre)));
        });
    }

    // Sonido de cada accesorio (también lo usan la consola 3D y el modo VR)
    sonidoAccesorio(nombre) {
        const norm = normalizar(nombre);
        if (/SONIDO|CLAXON|BOCINA|AUDIO/.test(norm)) this.playSound('horn');
        else if (/VELOC|ACELER|TURBO|RAPID/.test(norm)) this.playSound('speed');
        else if (/LUZ|LUCES/.test(norm)) this.playSound('light');
        else this.playSound('tap');
    }

    _crearBotonAccesorio(nombreCmd, onClick) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cmd-btn';
        btn.innerHTML = `<span class="cmd-ico"><i class="bi bi-${iconoPara(nombreCmd)}"></i></span><span>${esc(etiqueta(nombreCmd))}</span>`;
        btn.onclick = () => {
            this.vibrar();
            this.sonidoAccesorio(nombreCmd);
            btn.classList.add('sent');
            setTimeout(() => btn.classList.remove('sent'), 250);
            onClick();
        };
        return btn;
    }

    // Sin conexión con AWS: los botones siguen activos en MODO SIMULACIÓN (solo mueven el gemelo 3D)
    setOffline(off) {
        document.body.classList.toggle('is-offline', off);
        document.getElementById('sim-chip')?.classList.toggle('d-none', !off);
        const stop = document.getElementById('btn-stop');
        if (stop) stop.disabled = false;
        document.querySelectorAll('.dir-btn').forEach((btn) => {
            btn.disabled = false;
        });
        this.vrManager?.syncState({ simulacion: off });
    }

    renderDemos(demos) {
        const select = document.getElementById('demo-select');
        select.innerHTML = '<option value="">Selecciona una DEMO</option>';
        if (!demos.length) select.innerHTML = '<option value="">Sin demos registradas</option>';
        demos.forEach((demo, idx) => {
            const option = document.createElement('option');
            option.value = demo.id_demo;
            option.textContent = demo.nombre;
            if (idx === 0) option.selected = true;
            select.appendChild(option);
        });

        select.disabled = false;
        document.getElementById('btn-demo-start').disabled = false;
        document.getElementById('btn-demo-cancel').disabled = false;

        if (demos.length > 0) {
            this.consola3d?.setDemoActual(demos[0].nombre);
        } else {
            this.consola3d?.setDemoActual('Sin demos registradas');
        }
        this.vrManager?.syncState({ demos, selectedDemoIndex: 0 });
    }
}

export const ui = new UIController();
export const UI = ui;
window.ui = ui;
