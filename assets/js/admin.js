// assets/js/admin.js
// Módulo 4.3 · Administración IoT
// - Todo lo que se muestra viene de Amazon RDS a través de FastAPI. Si un dato no se puede
//   obtener se muestra "Sin datos" o el error real: NUNCA se simula un éxito en memoria.
// - El acceso exige sesión real (JWT): Administrador / Usuario con contraseña, o Invitado temporal.
// - La seguridad real está en el servidor; aquí sólo se ocultan opciones y se explica el resultado.
import { api } from './api.js?v=37';
import { CONFIG } from './config.js?v=29';
import { ui, normalizar } from './ui.js?v=29';

const SESSION_TOKEN_KEY = 'vehiculo_iot_jwt_session';
const SOLICITUD_KEY = 'vehiculo_iot_solicitud_fisico';   // solicitud en espera (sobrevive a recargar la página)
const PRESTAMO = 'PRESTAMO_FISICO';

const mmss = (seg) => {
    const s = Math.max(0, Math.floor(Number(seg) || 0));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

try {
    // Restos de versiones anteriores que guardaban estado simulado
    localStorage.removeItem('vehiculo_iot_admin_state_v1');
} catch (_) {}

// Escapa texto de la base de datos antes de insertarlo como HTML (evita XSS almacenado)
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const SIN_DATOS = (cols, texto = 'Sin datos') =>
    `<tr><td colspan="${cols}" class="text-center text-secondary py-2"><i class="bi bi-database-x"></i> ${esc(texto)}</td></tr>`;

// Comando inexistente: las pruebas de seguridad lo usan para que, si el servidor llegara a autorizar,
// responda 422 (comando no pertenece a la unidad) y el vehículo NUNCA se mueva.
const ID_COMANDO_PRUEBA = 0;

class AdminManager {
    constructor() {
        this.state = {
            modelos: [],
            clientes: [],
            auditoria: [],
            sesionesActivas: [],
            reservaInvitado: null,
            solicitudFisico: null,      // visitante: { codigo, nombre, estado, creada_ts }
            panelPrestamo: null         // admin: respuesta de /api/admin/solicitudes-invitado
        };
        this.sesion = null;            // { id_usuario, nombre, email, rol }
        this.unidadesRds = [];         // unidades visibles para la sesión actual (filtradas por el servidor)
        this.errorCarga = null;        // último error real al leer RDS
        this.comandosUnidadAdmin = [];
        this.demosUnidadEditor = [];
        this.movimientosDemoActual = [];
        this.idUnidadComandosSel = null;
        this.idDemoSeleccionada = null;
        this.guestInterval = null;
        this.solicitudInterval = null;
        this.adminSolicitudesInterval = null;
        this.adminRelojInterval = null;
        this._pendientesVistos = null;
        this.onUnitChanged = null;
        this.onStopVehicle = null;
    }

    // ------------------------------------------------------------------ arranque / sesión

    async init(callbacks = {}) {
        this.onUnitChanged = callbacks.onUnitChanged || null;
        this.onStopVehicle = callbacks.onStopVehicle || null;
        this._bindEvents();
        this.renderizarTodo();

        const savedToken = sessionStorage.getItem(SESSION_TOKEN_KEY);
        if (savedToken) {
            CONFIG.setAuthToken(savedToken);
            try {
                const me = await api.obtenerPerfilActual();
                if (me?.usuario) {
                    this.sesion = me.usuario;
                    if (this.sesion.rol === 'INVITADO' && me.usuario.segundos_restantes) {
                        this.state.reservaInvitado = {
                            id_vehiculo: me.usuario.id_vehiculo_reservado,
                            nombre_vehiculo: me.unidades?.[0]?.nombre || `Unidad #${me.usuario.id_vehiculo_reservado}`,
                            operador: me.usuario.nombre,
                            tipo_sesion: me.usuario.tipo_sesion || 'INVITADO',
                            expira_ts: Date.now() + Number(me.usuario.segundos_restantes) * 1000,
                            activa: true
                        };
                        this._iniciarRelojInvitado();
                    }
                }
            } catch (_) {
                this._limpiarSesionLocal();
            }
        }

        await this.sincronizarDesdeRds({ elegirUnidad: true });

        // Si el visitante recargó la página mientras esperaba la aprobación, se sigue esperando
        if (!this.sesion) {
            try {
                const pend = JSON.parse(sessionStorage.getItem(SOLICITUD_KEY) || 'null');
                if (pend?.codigo) {
                    this.state.solicitudFisico = pend;
                    this._iniciarSondeoSolicitud();
                }
            } catch (_) {}
        }
    }

    _limpiarSesionLocal() {
        clearInterval(this.guestInterval);
        sessionStorage.removeItem(SESSION_TOKEN_KEY);
        CONFIG.setAuthToken(null);
        this.sesion = null;
        this.state.reservaInvitado = null;
        this.state.clientes = [];
        this.state.auditoria = [];
        this.state.sesionesActivas = [];
    }

    async iniciarSesionConCredenciales(email, password) {
        const res = await api.login(email, password);
        CONFIG.setAuthToken(res.access_token);
        sessionStorage.setItem(SESSION_TOKEN_KEY, res.access_token);
        this.sesion = res.usuario;
        await this.sincronizarDesdeRds({ elegirUnidad: true, forzarSeleccion: true });
        ui.playSound('start');
        ui.showFeedback(`Bienvenido, ${this.sesion.nombre} (${this.sesion.rol})`, 'success', 2800);
    }

    async iniciarSesionInvitadoReal(nombreVisitante = 'Visitante Showroom') {
        const res = await api.iniciarSesionInvitado(nombreVisitante);
        await this._aplicarSesionInvitado(res, nombreVisitante, 'Prueba de exhibición iniciada: tienes 3 minutos');
    }

    async _aplicarSesionInvitado(res, nombreVisitante, mensaje) {
        CONFIG.setAuthToken(res.access_token);
        sessionStorage.setItem(SESSION_TOKEN_KEY, res.access_token);
        this.sesion = res.usuario;
        const idExh = res.reserva?.id_vehiculo;
        const segRestantes = Number(res.reserva?.segundos_restantes || res.expires_in || 180);
        this.state.reservaInvitado = {
            id_vehiculo: idExh,
            nombre_vehiculo: res.reserva?.nombre_vehiculo || `Unidad #${idExh}`,
            operador: nombreVisitante,
            tipo_sesion: res.reserva?.tipo_sesion || res.usuario?.tipo_sesion || 'INVITADO',
            expira_ts: Date.now() + segRestantes * 1000,
            activa: true
        };
        this._iniciarRelojInvitado();
        await this.sincronizarDesdeRds({ elegirUnidad: false });
        if (idExh) await this.seleccionarUnidadActiva(idExh, false);
        this.renderizarTodo();
        ui.playSound('start');
        ui.showFeedback(mensaje, 'success', 3500);
    }

    // ------------------------------------------------------------------ vehículo físico: lado del visitante

    async solicitarVehiculoFisico(nombre) {
        if (this.state.solicitudFisico) {
            ui.showFeedback('Ya tienes una solicitud en espera', 'info', 2500);
            return;
        }
        const r = await api.solicitarVehiculoFisico(nombre);
        this.state.solicitudFisico = { codigo: r.codigo, nombre, estado: 'PENDIENTE', vehiculo: r.nombre_vehiculo, creada_ts: Date.now() };
        try { sessionStorage.setItem(SOLICITUD_KEY, JSON.stringify(this.state.solicitudFisico)); } catch (_) {}
        ui.playSound('tap');
        ui.showFeedback('Solicitud enviada: espera a que el administrador la apruebe', 'info', 3500);
        this._iniciarSondeoSolicitud();
    }

    _iniciarSondeoSolicitud() {
        clearInterval(this.solicitudInterval);
        this.renderSolicitudVisitante();
        this.solicitudInterval = setInterval(() => this._consultarSolicitud(), 3000);
        this._consultarSolicitud();
    }

    _terminarSolicitud(mensaje, tipo = 'warning') {
        clearInterval(this.solicitudInterval);
        this.solicitudInterval = null;
        this.state.solicitudFisico = null;
        try { sessionStorage.removeItem(SOLICITUD_KEY); } catch (_) {}
        this.renderSolicitudVisitante();
        if (mensaje) {
            ui.playSound(tipo === 'success' ? 'start' : 'cancel');
            ui.showFeedback(mensaje, tipo, 4500);
        }
    }

    async _consultarSolicitud() {
        const sol = this.state.solicitudFisico;
        if (!sol || this._consultando) return;
        this._consultando = true;
        try {
            const r = await api.consultarSolicitudFisico(sol.codigo);
            if (r.estado === 'APROBADA' && r.access_token) {
                this._terminarSolicitud(null);
                await this._aplicarSesionInvitado(r, sol.nombre, '¡Aprobado! Ya puedes manejar el vehículo físico durante 3 minutos');
                document.getElementById('btn-tab-control')?.click();
                return;
            }
            const finales = {
                RECHAZADA: 'El administrador rechazó tu solicitud',
                EXPIRADA: 'Tu solicitud expiró: nadie la respondió en 5 minutos',
                CANCELADA: 'Solicitud cancelada',
                FINALIZADA: 'El préstamo ya terminó',
                APROBADA: 'El acceso ya se entregó en otro navegador'
            };
            if (finales[r.estado]) {
                this._terminarSolicitud(finales[r.estado], 'warning');
                return;
            }
            sol.estado = r.estado;
            this.renderSolicitudVisitante();
        } catch (err) {
            if (err.status === 404) this._terminarSolicitud('La solicitud ya no existe', 'warning');
            // Sin conexión: se reintenta en el siguiente ciclo
        } finally {
            this._consultando = false;
        }
    }

    async cancelarSolicitudFisico() {
        const sol = this.state.solicitudFisico;
        if (!sol) return;
        try { await api.cancelarSolicitudFisico(sol.codigo); } catch (_) {}
        this._terminarSolicitud('Solicitud cancelada', 'info');
    }

    renderSolicitudVisitante() {
        const box = document.getElementById('guest-solicitud-status');
        if (!box) return;
        const sol = this.state.solicitudFisico;
        box.classList.toggle('d-none', !sol);
        document.querySelectorAll('#form-auth-guest button').forEach((b) => { b.disabled = Boolean(sol); });
        if (!sol) { box.innerHTML = ''; return; }
        const espera = Math.floor((Date.now() - (sol.creada_ts || Date.now())) / 1000);
        box.innerHTML = `
            <div class="solicitud-espera d-flex flex-wrap align-items-center justify-content-between gap-2">
                <span class="small"><span class="spinner-border spinner-border-sm text-warning me-1" role="status"></span>
                    Esperando aprobación del administrador para <b>${esc(sol.vehiculo || 'el vehículo físico')}</b> · ${mmss(espera)}</span>
                <button type="button" class="btn btn-sm btn-outline-danger py-0 px-2" data-action="cancelar-solicitud-fisico"><i class="bi bi-x-circle"></i> Cancelar</button>
            </div>`;
        const cancelar = box.querySelector('[data-action="cancelar-solicitud-fisico"]');
        if (cancelar) cancelar.disabled = false;
    }

    // ------------------------------------------------------------------ vehículo físico: lado del Administrador

    _controlarSondeoAdmin(activo) {
        if (activo && !this.adminSolicitudesInterval) {
            this.adminSolicitudesInterval = setInterval(() => {
                if (document.visibilityState === 'visible') this.cargarSolicitudesAdmin();
            }, 4000);
            this.adminRelojInterval = setInterval(() => this._tickRelojPrestamo(), 1000);
            this.cargarSolicitudesAdmin();
        } else if (!activo && this.adminSolicitudesInterval) {
            clearInterval(this.adminSolicitudesInterval);
            clearInterval(this.adminRelojInterval);
            this.adminSolicitudesInterval = null;
            this.adminRelojInterval = null;
            this._pendientesVistos = null;
            this.state.panelPrestamo = null;
        }
    }

    async cargarSolicitudesAdmin() {
        if (this.sesion?.rol !== 'ADMIN') return;
        try {
            const r = await api.obtenerSolicitudesInvitado();
            r._recibido_ts = Date.now();
            const ids = new Set((r.pendientes || []).map((p) => p.id_solicitud));
            if (this._pendientesVistos) {
                const nuevas = (r.pendientes || []).filter((p) => !this._pendientesVistos.has(p.id_solicitud));
                if (nuevas.length) {
                    ui.playSound('start');
                    ui.showFeedback(`Nueva solicitud: ${nuevas[0].nombre_visitante} quiere manejar el vehículo físico`, 'warning', 5000);
                }
            }
            const habiaPrestamo = Boolean(this.state.panelPrestamo?.prestamo_activo);
            this._pendientesVistos = ids;
            this.state.panelPrestamo = r;
            this.renderSolicitudesAdmin();
            // Cuando termina un préstamo se recargan métricas y bitácora
            if (habiaPrestamo && !r.prestamo_activo) this.sincronizarDesdeRds();
        } catch (err) {
            this.state.panelPrestamo = { error: err.status ? `HTTP ${err.status}: ${err.message}` : 'Sin conexión con AWS' };
            this.renderSolicitudesAdmin();
        }
    }

    _tickRelojPrestamo() {
        const el = document.getElementById('prestamo-countdown');
        const p = this.state.panelPrestamo;
        if (!el || !p?.prestamo_activo) return;
        const rest = Number(p.prestamo_activo.segundos_restantes) - (Date.now() - p._recibido_ts) / 1000;
        el.textContent = mmss(rest);
    }

    renderSolicitudesAdmin() {
        const cont = document.getElementById('admin-solicitudes-fisico');
        if (!cont) return;
        const p = this.state.panelPrestamo;
        if (!p) { cont.innerHTML = '<div class="small text-secondary">Cargando solicitudes…</div>'; return; }
        if (p.error) { cont.innerHTML = `<div class="small text-warning"><i class="bi bi-database-x"></i> Sin datos: ${esc(p.error)}</div>`; return; }
        const u = p.unidad_fisica || {};
        const pendientes = p.pendientes || [];
        const prestamo = p.prestamo_activo;
        const cabecera = `
            <div class="small text-secondary mb-2">
                <i class="bi bi-cpu"></i> Carrito real: <b class="text-light">#${esc(u.id_vehiculo)} ${esc(u.nombre || '')}</b>
                ${u.nombre_propietario ? ` · dueño: <b class="text-light">${esc(u.nombre_propietario)}</b> (queda bloqueado mientras dura el préstamo)` : ''}
            </div>`;
        const enCurso = prestamo ? `
            <div class="prestamo-activo d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
                <div>
                    <span class="badge bg-success me-1"><i class="bi bi-broadcast-pin"></i> EN CURSO</span>
                    <b>${esc(prestamo.nombre_operador)}</b> está manejando el vehículo físico
                </div>
                <div class="d-flex align-items-center gap-2">
                    <span class="badge bg-warning text-dark fs-6"><i class="bi bi-stopwatch"></i> <span id="prestamo-countdown">${mmss(prestamo.segundos_restantes)}</span></span>
                    <button type="button" class="btn btn-sm btn-outline-danger py-0 px-2" data-action="terminar-prestamo"><i class="bi bi-stop-circle"></i> Terminar y detener</button>
                </div>
            </div>` : '';
        const lista = pendientes.length ? pendientes.map((s) => `
            <div class="solicitud-item d-flex flex-wrap align-items-center justify-content-between gap-2">
                <div>
                    <span class="badge bg-warning text-dark me-1">PENDIENTE</span>
                    <b>${esc(s.nombre_visitante)}</b>
                    <span class="small text-secondary">· esperando ${mmss(s.segundos_esperando)}</span>
                </div>
                <div class="d-flex gap-1">
                    <button type="button" class="btn btn-sm btn-success py-0 px-2" data-action="aprobar-solicitud" data-id="${s.id_solicitud}" ${prestamo ? 'disabled title="Espera a que termine el préstamo en curso"' : ''}><i class="bi bi-check-lg"></i> Aprobar 3 min</button>
                    <button type="button" class="btn btn-sm btn-outline-danger py-0 px-2" data-action="rechazar-solicitud" data-id="${s.id_solicitud}"><i class="bi bi-x-lg"></i> Rechazar</button>
                </div>
            </div>`).join('') : `<div class="small text-secondary"><i class="bi bi-inbox"></i> ${prestamo ? 'No hay más visitantes esperando.' : 'Sin solicitudes en espera. Cuando un visitante pida el vehículo físico aparecerá aquí.'}</div>`;
        cont.innerHTML = cabecera + enCurso + lista;
    }

    async cerrarSesionActual() {
        try {
            if (CONFIG.AUTH_TOKEN) await api.logout();
        } catch (_) {}
        this._limpiarSesionLocal();
        await this.sincronizarDesdeRds({ elegirUnidad: true, forzarSeleccion: true });
        ui.playSound('cancel');
        ui.showFeedback('Sesión cerrada', 'info', 2200);
    }

    _iniciarRelojInvitado() {
        clearInterval(this.guestInterval);
        const actualizarReloj = () => {
            const res = this.state.reservaInvitado;
            const badge = document.getElementById('guest-countdown-timer');
            const headerRole = document.getElementById('header-role-text');
            if (!res || !res.activa) {
                if (badge) badge.textContent = '00:00';
                clearInterval(this.guestInterval);
                return;
            }
            const restSeg = Math.max(0, Math.ceil((res.expira_ts - Date.now()) / 1000));
            const mmss = `${String(Math.floor(restSeg / 60)).padStart(2, '0')}:${String(restSeg % 60).padStart(2, '0')}`;
            if (badge) badge.textContent = mmss;
            if (headerRole && this.sesion?.rol === 'INVITADO') headerRole.textContent = `INVITADO (${mmss})`;
            if (restSeg <= 0) {
                this.finalizarReservaInvitado(true);
                return;
            }
            // Cada 5 s se confirma con el servidor (el Administrador puede terminar el préstamo antes)
            if (restSeg % 5 === 0 && !this._verificandoInvitado) {
                this._verificandoInvitado = true;
                api.obtenerPerfilActual()
                    .catch((err) => {
                        if (err.status === 401 && this.state.reservaInvitado?.activa) {
                            this.finalizarReservaInvitado(false, 'El administrador terminó tu sesión: el vehículo se detuvo');
                        }
                    })
                    .finally(() => { this._verificandoInvitado = false; });
            }
        };
        actualizarReloj();
        this.guestInterval = setInterval(actualizarReloj, 1000);
    }

    async finalizarReservaInvitado(porExpiracion = false, mensaje = null) {
        clearInterval(this.guestInterval);
        const res = this.state.reservaInvitado;
        if (res && res.activa) {
            res.activa = false;
            // El servidor también detiene la unidad al vencer la sesión (vigilante en FastAPI)
            if (this.onStopVehicle) {
                try { await this.onStopVehicle(); } catch (_) {}
            }
            try { await api.logout(); } catch (_) {}
            this._limpiarSesionLocal();
            ui.showFeedback(
                mensaje || (porExpiracion ? 'Tu prueba de Invitado terminó: el vehículo se detuvo' : 'Prueba finalizada y vehículo detenido'),
                'warning', 3800
            );
            await this.sincronizarDesdeRds({ elegirUnidad: true, forzarSeleccion: true });
        }
    }

    // ------------------------------------------------------------------ datos reales de RDS

    /**
     * Carga desde la API los datos que la sesión actual puede ver.
     * Ante un error NO se inventan datos: se guarda el error y las tablas muestran "Sin datos".
     */
    async sincronizarDesdeRds({ elegirUnidad = false, forzarSeleccion = false } = {}) {
        this.errorCarga = null;
        const rol = this.sesion?.rol;
        try {
            if (rol === 'ADMIN') {
                const dash = await api.obtenerDashboardAdmin();
                this.unidadesRds = Array.isArray(dash?.unidades) ? dash.unidades : [];
                this.state.modelos = Array.isArray(dash?.modelos) ? dash.modelos : [];
                this.state.clientes = Array.isArray(dash?.clientes) ? dash.clientes : [];
                this.state.auditoria = Array.isArray(dash?.auditoria) ? dash.auditoria : [];
                this.state.sesionesActivas = Array.isArray(dash?.sesiones_activas) ? dash.sesiones_activas : [];
            } else if (rol === 'USUARIO') {
                const [mis, cat] = await Promise.all([api.obtenerMisVehiculos(), api.obtenerCatalogoPublico().catch(() => null)]);
                this.unidadesRds = (Array.isArray(mis) ? mis : []).map((u) => ({ ...u, id_propietario: this.sesion.id_usuario }));
                this.state.modelos = Array.isArray(cat?.modelos) ? cat.modelos : [];
            } else if (rol === 'INVITADO') {
                // Invitado: sólo la unidad que tiene reservada (exhibición o vehículo físico prestado)
                const [mis, cat] = await Promise.all([api.obtenerMisVehiculos(), api.obtenerCatalogoPublico().catch(() => null)]);
                this.unidadesRds = (Array.isArray(mis) ? mis : []).map((u) => ({ ...u, activo: 1 }));
                this.state.modelos = Array.isArray(cat?.modelos) ? cat.modelos : [];
            } else {
                // Sin sesión: catálogo público y unidades de exhibición
                const cat = await api.obtenerCatalogoPublico();
                this.state.modelos = Array.isArray(cat?.modelos) ? cat.modelos : [];
                this.unidadesRds = (Array.isArray(cat?.unidades_exhibicion) ? cat.unidades_exhibicion : [])
                    .map((u) => ({ ...u, estado_comercial: 'EXHIBICION', activo: 1 }));
            }
        } catch (err) {
            if (err.status === 401 && this.sesion) {
                // Token vencido, revocado o cuenta desactivada
                this._limpiarSesionLocal();
                ui.showFeedback('Tu sesión terminó. Inicia sesión de nuevo.', 'warning', 3500);
                return this.sincronizarDesdeRds({ elegirUnidad: true, forzarSeleccion: true });
            }
            this.errorCarga = err.status ? `HTTP ${err.status}: ${err.message}` : 'Sin conexión con AWS';
            this.unidadesRds = [];
        }

        if (elegirUnidad) await this._asegurarUnidadVisible(forzarSeleccion);
        this.renderizarTodo();
    }

    async _asegurarUnidadVisible(forzar = false) {
        const visibles = this.obtenerUnidadesVisiblesPorRol();
        const actual = Number(CONFIG.VEHICULO_ACTIVO_LOGICO || CONFIG.VEHICULO_ID);
        const sigueVisible = visibles.some((u) => Number(u.id_vehiculo) === actual);
        if (visibles.length && (forzar || !sigueVisible)) {
            await this.seleccionarUnidadActiva(visibles[0].id_vehiculo, false);
            return;
        }
        // La unidad activa no cambió (p. ej. al recargar con sesión): sólo se actualiza la cabecera
        const sub = document.getElementById('header-unit-subtitle');
        if (sub) {
            if (visibles.length) {
                const u = this.obtenerUnidadEnriquecida(actual);
                sub.textContent = `${u.nombre} · ${u.numero_serie} (${u.estado_comercial})`;
            } else {
                sub.textContent = this.errorCarga ? 'Sin datos de unidades' : 'Sin unidades disponibles';
            }
        }
        this.actualizarBadgeSesionCabecera();
    }

    obtenerUnidadEnriquecida(idVehiculo) {
        const base = this.unidadesRds.find((v) => Number(v.id_vehiculo) === Number(idVehiculo));
        if (!base) {
            return { id_vehiculo: Number(idVehiculo), nombre: `Unidad #${idVehiculo}`, numero_serie: '—', estado_comercial: 'SIN DATOS', id_propietario: null };
        }
        const modeloObj = this.state.modelos.find((m) => Number(m.id_modelo) === Number(base.id_modelo));
        return {
            ...base,
            codigo_modelo: modeloObj?.codigo_modelo || '—',
            numero_serie: base.numero_serie || '—',
            estado_comercial: base.estado_comercial || 'SIN DATOS',
            soporte_autorizado: Boolean(Number(base.soporte_autorizado || 0))
        };
    }

    obtenerTodasLasUnidadesEnriquecidas() {
        return this.unidadesRds.map((u) => this.obtenerUnidadEnriquecida(u.id_vehiculo));
    }

    // El servidor ya filtra por rol; aquí sólo se descartan unidades dadas de baja
    obtenerUnidadesVisiblesPorRol() {
        return this.obtenerTodasLasUnidadesEnriquecidas().filter((u) => Number(u.activo ?? 1) === 1);
    }

    /**
     * Aviso inmediato antes de enviar un comando. NO es la seguridad: el servidor vuelve a validar
     * cada petición (401/403) aunque alguien se salte esta comprobación.
     */
    verificarPermisoOperacion(idVehiculo = CONFIG.VEHICULO_ID, silencioso = false) {
        const avisar = (msg, tipo = 'danger') => { if (!silencioso) ui.showFeedback(msg, tipo, 4000); };
        if (!this.sesion) {
            avisar('Inicia sesión o pide una prueba como Invitado (pestaña Administración) para controlar el vehículo', 'warning');
            return { ok: false, codigo: 401, motivo: 'Sin sesión' };
        }
        const unidad = this.obtenerUnidadEnriquecida(idVehiculo);
        const rol = this.sesion.rol;
        if (rol === 'USUARIO' && !this.unidadesRds.some((u) => Number(u.id_vehiculo) === Number(idVehiculo))) {
            avisar(`403: la unidad #${idVehiculo} no pertenece a tu cuenta`);
            return { ok: false, codigo: 403, motivo: 'Unidad de otro comprador' };
        }
        if (rol === 'INVITADO') {
            const res = this.state.reservaInvitado;
            if (!res || !res.activa || res.expira_ts <= Date.now()) {
                avisar('401: tu prueba de Invitado terminó', 'warning');
                return { ok: false, codigo: 401, motivo: 'Sesión de Invitado vencida' };
            }
            if (Number(res.id_vehiculo) !== Number(idVehiculo)) {
                avisar(`403: tu prueba sólo incluye la unidad #${res.id_vehiculo}`);
                return { ok: false, codigo: 403, motivo: 'Unidad no reservada' };
            }
        }
        if (rol === 'ADMIN' && unidad.estado_comercial === 'VENDIDO' && unidad.id_propietario && !unidad.soporte_autorizado) {
            avisar('403 Privacidad: el comprador debe activar "Autorizar soporte" en Mis vehículos');
            return { ok: false, codigo: 403, motivo: 'Sin autorización de soporte' };
        }
        return { ok: true, codigo: 200 };
    }

    async seleccionarUnidadActiva(idVehiculo, mostrarAviso = true) {
        const numId = Number(idVehiculo);
        if (!numId) return;
        const unidad = this.obtenerUnidadEnriquecida(numId);
        CONFIG.VEHICULO_ACTIVO_LOGICO = numId;
        CONFIG.setVehiculoId(numId);

        const sub = document.getElementById('header-unit-subtitle');
        if (sub) sub.textContent = `${unidad.nombre} · ${unidad.numero_serie} (${unidad.estado_comercial})`;
        this.actualizarBadgeSesionCabecera();

        if (this.onUnitChanged) await this.onUnitChanged(numId, unidad);
        if (mostrarAviso) {
            ui.playSound('tap');
            ui.showFeedback(`Unidad activa: ${unidad.nombre}`, 'info', 2200);
        }
    }

    actualizarBadgeSesionCabecera() {
        const roleBadge = document.getElementById('header-role-text');
        const roleBtn = document.getElementById('btn-role-switcher');
        if (roleBadge) {
            roleBadge.textContent = this.sesion ? `${this.sesion.rol}: ${String(this.sesion.nombre || '').split(' ')[0]}` : 'Iniciar sesión';
        }
        if (roleBtn) roleBtn.dataset.role = this.sesion ? this.sesion.rol : 'NONE';

        const selHeader = document.getElementById('header-unit-select');
        if (selHeader) {
            const visibles = this.obtenerUnidadesVisiblesPorRol();
            const actual = CONFIG.VEHICULO_ACTIVO_LOGICO || CONFIG.VEHICULO_ID;
            selHeader.innerHTML = visibles.length
                ? visibles.map((u) => `
                    <option value="${u.id_vehiculo}" ${Number(u.id_vehiculo) === Number(actual) ? 'selected' : ''}>
                        #${u.id_vehiculo} ${esc(u.nombre)} (${esc(u.estado_comercial)})
                    </option>`).join('')
                : '<option value="">Sin unidades disponibles</option>';
            selHeader.disabled = visibles.length <= 1;
        }
    }

    // ------------------------------------------------------------------ render

    renderizarTodo() {
        this.actualizarBadgeSesionCabecera();
        const rol = this.sesion?.rol || null;

        const mostrar = (id, visible) => document.getElementById(id)?.classList.toggle('d-none', !visible);
        mostrar('admin-role-section-admin', rol === 'ADMIN');
        mostrar('admin-role-section-usuario', rol === 'USUARIO');
        mostrar('admin-role-section-invitado', !rol || rol === 'INVITADO');
        mostrar('panel-editor-demos', rol === 'ADMIN' || rol === 'USUARIO');
        mostrar('admin-login-box', !rol);
        mostrar('admin-security-tests', Boolean(rol));

        const banner = document.getElementById('admin-current-session-banner');
        if (banner) {
            if (!rol) {
                banner.innerHTML = `
                    <div class="d-flex flex-wrap align-items-center gap-2">
                        <span class="badge bg-secondary">SIN SESIÓN</span>
                        <span class="small">Inicia sesión como <b>Administrador</b> o <b>Usuario</b>, o pide una <b>prueba de 3 min como Invitado</b>. Sin sesión sólo puedes ver el catálogo público.</span>
                    </div>`;
            } else {
                banner.innerHTML = `
                    <div class="d-flex flex-wrap align-items-center justify-content-between gap-2">
                        <div class="d-flex flex-wrap align-items-center gap-1">
                            <span class="badge role-pill role-${esc(rol.toLowerCase())}">${esc(rol)}</span>
                            <strong>${esc(this.sesion.nombre)}</strong>
                            ${this.sesion.email ? `<span class="text-secondary small">(${esc(this.sesion.email)})</span>` : ''}
                            <span class="badge bg-success ms-1"><i class="bi bi-key-fill"></i> Sesión JWT</span>
                        </div>
                        <div class="d-flex flex-wrap align-items-center gap-2">
                            <span class="small text-info"><i class="bi bi-shield-lock-fill"></i> Unidades autorizadas: <strong>${this.obtenerUnidadesVisiblesPorRol().length}</strong></span>
                            <button type="button" id="btn-logout-session" class="btn btn-sm btn-outline-danger py-0 px-2">
                                <i class="bi bi-box-arrow-right"></i> Cerrar sesión
                            </button>
                        </div>
                    </div>
                    ${this.errorCarga ? `<div class="small text-warning mt-1"><i class="bi bi-exclamation-triangle"></i> No se pudieron leer los datos: ${esc(this.errorCarga)}</div>` : ''}`;
            }
        }

        this._controlarSondeoAdmin(rol === 'ADMIN');
        this.renderSolicitudVisitante();

        if (rol === 'ADMIN') {
            this.renderSolicitudesAdmin();
            this.renderMetricas();
            this.renderTablaModelos();
            this.renderTablaUnidades();
            this.renderTablaClientes();
            this.renderComandosUnidadAdmin(this.idUnidadComandosSel || this.unidadesRds[0]?.id_vehiculo);
            this.renderAuditoria();
            this.cargarDemosParaEditor(CONFIG.VEHICULO_ID);
        } else if (rol === 'USUARIO') {
            this.renderMisVehiculosUsuario();
            if (this.unidadesRds.length) this.cargarDemosParaEditor(CONFIG.VEHICULO_ID);
        } else {
            this.renderPanelInvitado();
        }
    }

    renderMetricas() {
        const cont = document.getElementById('admin-metrics-grid');
        if (!cont) return;
        if (this.errorCarga) {
            cont.innerHTML = `<div class="admin-metric-card"><span class="metric-label"><i class="bi bi-database-x"></i> Métricas</span><strong class="metric-value text-secondary">Sin datos</strong><small class="metric-sub">${esc(this.errorCarga)}</small></div>`;
            return;
        }
        const todas = this.obtenerTodasLasUnidadesEnriquecidas();
        const cuenta = (estado) => todas.filter((u) => u.estado_comercial === estado).length;
        cont.innerHTML = `
            <div class="admin-metric-card">
                <span class="metric-label"><i class="bi bi-boxes"></i> Modelos Comerciales</span>
                <strong class="metric-value text-info">${this.state.modelos.filter((m) => Number(m.activo ?? 1) === 1).length}</strong>
                <small class="metric-sub">${this.state.modelos.length} en catálogo RDS</small>
            </div>
            <div class="admin-metric-card">
                <span class="metric-label"><i class="bi bi-truck-flatbed"></i> Unidades Físicas</span>
                <strong class="metric-value">${todas.filter((u) => Number(u.activo ?? 1) === 1).length}</strong>
                <small class="metric-sub">${cuenta('DISPONIBLE')} disponibles · ${cuenta('EXHIBICION')} exhibición · ${cuenta('INACTIVO')} de baja</small>
            </div>
            <div class="admin-metric-card">
                <span class="metric-label"><i class="bi bi-bag-check-fill"></i> Unidades Vendidas</span>
                <strong class="metric-value text-success">${cuenta('VENDIDO')}</strong>
                <small class="metric-sub">Con propietario asignado</small>
            </div>
            <div class="admin-metric-card">
                <span class="metric-label"><i class="bi bi-people-fill"></i> Clientes Compradores</span>
                <strong class="metric-value text-warning">${this.state.clientes.filter((c) => Number(c.activo ?? 1) === 1).length}</strong>
                <small class="metric-sub">${this.state.sesionesActivas.length} prueba(s) de Invitado activa(s)</small>
            </div>`;
    }

    renderTablaModelos() {
        const tbody = document.getElementById('tabla-admin-modelos');
        const selectMod = document.getElementById('unit-form-modelo');
        if (tbody) {
            tbody.innerHTML = this.state.modelos.length ? this.state.modelos.map((m) => {
                const activo = Number(m.activo ?? 1) === 1;
                return `
                <tr class="${activo ? '' : 'opacity-50'}">
                    <td data-label="Código"><span class="badge bg-dark border border-info text-info">${esc(m.codigo_modelo)}</span></td>
                    <td data-label="Modelo" class="fw-semibold">${esc(m.nombre)}</td>
                    <td data-label="MCU">${esc(m.microcontrolador_default || '—')}</td>
                    <td data-label="Capacidades">
                        <span class="badge ${m.tiene_brazo ? 'bg-success' : 'bg-secondary'} me-1">Brazo: ${m.tiene_brazo ? 'Sí' : 'No'}</span>
                        <span class="badge ${m.tiene_motores_giro ? 'bg-info text-dark' : 'bg-secondary'}">Giro: ${m.tiene_motores_giro ? 'Sí' : 'No'}</span>
                    </td>
                    <td data-label="Estado">
                        <button type="button" class="btn btn-sm ${activo ? 'btn-outline-secondary' : 'btn-outline-success'} py-0 px-2" data-action="toggle-modelo" data-id="${m.id_modelo}">
                            ${activo ? '<i class="bi bi-pause-circle"></i> Desactivar' : '<i class="bi bi-play-circle"></i> Activar'}
                        </button>
                    </td>
                </tr>`;
            }).join('') : SIN_DATOS(5, this.errorCarga || 'Sin modelos en RDS');
        }
        if (selectMod) {
            selectMod.innerHTML = this.state.modelos
                .filter((m) => Number(m.activo ?? 1) === 1)
                .map((m) => `<option value="${m.id_modelo}">${esc(m.codigo_modelo)} — ${esc(m.nombre)}</option>`).join('');
        }
    }

    renderTablaUnidades() {
        const tbody = document.getElementById('tabla-admin-unidades');
        const selectAsigUnidad = document.getElementById('asig-form-vehiculo');
        const selectCmdUnidad = document.getElementById('cmd-admin-unit-select');
        const unidades = this.obtenerTodasLasUnidadesEnriquecidas();

        if (tbody) {
            tbody.innerHTML = unidades.length ? unidades.map((u) => {
                const badgeClass = { VENDIDO: 'bg-success', EXHIBICION: 'bg-info text-dark', MANTENIMIENTO: 'bg-danger', INACTIVO: 'bg-secondary' }[u.estado_comercial] || 'bg-warning text-dark';
                const activa = Number(u.activo ?? 1) === 1;
                const soporteHtml = u.estado_comercial === 'VENDIDO'
                    ? (u.soporte_autorizado
                        ? '<span class="badge bg-success"><i class="bi bi-unlock-fill"></i> Soporte autorizado</span>'
                        : '<span class="badge bg-secondary"><i class="bi bi-lock-fill"></i> Privado (bloqueado)</span>')
                    : '<span class="text-secondary small">Control empresa</span>';
                let acciones = '';
                if (activa) {
                    acciones += `<button type="button" class="btn btn-sm btn-outline-info py-0 px-2" data-action="intentar-operar-admin" data-id="${u.id_vehiculo}"><i class="bi bi-controller"></i> Operar</button>`;
                    if (u.id_propietario) {
                        acciones += `<button type="button" class="btn btn-sm btn-outline-warning py-0 px-2" data-action="revocar-unidad" data-id="${u.id_vehiculo}"><i class="bi bi-person-dash"></i> Liberar</button>`;
                    } else {
                        acciones += `<button type="button" class="btn btn-sm btn-outline-light py-0 px-2" data-action="cambiar-exhibicion" data-id="${u.id_vehiculo}"><i class="bi bi-display"></i> ${u.estado_comercial === 'EXHIBICION' ? 'A Disponible' : 'A Exhibición'}</button>`;
                        acciones += `<button type="button" class="btn btn-sm btn-outline-danger py-0 px-2" data-action="baja-unidad" data-id="${u.id_vehiculo}"><i class="bi bi-archive"></i> Dar de baja</button>`;
                    }
                } else {
                    acciones = `<button type="button" class="btn btn-sm btn-outline-success py-0 px-2" data-action="reactivar-unidad" data-id="${u.id_vehiculo}"><i class="bi bi-arrow-counterclockwise"></i> Reactivar</button>`;
                }
                return `
                    <tr class="${activa ? '' : 'opacity-50'}">
                        <td data-label="ID"><strong>#${u.id_vehiculo}</strong></td>
                        <td data-label="Núm. Serie"><code>${esc(u.numero_serie)}</code></td>
                        <td data-label="Unidad / Modelo">
                            <div class="fw-semibold">${esc(u.nombre)}</div>
                            <small class="text-secondary">${esc(u.modelo)} (${esc(u.codigo_modelo)})</small>
                        </td>
                        <td data-label="Estado"><span class="badge ${badgeClass}">${esc(u.estado_comercial)}</span></td>
                        <td data-label="Propietario">${u.nombre_propietario ? `<i class="bi bi-person-check-fill text-success"></i> ${esc(u.nombre_propietario)}` : '<span class="text-secondary">Sin asignar</span>'}</td>
                        <td data-label="Privacidad / Soporte">${soporteHtml}</td>
                        <td data-label="Acciones"><div class="d-flex flex-wrap gap-1 justify-content-end justify-content-md-center">${acciones}</div></td>
                    </tr>`;
            }).join('') : SIN_DATOS(7, this.errorCarga || 'Sin unidades en RDS');
        }

        const activas = unidades.filter((u) => Number(u.activo ?? 1) === 1);
        if (selectAsigUnidad) {
            selectAsigUnidad.innerHTML = activas.map((u) => `
                <option value="${u.id_vehiculo}">#${u.id_vehiculo} ${esc(u.nombre)} (${esc(u.numero_serie)} · ${esc(u.estado_comercial)})</option>`).join('');
        }
        if (selectCmdUnidad) {
            selectCmdUnidad.innerHTML = activas.map((u) => `
                <option value="${u.id_vehiculo}" ${Number(u.id_vehiculo) === Number(this.idUnidadComandosSel) ? 'selected' : ''}>#${u.id_vehiculo} — ${esc(u.nombre)}</option>`).join('');
        }
    }

    renderTablaClientes() {
        const tbody = document.getElementById('tabla-admin-clientes');
        const selectCliente = document.getElementById('asig-form-cliente');
        const unidades = this.obtenerTodasLasUnidadesEnriquecidas();

        if (tbody) {
            tbody.innerHTML = this.state.clientes.length ? this.state.clientes.map((c) => {
                const activo = Number(c.activo ?? 1) === 1;
                const propias = unidades.filter((u) => Number(u.id_propietario) === Number(c.id_usuario));
                return `
                    <tr class="${activo ? '' : 'opacity-50'}">
                        <td data-label="ID">#${c.id_usuario}</td>
                        <td data-label="Cliente" class="fw-semibold">${esc(c.nombre)}</td>
                        <td data-label="Correo">${esc(c.email)}</td>
                        <td data-label="Unidades">${propias.length
                            ? propias.map((p) => `<span class="badge bg-success me-1">#${p.id_vehiculo} ${esc(p.nombre)}</span>`).join('')
                            : '<span class="text-secondary small">Ninguna asignada</span>'}</td>
                        <td data-label="Estado">
                            <button type="button" class="btn btn-sm ${activo ? 'btn-outline-secondary' : 'btn-outline-success'} py-0 px-2" data-action="toggle-cliente" data-id="${c.id_usuario}">
                                ${activo ? '<i class="bi bi-person-slash"></i> Desactivar' : '<i class="bi bi-person-check"></i> Activar'}
                            </button>
                        </td>
                    </tr>`;
            }).join('') : SIN_DATOS(5, this.errorCarga || 'Sin clientes en RDS');
        }
        if (selectCliente) {
            selectCliente.innerHTML = this.state.clientes
                .filter((c) => Number(c.activo ?? 1) === 1)
                .map((c) => `<option value="${c.id_usuario}">${esc(c.nombre)} (${esc(c.email)})</option>`).join('');
        }
    }

    async renderComandosUnidadAdmin(idVehiculo) {
        const cont = document.getElementById('admin-comandos-list');
        if (!cont) return;
        if (!idVehiculo) {
            cont.innerHTML = '<div class="text-secondary small">Sin unidades.</div>';
            return;
        }
        this.idUnidadComandosSel = Number(idVehiculo);
        try {
            const comandos = await api.obtenerComandos(this.idUnidadComandosSel);
            this.comandosUnidadAdmin = Array.isArray(comandos) ? comandos : [];
        } catch (err) {
            this.comandosUnidadAdmin = [];
            cont.innerHTML = `<div class="text-secondary small"><i class="bi bi-database-x"></i> Sin datos (${esc(err.status ? `HTTP ${err.status}` : 'sin conexión')})</div>`;
            return;
        }
        if (!this.comandosUnidadAdmin.length) {
            cont.innerHTML = '<div class="text-secondary small">Esta unidad no tiene comandos registrados en RDS.</div>';
            return;
        }
        const unidad = this.obtenerUnidadEnriquecida(this.idUnidadComandosSel);
        const modeloObj = this.state.modelos.find((m) => Number(m.id_modelo) === Number(unidad.id_modelo));
        cont.innerHTML = this.comandosUnidadAdmin.map((cmd) => {
            const esDetener = normalizar(cmd.nombre) === 'DETENER';
            const incompatible = Boolean(modeloObj && !modeloObj.tiene_brazo && /BRAZO/.test(normalizar(cmd.nombre)));
            const activo = !incompatible && cmd.activo !== false && Number(cmd.activo) !== 0;
            return `
                <div class="admin-cmd-chip ${activo ? 'is-active' : 'is-disabled'}">
                    <div>
                        <div class="fw-semibold">${esc(cmd.nombre)} <small class="text-secondary">(Cód. ${esc(cmd.codigo)})</small></div>
                        <small class="text-secondary">${incompatible ? 'No compatible con este modelo' : (esDetener ? 'Paro prioritario obligatorio' : (activo ? 'Habilitado' : 'Deshabilitado'))}</small>
                    </div>
                    <div class="form-check form-switch m-0">
                        <input class="form-check-input" type="checkbox" data-action="toggle-cmd-activo" data-id="${cmd.id_comando}"
                            ${activo ? 'checked' : ''} ${esDetener || incompatible ? 'disabled' : ''}>
                    </div>
                </div>`;
        }).join('');
    }

    renderAuditoria() {
        const tbody = document.getElementById('tabla-admin-auditoria');
        if (!tbody) return;
        if (!this.state.auditoria.length) {
            tbody.innerHTML = SIN_DATOS(4, this.errorCarga || 'Sin eventos registrados en RDS');
            return;
        }
        tbody.innerHTML = this.state.auditoria.slice(0, 25).map((ev) => {
            const { fecha, hora } = ui.formatearFechaHora(ev.fecha_hora);
            const alerta = /BLOQUEAD|FALLIDO|SIN_SOPORTE|RECHAZ|EXPIRACION/.test(ev.accion || '');
            return `
                <tr class="${alerta ? 'table-danger-row' : ''}">
                    <td data-label="Evento"><span class="badge ${alerta ? 'bg-danger' : 'bg-secondary'}">${esc(ev.accion)}</span></td>
                    <td data-label="Actor / Rol"><strong>${esc(ev.actor || 'Sistema')}</strong> <small class="text-secondary">(${esc(ev.rol)})</small></td>
                    <td data-label="Detalle">${esc(ev.detalle)}</td>
                    <td data-label="Fecha / Hora" class="small">${esc(fecha)} ${esc(hora)}</td>
                </tr>`;
        }).join('');
    }

    renderMisVehiculosUsuario() {
        const cont = document.getElementById('usuario-mis-vehiculos-grid');
        if (!cont) return;
        const mis = this.obtenerUnidadesVisiblesPorRol();
        if (!mis.length) {
            cont.innerHTML = `
                <div class="admin-empty-state">
                    <i class="bi bi-car-front fs-2 text-secondary"></i>
                    <p class="mb-0 mt-2">${esc(this.errorCarga ? `Sin datos: ${this.errorCarga}` : 'Aún no tienes unidades asignadas a tu cuenta.')}</p>
                </div>`;
            return;
        }
        const idActivo = CONFIG.VEHICULO_ACTIVO_LOGICO || CONFIG.VEHICULO_ID;
        cont.innerHTML = mis.map((u) => {
            const activa = Number(u.id_vehiculo) === Number(idActivo);
            return `
                <div class="user-vehicle-card ${activa ? 'is-selected' : ''}">
                    <div class="d-flex justify-content-between align-items-start gap-2 mb-2">
                        <div>
                            <span class="badge bg-success mb-1"><i class="bi bi-patch-check-fill"></i> PROPIETARIO TITULAR</span>
                            <h3 class="h6 mb-0 fw-bold">${esc(u.nombre)}</h3>
                            <small class="text-secondary">${esc(u.modelo)} · Serie: <code>${esc(u.numero_serie)}</code></small>
                        </div>
                        <span class="badge bg-dark border border-secondary">ID #${u.id_vehiculo}</span>
                    </div>
                    <p class="small text-secondary mb-2">
                        Último comando: <b>${esc(u.ultimo_comando || 'Sin datos')}</b> ·
                        ${u.conectado === undefined || u.conectado === null ? 'Conexión: sin verificar' : (Number(u.conectado) ? 'Último reporte: conectado' : 'Último reporte: desconectado')}
                    </p>
                    <div class="support-consent-box mb-3">
                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="switch-soporte-${u.id_vehiculo}"
                                data-action="toggle-soporte-propietario" data-id="${u.id_vehiculo}" ${u.soporte_autorizado ? 'checked' : ''}>
                            <label class="form-check-label small fw-semibold" for="switch-soporte-${u.id_vehiculo}">Autorizar soporte técnico al Administrador (30 min)</label>
                        </div>
                        <small class="d-block text-secondary mt-1">${u.soporte_autorizado
                            ? `<span class="text-warning"><i class="bi bi-unlock-fill"></i> El Administrador puede operar tu unidad${u.soporte_expira_en ? ` hasta ${esc(ui.formatearFechaHora(u.soporte_expira_en).hora)}` : ''}.</span>`
                            : '<span class="text-success"><i class="bi bi-shield-lock-fill"></i> Control privado: sólo tú puedes mover tu vehículo.</span>'}</small>
                    </div>
                    <button type="button" class="btn btn-sm ${activa ? 'btn-info text-dark fw-bold' : 'btn-outline-info'}" data-action="seleccionar-mi-vehiculo" data-id="${u.id_vehiculo}">
                        <i class="bi bi-controller"></i> ${activa ? 'Unidad activa en Control' : 'Usar en Control y Monitoreo'}
                    </button>
                </div>`;
        }).join('');
    }

    _puedeEditarDemo(demo) {
        const rol = this.sesion?.rol;
        const tipo = demo?.tipo_demo || 'EMPRESA';
        if (rol === 'ADMIN') return tipo !== 'PRIVADA';
        if (rol === 'USUARIO') return tipo === 'PRIVADA' && Number(demo.id_usuario_creador) === Number(this.sesion.id_usuario);
        return false;
    }

    async cargarDemosParaEditor(idVehiculo) {
        const contDemos = document.getElementById('editor-demos-lista');
        const selectCmdPaso = document.getElementById('step-form-comando');
        const etiquetaUnidad = document.getElementById('editor-demos-unidad');
        if (!contDemos || !idVehiculo) return;
        if (etiquetaUnidad) etiquetaUnidad.textContent = `Unidad activa: #${idVehiculo} ${this.obtenerUnidadEnriquecida(idVehiculo).nombre}`;

        let demos;
        let comandos;
        try {
            [demos, comandos] = await Promise.all([api.obtenerDemos(idVehiculo), api.obtenerComandos(idVehiculo)]);
        } catch (err) {
            contDemos.innerHTML = `<div class="text-secondary small"><i class="bi bi-database-x"></i> Sin datos (${esc(err.status ? `HTTP ${err.status}: ${err.message}` : 'sin conexión con AWS')})</div>`;
            this.demosUnidadEditor = [];
            this.renderPasosDemoEditor([]);
            return;
        }
        this.demosUnidadEditor = Array.isArray(demos) ? demos : [];
        const activos = (Array.isArray(comandos) ? comandos : []).filter((c) => c.activo !== false && Number(c.activo) !== 0);
        if (selectCmdPaso) {
            selectCmdPaso.innerHTML = activos.map((c) => `<option value="${c.id_comando}">${esc(c.nombre)} (ID ${c.id_comando})</option>`).join('');
        }
        if (!this.demosUnidadEditor.length) {
            contDemos.innerHTML = '<div class="text-secondary small">No hay secuencias demo registradas para esta unidad.</div>';
            this.idDemoSeleccionada = null;
            this.renderPasosDemoEditor([]);
            return;
        }
        if (!this.demosUnidadEditor.some((d) => Number(d.id_demo) === Number(this.idDemoSeleccionada))) {
            this.idDemoSeleccionada = this.demosUnidadEditor[0].id_demo;
        }
        contDemos.innerHTML = this.demosUnidadEditor.map((d) => {
            const tipo = d.tipo_demo || 'EMPRESA';
            const sel = Number(d.id_demo) === Number(this.idDemoSeleccionada);
            const editable = this._puedeEditarDemo(d);
            return `
                <div class="demo-editor-item ${sel ? 'active' : ''}">
                    <div class="demo-editor-item-main" data-action="seleccionar-demo-editor" data-id="${d.id_demo}">
                        <div class="d-flex align-items-center gap-2">
                            <span class="badge ${tipo === 'PRIVADA' ? 'bg-warning text-dark' : 'bg-info text-dark'}">${esc(tipo)}</span>
                            <strong>${esc(d.nombre)}</strong>
                            ${editable ? '' : '<i class="bi bi-lock-fill text-secondary" title="Sólo lectura: no eres su propietario"></i>'}
                        </div>
                        <small class="text-secondary">${esc(d.descripcion || '')}</small>
                    </div>
                    <div class="d-flex gap-1">
                        <button type="button" class="btn btn-sm btn-outline-success py-0 px-2" data-action="ejecutar-demo-desde-editor" data-id="${d.id_demo}" title="Seleccionar en Control"><i class="bi bi-play-fill"></i></button>
                        <button type="button" class="btn btn-sm btn-outline-danger py-0 px-2" data-action="eliminar-demo-editor" data-id="${d.id_demo}" ${editable ? '' : 'disabled'} title="${editable ? 'Eliminar demo' : 'Sólo su propietario puede eliminarla'}"><i class="bi bi-trash"></i></button>
                    </div>
                </div>`;
        }).join('');
        await this.cargarPasosDeDemoSeleccionada(this.idDemoSeleccionada);
    }

    async cargarPasosDeDemoSeleccionada(idDemo) {
        this.idDemoSeleccionada = Number(idDemo);
        const demoObj = this.demosUnidadEditor.find((d) => Number(d.id_demo) === this.idDemoSeleccionada);
        const label = document.getElementById('editor-pasos-titulo');
        if (label) label.textContent = demoObj ? `Pasos de: ${demoObj.nombre} (#${demoObj.id_demo})` : 'Pasos de la secuencia';
        const formPaso = document.getElementById('form-editor-agregar-paso');
        const editable = this._puedeEditarDemo(demoObj);
        formPaso?.querySelectorAll('input, select, button').forEach((el) => { el.disabled = !editable; });
        try {
            const pasos = await api.obtenerMovimientosDemo(this.idDemoSeleccionada);
            this.movimientosDemoActual = (Array.isArray(pasos) ? pasos : []).sort((a, b) => Number(a.orden) - Number(b.orden));
            this.renderPasosDemoEditor(this.movimientosDemoActual, editable);
        } catch (err) {
            this.movimientosDemoActual = [];
            const tbody = document.getElementById('tabla-editor-pasos');
            if (tbody) tbody.innerHTML = SIN_DATOS(5, `Sin datos (${err.status ? `HTTP ${err.status}: ${err.message}` : 'sin conexión'})`);
        }
    }

    renderPasosDemoEditor(pasos, editable = false) {
        const tbody = document.getElementById('tabla-editor-pasos');
        if (!tbody) return;
        if (!pasos || !pasos.length) {
            tbody.innerHTML = SIN_DATOS(5, editable ? 'Esta secuencia aún no tiene pasos. Agrega un movimiento abajo.' : 'Esta secuencia no tiene pasos.');
            return;
        }
        const dis = editable ? '' : 'disabled';
        tbody.innerHTML = pasos.map((p, idx) => `
            <tr>
                <td data-label="Orden"><span class="monitor-row-num">${esc(p.orden)}</span></td>
                <td data-label="Comando" class="fw-semibold">${esc(p.comando || `Comando #${p.id_comando}`)}</td>
                <td data-label="Duración">${esc(p.duracion_ms)} ms</td>
                <td data-label="Pausa">${esc(p.pausa_ms)} ms</td>
                <td data-label="Acciones">
                    <div class="d-flex gap-1 justify-content-end justify-content-md-center">
                        <button type="button" class="btn btn-sm btn-outline-light py-0 px-2" data-action="mover-paso-arriba" data-idx="${idx}" ${idx === 0 ? 'disabled' : dis} title="Subir"><i class="bi bi-arrow-up"></i></button>
                        <button type="button" class="btn btn-sm btn-outline-light py-0 px-2" data-action="mover-paso-abajo" data-idx="${idx}" ${idx === pasos.length - 1 ? 'disabled' : dis} title="Bajar"><i class="bi bi-arrow-down"></i></button>
                        <button type="button" class="btn btn-sm btn-outline-danger py-0 px-2" data-action="eliminar-paso-demo" data-id="${p.id_demo_movimiento}" ${dis} title="Quitar"><i class="bi bi-x-lg"></i></button>
                    </div>
                </td>
            </tr>`).join('');
    }

    renderPanelInvitado() {
        const catCont = document.getElementById('invitado-catalogo-grid');
        const boxReserva = document.getElementById('invitado-reserva-status');
        if (catCont) {
            const modelos = this.state.modelos.filter((m) => Number(m.activo ?? 1) === 1);
            catCont.innerHTML = modelos.length ? modelos.map((m) => `
                <div class="user-vehicle-card">
                    <div class="d-flex justify-content-between align-items-center mb-2">
                        <span class="badge bg-info text-dark">${esc(m.codigo_modelo)}</span>
                        <span class="badge bg-dark border border-secondary">${esc(m.microcontrolador_default)}</span>
                    </div>
                    <h3 class="h6 fw-bold mb-1">${esc(m.nombre)}</h3>
                    <p class="small text-secondary mb-2">${esc(m.descripcion || '')}</p>
                    <span class="badge ${m.tiene_brazo ? 'bg-success' : 'bg-secondary'}">Brazo hidráulico: ${m.tiene_brazo ? 'Incluido' : 'No aplica'}</span>
                </div>`).join('')
                : `<div class="admin-empty-state"><i class="bi bi-database-x fs-2 text-secondary"></i><p class="mb-0 mt-2">${esc(this.errorCarga ? `Sin datos: ${this.errorCarga}` : 'Sin modelos publicados.')}</p></div>`;
        }
        if (boxReserva) {
            const res = this.state.reservaInvitado;
            const activa = res && res.activa && res.expira_ts > Date.now();
            const exhibicion = this.unidadesRds;
            const libres = exhibicion.filter((u) => !u.sesion_activa).length;
            boxReserva.innerHTML = activa ? `
                <div class="d-flex flex-wrap align-items-center justify-content-between gap-2">
                    <div>
                        <span class="badge ${res.tipo_sesion === PRESTAMO ? 'bg-warning text-dark' : 'bg-success'} me-2"><i class="bi ${res.tipo_sesion === PRESTAMO ? 'bi-truck-front-fill' : 'bi-broadcast-pin'}"></i> ${res.tipo_sesion === PRESTAMO ? 'VEHÍCULO FÍSICO PRESTADO' : 'RESERVA EXCLUSIVA ACTIVA'}</span>
                        <strong>${esc(res.nombre_vehiculo)}</strong> · Operador: <span class="text-info">${esc(res.operador)}</span>
                        <div class="small text-secondary mt-1">${res.tipo_sesion === PRESTAMO
                            ? 'Aprobado por el administrador: todos los comandos, voz, gestos, asistente IA y la demo de la empresa. Mueves el carrito real.'
                            : 'Comandos disponibles: avanzar, retroceder, girar, luz, sonido y detener.'}</div>
                    </div>
                    <div class="d-flex align-items-center gap-2">
                        <span class="badge bg-warning text-dark fs-6"><i class="bi bi-stopwatch"></i> <span id="guest-countdown-timer">--:--</span></span>
                        <button type="button" class="btn btn-sm btn-info text-dark fw-bold" data-action="ir-control-invitado"><i class="bi bi-controller"></i> Probar ahora</button>
                        <button type="button" class="btn btn-sm btn-outline-danger" data-action="finalizar-reserva-invitado"><i class="bi bi-stop-circle"></i> Finalizar y detener</button>
                    </div>
                </div>` : `
                <div class="d-flex flex-wrap align-items-center justify-content-between gap-2">
                    <div>
                        <span class="badge bg-secondary me-2">VISITANTE</span>
                        <span class="small">${exhibicion.length
                            ? `${libres} de ${exhibicion.length} unidad(es) de exhibición libre(s). La prueba dura 3 minutos y es exclusiva.`
                            : esc(this.errorCarga ? `Sin datos: ${this.errorCarga}` : 'No hay unidades de exhibición en este momento.')}</span>
                    </div>
                </div>`;
            if (activa) this._iniciarRelojInvitado();
        }
    }

    // ------------------------------------------------------------------ eventos

    async _ejecutar(accion, mensajeOk, { recargar = true } = {}) {
        try {
            const r = await accion();
            if (mensajeOk) ui.showFeedback(mensajeOk, 'success', 2500);
            if (recargar) await this.sincronizarDesdeRds();
            return r;
        } catch (err) {
            ui.playSound('cancel');
            ui.showFeedback(err.status ? `${err.status}: ${err.message}` : 'Sin conexión con AWS: no se guardó nada', 'danger', 4500);
            return undefined;
        }
    }

    _bindEvents() {
        document.getElementById('header-unit-select')?.addEventListener('change', (e) => {
            if (e.target.value) this.seleccionarUnidadActiva(Number(e.target.value), true);
        });
        document.getElementById('btn-role-switcher')?.addEventListener('click', () => {
            document.getElementById('btn-tab-admin')?.click();
        });
        // Rellena sólo el correo de las cuentas de prueba (la contraseña NUNCA está en el código)
        document.querySelectorAll('[data-fill-email]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const emailInput = document.getElementById('auth-login-email');
                if (emailInput) emailInput.value = btn.getAttribute('data-fill-email') || '';
                document.getElementById('auth-login-password')?.focus();
            });
        });

        const vistaAdmin = document.getElementById('vista-admin');
        if (!vistaAdmin) return;

        vistaAdmin.addEventListener('click', async (e) => {
            if (e.target.closest('#btn-logout-session')) {
                await this.cerrarSesionActual();
                return;
            }
            const actionEl = e.target.closest('[data-action]');
            if (!actionEl || actionEl.disabled) return;
            const action = actionEl.getAttribute('data-action');
            const id = Number(actionEl.getAttribute('data-id'));

            switch (action) {
                case 'intentar-operar-admin':
                    await this.seleccionarUnidadActiva(id, true);
                    if (this.verificarPermisoOperacion(id, false).ok) document.getElementById('btn-tab-control')?.click();
                    break;
                case 'revocar-unidad':
                    await this._ejecutar(() => api.revocarAsignacion(id, 'DISPONIBLE'), `Unidad #${id} liberada (DISPONIBLE)`);
                    break;
                case 'cambiar-exhibicion': {
                    const u = this.obtenerUnidadEnriquecida(id);
                    const nuevo = u.estado_comercial === 'EXHIBICION' ? 'DISPONIBLE' : 'EXHIBICION';
                    await this._ejecutar(() => api.actualizarUnidadAdmin(id, this._datosUnidad(u, { estado_comercial: nuevo })), `Unidad #${id} ahora en ${nuevo}`);
                    break;
                }
                case 'baja-unidad':
                    if (confirm(`¿Dar de baja la unidad #${id}? Se conserva su historial (baja lógica).`)) {
                        await this._ejecutar(() => api.darDeBajaUnidad(id), `Unidad #${id} dada de baja`);
                    }
                    break;
                case 'reactivar-unidad': {
                    const u = this.obtenerUnidadEnriquecida(id);
                    await this._ejecutar(() => api.actualizarUnidadAdmin(id, this._datosUnidad(u, { estado_comercial: 'DISPONIBLE', activo: true })), `Unidad #${id} reactivada`);
                    break;
                }
                case 'toggle-modelo': {
                    const m = this.state.modelos.find((x) => Number(x.id_modelo) === id);
                    if (!m) break;
                    const activo = !(Number(m.activo ?? 1) === 1);
                    await this._ejecutar(() => api.actualizarModelo(id, {
                        nombre: m.nombre, descripcion: m.descripcion, microcontrolador_default: m.microcontrolador_default || 'ESP8266',
                        tiene_brazo: Boolean(Number(m.tiene_brazo)), tiene_motores_giro: Boolean(Number(m.tiene_motores_giro ?? 1)), activo
                    }), `Modelo ${m.codigo_modelo} ${activo ? 'activado' : 'desactivado'}`);
                    break;
                }
                case 'toggle-cliente': {
                    const c = this.state.clientes.find((x) => Number(x.id_usuario) === id);
                    if (!c) break;
                    const activo = !(Number(c.activo ?? 1) === 1);
                    await this._ejecutar(() => api.actualizarCliente(id, { nombre: c.nombre, email: c.email, activo }),
                        `Cliente ${c.nombre} ${activo ? 'activado' : 'desactivado'}`);
                    break;
                }
                case 'seleccionar-mi-vehiculo':
                    await this.seleccionarUnidadActiva(id, true);
                    this.renderMisVehiculosUsuario();
                    document.getElementById('btn-tab-control')?.click();
                    break;
                case 'seleccionar-demo-editor':
                    ui.playSound('tap');
                    this.idDemoSeleccionada = id;
                    await this.cargarDemosParaEditor(CONFIG.VEHICULO_ID);
                    break;
                case 'ejecutar-demo-desde-editor': {
                    document.getElementById('btn-tab-control')?.click();
                    const sel = document.getElementById('demo-select');
                    if (sel) sel.value = String(id);
                    ui.showFeedback('Secuencia seleccionada en Control', 'success', 2200);
                    break;
                }
                case 'eliminar-demo-editor':
                    if (confirm('¿Eliminar esta secuencia DEMO?')) {
                        await this._ejecutar(() => api.eliminarDemo(id), 'Secuencia DEMO eliminada', { recargar: false });
                        await this.cargarDemosParaEditor(CONFIG.VEHICULO_ID);
                        if (this.onUnitChanged) await this.onUnitChanged(CONFIG.VEHICULO_ID);
                    }
                    break;
                case 'eliminar-paso-demo':
                    await this._ejecutar(() => api.eliminarMovimientoDemo(id), 'Paso eliminado', { recargar: false });
                    await this.cargarPasosDeDemoSeleccionada(this.idDemoSeleccionada);
                    break;
                case 'mover-paso-arriba':
                case 'mover-paso-abajo': {
                    const idx = Number(actionEl.getAttribute('data-idx'));
                    const destino = action === 'mover-paso-arriba' ? idx - 1 : idx + 1;
                    const a = this.movimientosDemoActual[idx];
                    const b = this.movimientosDemoActual[destino];
                    if (!a || !b) break;
                    await this._ejecutar(() => Promise.all([
                        api.actualizarMovimientoDemo(a.id_demo_movimiento, { id_comando: a.id_comando, orden: b.orden, duracion_ms: a.duracion_ms, pausa_ms: a.pausa_ms }),
                        api.actualizarMovimientoDemo(b.id_demo_movimiento, { id_comando: b.id_comando, orden: a.orden, duracion_ms: b.duracion_ms, pausa_ms: b.pausa_ms })
                    ]), null, { recargar: false });
                    await this.cargarPasosDeDemoSeleccionada(this.idDemoSeleccionada);
                    break;
                }
                case 'solicitar-vehiculo-fisico': {
                    const nombre = document.getElementById('guest-login-name')?.value?.trim() || 'Visitante';
                    actionEl.disabled = true;
                    try {
                        await this.solicitarVehiculoFisico(nombre);
                    } catch (err) {
                        actionEl.disabled = false;
                        ui.playSound('cancel');
                        ui.showFeedback(err.status ? `${err.status}: ${err.message}` : 'Sin conexión con AWS: no se envió la solicitud', 'danger', 4500);
                    }
                    break;
                }
                case 'cancelar-solicitud-fisico':
                    await this.cancelarSolicitudFisico();
                    break;
                case 'aprobar-solicitud':
                case 'rechazar-solicitud':
                case 'terminar-prestamo': {
                    if (action === 'terminar-prestamo' && !confirm('¿Terminar el préstamo? El vehículo físico se detendrá.')) break;
                    actionEl.disabled = true;
                    const llamada = {
                        'aprobar-solicitud': () => api.aprobarSolicitudInvitado(id),
                        'rechazar-solicitud': () => api.rechazarSolicitudInvitado(id),
                        'terminar-prestamo': () => api.terminarPrestamoFisico()
                    }[action];
                    const r = await this._ejecutar(llamada, null);
                    if (r?.mensaje) ui.showFeedback(r.mensaje, action === 'aprobar-solicitud' ? 'success' : 'info', 3500);
                    await this.cargarSolicitudesAdmin();
                    break;
                }
                case 'ir-control-invitado':
                    document.getElementById('btn-tab-control')?.click();
                    break;
                case 'finalizar-reserva-invitado':
                    await this.finalizarReservaInvitado(false);
                    break;
                case 'test-bola-cruzado':
                    await this._pruebaBola();
                    break;
                case 'test-admin-sin-soporte':
                    await this._pruebaAdminSinSoporte();
                    break;
                case 'test-invitado-unidad-vendida':
                    await this._pruebaInvitado();
                    break;
                default:
                    break;
            }
        });

        vistaAdmin.addEventListener('change', async (e) => {
            const target = e.target;
            if (target.id === 'cmd-admin-unit-select') {
                await this.renderComandosUnidadAdmin(Number(target.value));
                return;
            }
            const action = target.getAttribute('data-action');
            const id = Number(target.getAttribute('data-id'));

            if (action === 'toggle-soporte-propietario') {
                const autorizado = Boolean(target.checked);
                const ok = await this._ejecutar(() => api.configurarSoporte(id, autorizado, 30),
                    autorizado ? 'Soporte autorizado al Administrador por 30 min' : 'Soporte revocado: control privado');
                if (ok === undefined) target.checked = !autorizado;   // el servidor no lo guardó
            }

            if (action === 'toggle-cmd-activo') {
                const cmd = this.comandosUnidadAdmin.find((c) => Number(c.id_comando) === id);
                if (!cmd) return;
                const activo = Boolean(target.checked);
                await this._ejecutar(() => api.actualizarComando(id, { nombre: cmd.nombre, codigo: cmd.codigo, descripcion: cmd.descripcion || '', activo }),
                    `Comando ${cmd.nombre}: ${activo ? 'habilitado' : 'deshabilitado'}`, { recargar: false });
                await this.renderComandosUnidadAdmin(this.idUnidadComandosSel);
                if (this.onUnitChanged) await this.onUnitChanged(CONFIG.VEHICULO_ID);
            }
        });

        this._bindForms();
    }

    _datosUnidad(u, cambios = {}) {
        return {
            nombre: u.nombre,
            modelo: u.modelo || 'Excavadora IoT',
            numero_serie: u.numero_serie && u.numero_serie !== '—' ? u.numero_serie : null,
            descripcion: u.descripcion || null,
            microcontrolador: u.microcontrolador || 'ESP8266',
            estado_comercial: u.estado_comercial,
            activo: Number(u.activo ?? 1) === 1,
            ...cambios
        };
    }

    // ------------------------------------------------------------------ pruebas de autorización
    // Hacen peticiones REALES con la sesión actual y muestran el código HTTP que respondió el servidor.
    // Usan un comando inexistente: aunque el servidor autorizara (fallo de seguridad), respondería 422
    // y el vehículo no se movería.

    async _probar(idVehiculo) {
        try {
            await api.ejecutarMovimiento(ID_COMANDO_PRUEBA, idVehiculo);
            return { status: 200, detalle: 'aceptada' };
        } catch (err) {
            return { status: err.status || 0, detalle: err.message || 'sin respuesta' };
        }
    }

    _resultadoPrueba(titulo, esperado, r) {
        const ok = esperado.includes(r.status);
        const box = document.getElementById('security-test-output');
        if (!box) return;
        box.classList.remove('d-none');
        box.innerHTML = `
            <div><i class="bi ${ok ? 'bi-shield-check text-success' : 'bi-shield-exclamation text-danger'} me-1"></i>
                <strong>${esc(titulo)}</strong></div>
            <div class="small mt-1">Esperado: <b>HTTP ${esperado.join(' o ')}</b> · Respuesta real del servidor: <b>${r.status ? `HTTP ${r.status}` : 'sin conexión'}</b> — ${esc(r.detalle)}</div>
            <div class="small mt-1 ${ok ? 'text-success' : 'text-danger'}">${ok ? 'CORRECTO: el servidor bloqueó el acceso.' : 'INCORRECTO: revisa la autorización del backend.'} El evento queda en la bitácora de RDS.</div>`;
        if (this.sesion?.rol === 'ADMIN') this.sincronizarDesdeRds();
    }

    _pedirRol(rolNecesario, texto) {
        const box = document.getElementById('security-test-output');
        if (box) {
            box.classList.remove('d-none');
            box.innerHTML = `<i class="bi bi-info-circle text-info me-1"></i> ${esc(texto)} (sesión actual: ${esc(this.sesion?.rol || 'ninguna')}, se requiere: ${esc(rolNecesario)}).`;
        }
    }

    async _buscarUnidadAjena(excluir = []) {
        // Recorre ids cercanos hasta encontrar uno que exista en RDS y no sea de la sesión actual
        for (let id = 1; id <= 20; id++) {
            if (excluir.includes(id)) continue;
            const r = await this._probar(id);
            if (r.status !== 404) return { id, r };
        }
        return null;
    }

    async _pruebaBola() {
        if (this.sesion?.rol !== 'USUARIO') {
            this._pedirRol('USUARIO', 'Inicia sesión como un comprador (por ejemplo Cynthia) para probar el acceso a una unidad ajena');
            return;
        }
        const mias = this.unidadesRds.map((u) => Number(u.id_vehiculo));
        const hallazgo = await this._buscarUnidadAjena(mias);
        if (!hallazgo) {
            this._pedirRol('USUARIO', 'No se encontró otra unidad registrada en RDS para la prueba');
            return;
        }
        this._resultadoPrueba(`BOLA: ${this.sesion.nombre} intenta operar la unidad #${hallazgo.id} (no es suya)`, [403], hallazgo.r);
    }

    async _pruebaAdminSinSoporte() {
        if (this.sesion?.rol !== 'ADMIN') {
            this._pedirRol('ADMIN', 'Inicia sesión como Administrador para esta prueba');
            return;
        }
        const objetivo = this.obtenerTodasLasUnidadesEnriquecidas()
            .find((u) => u.estado_comercial === 'VENDIDO' && u.id_propietario && !u.soporte_autorizado);
        if (!objetivo) {
            this._pedirRol('ADMIN', 'No hay unidades vendidas sin soporte autorizado en RDS para esta prueba');
            return;
        }
        const r = await this._probar(objetivo.id_vehiculo);
        this._resultadoPrueba(`Privacidad: el Administrador intenta operar la unidad #${objetivo.id_vehiculo} de ${objetivo.nombre_propietario} sin soporte`, [403], r);
    }

    async _pruebaInvitado() {
        if (this.sesion?.rol !== 'INVITADO') {
            this._pedirRol('INVITADO', 'Inicia una prueba como Invitado para verificar que no puede usar unidades de compradores');
            return;
        }
        const reservada = Number(this.state.reservaInvitado?.id_vehiculo);
        const exhib = this.unidadesRds.map((u) => Number(u.id_vehiculo));
        const hallazgo = await this._buscarUnidadAjena([reservada, ...exhib]);
        if (!hallazgo) {
            this._pedirRol('INVITADO', 'No se encontró una unidad privada en RDS para la prueba');
            return;
        }
        this._resultadoPrueba(`Invitado intenta operar la unidad #${hallazgo.id} (no es de exhibición)`, [403], hallazgo.r);
    }

    // ------------------------------------------------------------------ formularios

    _bindForms() {
        const enviar = (idForm, fn) => {
            const form = document.getElementById(idForm);
            if (!form) return;
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                const boton = form.querySelector('[type="submit"]');
                if (boton) boton.disabled = true;
                try { await fn(form); } finally { if (boton) boton.disabled = false; }
            });
        };
        const valor = (id) => document.getElementById(id)?.value?.trim() || '';

        enviar('form-auth-login', async (form) => {
            const email = valor('auth-login-email');
            const password = document.getElementById('auth-login-password')?.value || '';
            if (!email || !password) return;
            try {
                await this.iniciarSesionConCredenciales(email, password);
                form.reset();
            } catch (err) {
                ui.playSound('cancel');
                ui.showFeedback(err.status ? `${err.status}: ${err.message}` : 'Sin conexión con AWS', 'danger', 4000);
            }
        });

        enviar('form-auth-guest', async () => {
            try {
                await this.iniciarSesionInvitadoReal(valor('guest-login-name') || 'Visitante Showroom');
            } catch (err) {
                ui.playSound('cancel');
                ui.showFeedback(err.status ? `${err.status}: ${err.message}` : 'Sin conexión con AWS: no se pudo iniciar la prueba', 'danger', 4500);
            }
        });

        enviar('form-admin-modelo', async (form) => {
            const codigo = valor('mod-form-codigo').toUpperCase();
            const nombre = valor('mod-form-nombre');
            if (!codigo || !nombre) return;
            const ok = await this._ejecutar(() => api.crearModeloComercial({
                codigo_modelo: codigo, nombre, descripcion: 'Modelo comercial registrado desde Administración',
                microcontrolador_default: valor('mod-form-micro') || 'ESP8266',
                tiene_brazo: document.getElementById('mod-form-brazo').checked, tiene_motores_giro: true
            }), `Modelo ${codigo} registrado en RDS`);
            if (ok !== undefined) form.reset();
        });

        enviar('form-admin-unidad', async (form) => {
            const nombre = valor('unit-form-nombre');
            const serie = valor('unit-form-serie').toUpperCase();
            const idModelo = Number(valor('unit-form-modelo'));
            const estado = valor('unit-form-estado') || 'DISPONIBLE';
            const modeloObj = this.state.modelos.find((m) => Number(m.id_modelo) === idModelo);
            if (!nombre || !serie || !modeloObj) {
                ui.showFeedback('Completa nombre, serie y un modelo activo', 'warning');
                return;
            }
            const ok = await this._ejecutar(() => api.crearUnidadAdmin({
                nombre, id_modelo: idModelo, modelo: modeloObj.nombre, numero_serie: serie,
                microcontrolador: modeloObj.microcontrolador_default || 'ESP8266', estado_comercial: estado
            }), `Unidad '${nombre}' (${serie}) registrada en RDS`);
            if (ok !== undefined) form.reset();
        });

        enviar('form-admin-cliente', async (form) => {
            const nombre = valor('cli-form-nombre');
            const email = valor('cli-form-email').toLowerCase();
            const password = document.getElementById('cli-form-pass')?.value || '';
            if (!nombre || !email || password.length < 8) {
                ui.showFeedback('La contraseña inicial debe tener al menos 8 caracteres', 'warning');
                return;
            }
            const ok = await this._ejecutar(() => api.registrarCliente({ nombre, email, password }), `Cliente ${nombre} registrado en RDS`);
            if (ok !== undefined) form.reset();
        });

        enviar('form-admin-asignacion', async () => {
            const idVehiculo = Number(valor('asig-form-vehiculo'));
            const idUsuario = Number(valor('asig-form-cliente'));
            if (!idVehiculo || !idUsuario) return;
            await this._ejecutar(() => api.asignarUnidad({ id_vehiculo: idVehiculo, id_usuario: idUsuario }), `Unidad #${idVehiculo} asignada`);
        });

        enviar('form-editor-nueva-demo', async (form) => {
            const nombre = valor('demo-form-nombre');
            if (!nombre) return;
            const vid = CONFIG.VEHICULO_ID;
            const creada = await this._ejecutar(() => api.crearDemo({ id_vehiculo: vid, nombre, descripcion: valor('demo-form-desc') || null }),
                `Demo '${nombre}' guardada en RDS`, { recargar: false });
            if (creada === undefined) return;
            if (creada?.id_demo) this.idDemoSeleccionada = creada.id_demo;
            form.reset();
            await this.cargarDemosParaEditor(vid);
            if (this.onUnitChanged) await this.onUnitChanged(vid);
        });

        enviar('form-editor-agregar-paso', async () => {
            if (!this.idDemoSeleccionada) {
                ui.showFeedback('Selecciona o crea primero una secuencia DEMO', 'warning');
                return;
            }
            const idComando = Number(valor('step-form-comando'));
            const duracion = Number(valor('step-form-duracion'));
            const pausa = Number(valor('step-form-pausa'));
            if (!(duracion >= 100 && duracion <= 10000) || !(pausa >= 0 && pausa <= 5000)) {
                ui.showFeedback('Duración: 100–10,000 ms · Pausa: 0–5,000 ms', 'danger');
                return;
            }
            const orden = this.movimientosDemoActual.length ? Math.max(...this.movimientosDemoActual.map((m) => Number(m.orden) || 0)) + 1 : 1;
            const ok = await this._ejecutar(() => api.agregarMovimientoDemo(this.idDemoSeleccionada, { id_comando: idComando, orden, duracion_ms: duracion, pausa_ms: pausa }),
                `Paso #${orden} agregado`, { recargar: false });
            if (ok !== undefined) ui.playSound('start');
            await this.cargarPasosDeDemoSeleccionada(this.idDemoSeleccionada);
        });
    }
}

export const adminManager = new AdminManager();
