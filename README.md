# Poka-Yoke Rollos 🔫✅

App web para PC + **escáner de pistola**: el operador valida que un **rollo** va en la **estación** correcta. Verde = correcto, Rojo = no colocar.

**App publicada:** https://gaelpm03.github.io/pokayoke-rollos/

## Cómo funciona

1. El operador dispara la pistola al código de la **estación** (la app rechaza el código si no es una estación). No hay que hacer clic en ningún campo: la app captura la pistola desde cualquier punto de la pantalla.
2. Dispara al código del **rollo**.
3. Resultado a pantalla completa con color + sonido:
   - ✅ **Verde** — el rollo sí va en esa estación.
   - ❌ **Rojo** — NO colocar; la app le dice en qué estación sí va.
   - ⚠️ **Amarillo** — código no registrado; avisar al supervisor.
4. La estación queda fijada: cada disparo siguiente valida otro rollo en la misma máquina (incluso desde la pantalla de resultado, un disparo procesa el siguiente rollo directo). "Cambiar estación" o disparar a otra estación para moverse de máquina.
5. Sin pistola, hay entrada manual con teclado.

### La pistola

Cualquier escáner USB en modo "teclado" (el de fábrica en casi todas) funciona sin configurar nada. Si la pistola no manda Enter al final del código, la app igual procesa la lectura tras una pausa corta.

## Administración (⚙️, PIN inicial: `1234`)

- **Materiales**: código del rollo (exacto o por *prefijo*: "todo rollo que empiece con MAT-12 es este material"), descripción y estaciones autorizadas (puede ser más de una). Para capturar el código sin teclear: pon el cursor en el campo y dispara la pistola.
- **Estaciones**: código y nombre de cada máquina.
- **Ajustes**: cambiar PIN, borrar datos.

⚠️ Cambia el PIN `1234` en el primer uso.

## Sincronizar configuración entre PCs (3 métodos)

1. **Código copiable**: Admin → Sincronizar → "Generar código" → Copiar. Pásalo a la otra PC (correo, Teams, USB) y pégalo en "Recibir configuración" → Aplicar.
2. **Archivo CSV**: Exportar/Importar — también sirve para editar la tabla en Excel.
3. **QR para pistolas 2D**: una PC muestra el QR en pantalla; desde la otra PC se le dispara con la pistola (si lee QR) y la app detecta e importa la configuración automáticamente, en cualquier pantalla.

Cada configuración lleva número de versión y fecha para saber cuál es la más nueva.

## Instalación en cada PC

1. Abrir https://gaelpm03.github.io/pokayoke-rollos/ en Chrome o Edge **una vez con internet**.
2. (Opcional) Menú del navegador → "Instalar Poka-Yoke Rollos" para tenerla como app con su propio ícono.
3. Después funciona **offline**; cuando haya internet se actualiza sola.

## Desarrollo

Probar local: `python -m http.server 8741` y abrir http://localhost:8741
Publicar cambios: `git push` (GitHub Pages se redespliega solo).

```
index.html         pantallas (escaneo, admin, historial)
css/styles.css     estilos
js/app.js          captura de pistola, flujo y UI
js/datos.js        datos, validación, CSV, código/QR de sincronización
js/lib/            librerías locales (qrcode-generator, lz-string)
sw.js              service worker (modo offline)
manifest.json      instalación como app
iconos/            iconos PNG
```
