# 🚜 Vehículo IoT — Plataforma Unificada (Control 4.1 · Monitoreo 4.2 · Administración 4.3 · Gemelo 3D · VR · IA)

Aplicación web integral (SPA + PWA) que unifica en un solo proyecto el control en tiempo real, el monitoreo sobre Amazon RDS, el módulo de administración multi-rol con seguridad RBAC / Anti-BOLA, el **Gemelo Digital 3D** interactivo (Three.js), la **Realidad Virtual** (WebXR + Cardboard para celular) y el **Control con Inteligencia Artificial** (voz, gestos de la mano y giroscopio).

---

## ✨ Módulos Integrados

### 1. 🎮 Vista Control (Práctica 4.1 + Gemelo 3D + IA)
- **Gemelo Digital 3D (`scene3d.js`)**: Excavadora articulada en Three.js `0.170.0` con orugas animadas, giro de cabina, brazo hidráulico, faros LED, partículas de escape turbo y cámara con seguimiento automático.
- **Consola 3D de Botones Físicos (`botones3d.js`)**: Botonera 3D interactiva integrada en el escenario tridimensional.
- **HUD de Botones con Relieve 3D**: Cruces direccionales (*Movimiento* y *Brazo/Motores*), *Accesorios* dinámicos desde RDS, **Velocímetro digital en vivo (`km/h`)**, botón prioritario **Detener** y **Secuencias Demo**.
- **Control con IA (`control-ia.js`)**:
  - 🎤 **Voz** (`Web Speech API`): Comandos naturales en español (*"avanza 3 segundos"*, *"sube el brazo"*, *"enciende la luz"*, *"alto"*).
  - ✋ **Gestos** (`MediaPipe Hands`): Detección de 21 puntos de la mano por cámara web en tiempo real.
  - 📱 **Giroscopio** (`DeviceOrientation`): Inclinación del celular en 3 modos (`🚜 Conducir`, `🦾 Brazo`, `✨ Accesorios`) con mira de calibración.
- **Asistente IA Conversacional (`asistente-ia.js`)**: Chat con dictado por voz, intérprete local de rutinas multi-paso y conexión opcional a Claude (Anthropic API o proxy en `server/cloudflare-worker.js`).

### 2. 📊 Vista Monitoreo (Práctica 4.2)
- Tarjeta en vivo del **Último Movimiento** registrado en Amazon RDS con semáforo dinámico de estado.
- Tabla de **Últimos 10 Movimientos** actualizada en tiempo real mediante **WebSocket (`WSS`)** y respaldo HTTP REST.

### 3. 🛡️ Vista Administración, Roles y Seguridad (Práctica 4.3)
- **Control de Acceso Basado en Roles (RBAC) y Anti-BOLA (`admin.js`)**:
  - **Administrador (Empresa)**: Métricas reales, inventario de unidades físicas, catálogo de modelos comerciales (`EXC-IOT-V1` con brazo, `ROV-IOT-V1` sin brazo), habilitación de comandos por unidad, alta de clientes compradores, asignación de propiedad y bitácora de auditoría.
  - **Usuario Comprador (`Cynthia` / `Carlos`)**: Operación exclusiva de sus unidades asignadas y switch de autorización explícita de soporte técnico.
  - **Invitado (`Demo 3 min`)**: Reserva temporal de unidades de exhibición con temporizador en vivo.
- **Verificador de Casos Negativos (`403 Forbidden`)**: Pruebas integradas contra accesos cruzados BOLA, operación administrativa sin permiso de soporte y acceso de invitado a unidades vendidas.
- **Editor de Secuencias DEMO y Pasos Ordenados**: Creación de rutinas personalizadas en RDS con validación de compatibilidad por modelo, duración (`100–10,000 ms`), pausa y reordenamiento secuencial.

### 4. 🥽 Realidad Virtual (WebXR + VR Celular Cardboard)
- **Modo VR WebXR (`vr-controls.js`)**: Cabina inmersiva para visores Meta Quest con paneles 3D flotantes tanto de **Control (4.1)** como de **Monitoreo RDS (4.2)**.
- **VR Celular Cardboard (`vr-celular.js`)**: Pantalla dividida estereoscópica con giroscopio, control por mirada (*gaze reticle* de `1.6 s`) y comandos por voz.

### 5. 🕹️ Modo Simulación y PWA
- **Modo Simulación Automático**: Si el backend en AWS no está disponible, la aplicación activa automáticamente el modo simulación para probar el Gemelo 3D, VR, IA y administración sin interrupciones.
- **PWA Instalable**: Incluye `manifest.webmanifest` y Service Worker (`sw.js`).
