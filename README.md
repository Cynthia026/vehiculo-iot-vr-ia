# 🚜 Vehículo IoT — Plataforma Unificada (Control 4.1 · Monitoreo 4.2 · Administración 4.3 · Gemelo 3D · VR · IA)

Aplicación web integral (**SPA + PWA**) que unifica en un solo proyecto el control en tiempo real, el monitoreo sobre Amazon RDS, el módulo de administración multi-rol con seguridad **RBAC / Anti-BOLA**, el **Gemelo Digital 3D** interactivo (Three.js), la **Realidad Virtual** (**WebXR** + **VR Celular Cardboard** + **Consola 3D en Modo VR**) y el **Control con Inteligencia Artificial** (**Voz**, **Gestos de la mano**, **Giroscopio** y **Asistente IA Conversacional**).

---

## ✨ Módulos Integrados

1. **🎮 Vista Control (Práctica 4.1 + Gemelo 3D + IA)**:
   - **Gemelo Digital 3D (`scene3d.js`)**: Excavadora articulada en Three.js `0.170.0` con orugas animadas, giro de cabina, brazo hidráulico, faros LED, partículas de escape turbo y cámara con seguimiento automático sobre fondo espacial animado (`#space-bg`).
   - **HUD de Botones con Relieve 3D**: Cruces direccionales (*Movimiento* y *Brazo/Motores*), *Accesorios* dinámicos desde RDS, **Velocímetro digital en vivo (`km/h`)**, botón prioritario **Detener** y **Secuencias Demo**.
2. **🥽 Realidad Virtual y Consola 3D (`botones3d.js`, `vr-controls.js`, `vr-celular.js`)**:
   - **Vista Normal de Computadora**: Muestra limpia la excavadora 3D en el centro rodeada por los paneles del HUD.
   - **Modo VR (Lentes WebXR / Modo VR en Computadora / VR Celular Cardboard)**: Aparece la **Consola 3D de Botones Físicos** junto a la excavadora con *Brazo y Motores*, *Movimiento*, *Accesorios*, *STOP*, *Control con IA (`🎤 VOZ`, `✋ GESTOS`, `📱 GIRO`, `✨ ASIST. IA`)* y *Secuencias Demo (`⟳ CAMBIAR`, `▶ INICIAR`, `✕ CANCELAR`)*.
3. **📊 Vista Monitoreo (Práctica 4.2)**:
   - Tarjeta en vivo del **Último Movimiento** registrado en Amazon RDS con semáforo dinámico y tabla de **Últimos 10 Movimientos** vía **WebSocket (`WSS`)** + REST.
4. **🛡️ Vista Administración, Roles y Seguridad (Práctica 4.3)**:
   - **Control de Acceso Basado en Roles (RBAC) y Anti-BOLA (`admin.js`)**: Roles **Administrador**, **Usuario Comprador (`Cynthia` / `Carlos`)** e **Invitado (`Demo 3 min`)**, inventario de unidades físicas, catálogo de modelos comerciales (`EXC-IOT-V1` con brazo, `ROV-IOT-V1` sin brazo), autorización explícita de soporte técnico, pruebas negativas `403 Forbidden`, bitácora de auditoría y **Editor de Secuencias DEMO y Pasos Ordenados**.

---

## 🎤 Comandos de Voz Aceptados (`ControlVoz` y `AsistenteIA`)

El reconocimiento de voz funciona en español (`es-MX` / `es-ES`). Puedes especificar una duración entre **0.5 y 10 segundos** (por defecto cada movimiento dura **2 segundos**, ej. *"avanza 4 segundos"*, *"sube el brazo dos segundos"*).

### 1. Movimientos de Conducción y Chasis
| Acción / Comando (`RDS`) | Frases de voz aceptadas (ejemplos) |
| :--- | :--- |
| **`AVANZAR`** | *"avanza"*, *"avanzar"*, *"adelante"*, *"delante"*, *"enfrente"*, *"sigue"*, *"camina"*, *"recto"*, *"derecho"*, *"muévete"*, *"arranca"*, *"vamos"*, *"avanza 3 segundos"* |
| **`RETROCEDER`** | *"retrocede"*, *"retroceder"*, *"atrás"*, *"reversa"*, *"regresa"*, *"hacia atrás"*, *"retrocede 2 segundos"* |
| **`GIRAR_IZQUIERDA`** | *"gira a la izquierda"*, *"izquierda"*, *"vuelta a la izquierda"*, *"gira 90 grados a la izquierda"* |
| **`GIRAR_DERECHA`** | *"gira a la derecha"*, *"derecha"*, *"vuelta a la derecha"*, *"gira 90 grados a la derecha"* |
| **`DETENER` (Prioridad máxima)** | *"alto"*, *"para"*, *"parar"*, *"párate"*, *"detente"*, *"detén"*, *"detener"*, *"detenlo"*, *"stop"*, *"frena"*, *"frenar"*, *"quieto"*, *"basta"*, *"espera"* |

### 2. Brazo Hidráulico y Giro de Cabina / Motores
| Acción / Comando (`RDS`) | Frases de voz aceptadas (ejemplos) |
| :--- | :--- |
| **`SUBIR_BRAZO`** | *"sube el brazo"*, *"subir brazo"*, *"levanta el brazo"*, *"eleva la pala"*, *"sube el cucharón"*, *"arriba el brazo"* |
| **`BAJAR_BRAZO`** | *"baja el brazo"*, *"bajar brazo"*, *"desciende el brazo"*, *"baja la pala"*, *"baja el cucharón"*, *"abajo el brazo"* |
| **`MOTOR_IZQUIERDA`** | *"motor izquierdo"*, *"motor a la izquierda"*, *"cabina a la izquierda"*, *"torreta a la izquierda"* |
| **`MOTOR_DERECHA`** | *"motor derecho"*, *"motor a la derecha"*, *"cabina a la derecha"*, *"torreta a la derecha"* |

### 3. Accesorios y Secuencias Demo
| Acción / Comando | Frases de voz aceptadas (ejemplos) |
| :--- | :--- |
| **`LUZ` (Faros LED)** | *"enciende la luz"*, *"prende las luces"*, *"apaga la luz"*, *"activa los faros"*, *"ilumina"* |
| **`VELOCIDAD` (Modo Turbo)** | *"activa el turbo"*, *"sube la velocidad"*, *"más rápido"*, *"acelera"*, *"baja la velocidad"*, *"modo normal"*, *"más lento"* |
| **`SONIDO` (Claxon / Bocina)** | *"toca el claxon"*, *"suena la bocina"*, *"sonido"*, *"pita"*, *"toca la alarma"* |
| **Iniciar Secuencia DEMO** | *"inicia la demo"*, *"ejecuta la demo de excavación"*, *"pon la rutina de recorrido"*, *"inicia la demo 1"* |
| **Cancelar Secuencia DEMO** | *"cancela la demo"*, *"detén la demo"*, *"termina la rutina"*, *"para la secuencia"* |

### 4. Órdenes Compuestas y Maniobras Especiales (`Asistente IA`)
Cuando dices o escribes frases con varias acciones encadenadas (*"y luego"*, *"después"*, *"N veces"*) o figuras geométricas, el **Asistente IA** genera y ejecuta el plan paso a paso:
- **Figuras y maniobras**:
  - *"Haz un cuadrado"* (4 tramos de avance + giros de 90°)
  - *"Haz un triángulo"* (3 tramos de avance + giros de 120°)
  - *"Haz un zigzag"*
  - *"Baila"* / *"Fiesta"* (luces, claxon, giros y saludo con el brazo)
  - *"Saluda"* / *"Hola"* (claxon + movimiento de saludo con el brazo)
  - *"Excava"* / *"Cava"* (ciclo completo de excavación con brazo y cabina)
- **Giros por ángulo exacto**:
  - *"Gira 90 grados a la derecha"*, *"Da media vuelta"* (180°), *"Da una vuelta completa"* (360°)
- **Secuencias combinadas y repeticiones**:
  - *"Avanza 2 segundos, gira a la derecha y luego enciende la luz"*
  - *"Sube y baja el brazo 3 veces"*
- **Comandos exclusivos en modo VR Celular**:
  - *"Centrar"* / *"Calibrar"* (recentra la vista del visor)
  - *"Salir"* / *"Cerrar VR"* (sale del modo VR celular)

---

## ✋ Gestos de la Mano Aceptados (`ControlGestos` — MediaPipe)

Al activar el modo **Gestos**, la cámara detecta en tiempo real los 21 puntos de tu mano (en modo espejo para que coincida con tu dirección natural):

| Gesto con la mano | Comando ejecutado | Descripción |
| :--- | :--- | :--- |
| **☝ Índice apuntando arriba** | **`AVANZAR`** | Extiende solo el dedo índice hacia arriba (resto de dedos doblados). |
| **👇 Índice apuntando abajo** | **`RETROCEDER`** | Extiende solo el dedo índice apuntando hacia abajo. |
| **👈 Índice apuntando a tu izquierda** | **`GIRAR_IZQUIERDA`** | Extiende solo el dedo índice apuntando hacia tu lado izquierdo. |
| **👉 Índice apuntando a tu derecha** | **`GIRAR_DERECHA`** | Extiende solo el dedo índice apuntando hacia tu lado derecho. |
| **✋ Palma abierta** (`Open_Palm`) | **`DETENER`** | Muestra la palma abierta frente a la cámara para paro inmediato. |
| **✊ Puño cerrado** (`Closed_Fist`) | **`DETENER`** | Cierra el puño frente a la cámara para paro inmediato. |
| **👍 Pulgar arriba** (`Thumb_Up`) | **`SUBIR_BRAZO`** | Levanta el pulgar para elevar el brazo hidráulico. |
| **👎 Pulgar abajo** (`Thumb_Down`) | **`BAJAR_BRAZO`** | Apunta el pulgar hacia abajo para descender el brazo hidráulico. |
| **✌ Señal de Victoria / Paz** (`Victory`) | **`LUZ`** | Extiende índice y medio en "V" para encender/apagar los faros LED. |
| **🤟 Gesto Rock / "Te quiero"** (`ILoveYou`) | **`SONIDO`** | Extiende pulgar, índice y meñique para activar el claxon/sonido. |

---

## 📱 Modos del Giroscopio (`ControlGiroscopio`)

En dispositivos móviles puedes inclinar el teléfono desde la posición neutra (con botón **Recalibrar**) en 3 modos:
1. **🚜 Conducir**: Inclinar adelante = `AVANZAR` · atrás = `RETROCEDER` · izquierda = `GIRAR_IZQUIERDA` · derecha = `GIRAR_DERECHA`.
2. **🦾 Brazo**: Inclinar hacia ti (atrás) = `SUBIR_BRAZO` · adelante = `BAJAR_BRAZO` · izquierda = `MOTOR_IZQUIERDA` · derecha = `MOTOR_DERECHA`.
3. **✨ Accesorios**: Inclinar adelante = `VELOCIDAD (Turbo)` · izquierda = `LUZ` · derecha = `SONIDO`.
