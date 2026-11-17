# EventFlow en vivo (sitio)

Sitio para probar la API del desafío sin saber programar. Tiene cuatro secciones, una a la vista a la vez
(pestañas del menú):

1. **Hacer un pedido** en 3 pasos: RUT, productos y enviar. Una impresora térmica imprime la boleta (con sonido de
   impresora y corte de papel) y debajo se ven los 6 pasos que recorre el pedido: API → PostgreSQL → RabbitMQ →
   Worker y Email. Al terminar, el formulario se esconde y el sitio pregunta si quiere crear un nuevo pedido.
   Arriba del formulario se elige quién lo arma: «Lo hago yo» o «Que lo haga un agente».
2. **Buscar un pedido** por su número (`GET /orders/{id}`). La base de datos se muestra como un archivador con
   cajones (0–4, 5–9, a–f): el Agente PostgreSQL los revisa uno por uno (abre, lee las fichas, cierra con «✗
   revisado») hasta llegar al cajón del primer carácter del número; la ficha del pedido sale volando a una
   impresora, que imprime la boleta, y desde ella se puede cambiar el estado. Es una ilustración: PostgreSQL de
   verdad va directo al cajón correcto con el índice `orders_pkey` (lo aclara el desplegable técnico, junto al SQL).
   Las fichas vecinas son inventadas; la ficha encontrada y la boleta son la respuesta real de la API.
3. **Resultado del desafío**: una prueba por criterio de aceptación del PDF (RF-01 a RF-14), agrupadas por nivel.
   *Probar todo* ejecuta las automáticas y dice cuántas cumplen. El resultado se ve de dos formas:
   - **Resumen simple**: una frase por requisito («Reintentar no duplica el pedido»), para cualquier persona.
   - **Resumen técnico**: el criterio literal del PDF, cómo se comprueba, la evidencia (cada petición con su código,
     tiempo, `X-Request-ID` y JSON de ida y vuelta), los archivos de código y las pruebas en Go que lo cubren.
   - **Copiar informe** genera un informe en Markdown con todo lo anterior.
4. **Cómo funciona**: las seis piezas del sistema, cada una con su agente bot.

Colores y tipografía tomados de xintec.cl (rojo `#F23D49`, azul marino `#2A2F4F`, Poppins y Open Sans).
Pensado para cualquier persona: letra grande, botones grandes, alto contraste, palabras simples y un botón **A+**
para agrandar todo. Los detalles técnicos (peticiones y JSON) están en un desplegable para programadores.

## Ejecutar en local

Guía completa (Docker, base de datos local, RabbitMQ, logs y problemas frecuentes):
[docs/06-sitio-web.md](../docs/06-sitio-web.md).

```powershell
# 1. levantar la API real, desde la raíz del repositorio (con Docker Desktop abierto)
docker compose up -d --build

# 2. levantar el sitio
cd site
npm install
npm run dev
```

Abre <http://localhost:5173>.

- **Con la API levantada**, el indicador de arriba dice *Conectado*: cada pedido y cada prueba van a tu API en Go.
- **Sin la API**, dice *Modo de prueba*: todo funciona igual, pero se simula en el navegador con las mismas reglas.
  Cuando levantes `docker compose`, haz clic en el indicador para volver a conectar.

## Cómo se conecta con la API

El servidor de Vite hace de *proxy* (ver `vite.config.js`), así que el navegador ve todo en el mismo origen y la API
no necesita CORS:

| Ruta del sitio | Va a |
|---|---|
| `/api/...` | `http://localhost:3200/...` (API) |
| `/worker/...` | `http://localhost:3201/...` (health y métricas del worker) |

Para apuntar a otra dirección: `$env:EVENTFLOW_API = "http://otra-maquina:3200"; npm run dev`.

## Qué es real y qué se deduce

| Paso | De dónde sale |
|---|---|
| API | La respuesta del `POST /orders` |
| PostgreSQL | El pedido devuelto por la API (ya está guardado) |
| RabbitMQ | El contador `events_published_total` de `/metrics` subió (o `events_publish_failed_total`, si RabbitMQ cayó) |
| Worker | `GET /orders/{id}` hasta ver `listo_para_despacho` |
| Email | El contador `messages_processed_total` del worker subió; también muestra los reintentos y la DLQ |

## Archivos

| Archivo | Qué hace |
|---|---|
| `index.html` | La página. Un script en `<head>` elige la sección (`#pedido`, `#buscar`…) antes de pintar y el CSS va enlazado ahí mismo, para que no haya un instante sin estilos |
| `src/main.js` | Arranque: pestañas, indicador de conexión, sonido y tamaño de letra |
| `src/workshop.js` | Hacer un pedido: formulario, carrito, los 6 pasos, «¿Desea crear un nuevo pedido?» y la consola técnica |
| `src/boleta.js` | La boleta térmica: ítems, IVA incluido, timbre del estado, seguimiento, código de barras, la animación de la impresora e imprimir/guardar PDF. Es un comprobante de práctica (dice "sin validez tributaria") |
| `src/sound.js` | Sonidos de la impresora: la impresión y el corte salen de `public/sounds/impresora.mp3` (grabación de impresora antigua, recortada a mono); el pitido final se genera con Web Audio. Las constantes `PRINT_FROM`, `PRINT_UNTIL` y `CUT_FROM` dicen qué tramo de la grabación es cada cosa |
| `src/intro.js` | La entrada corta (~2,5 s, una vez por visita): los bots bocetean los íconos sobre un plano tipo AutoCAD y luego se "renderizan" en 3D |
| `src/scene.js` | La tienda de fondo: estanterías, lámparas y piso |
| `src/market.js` | El minimarket de abajo: un mini videojuego isométrico en `<canvas>`. Clientes que eligen productos y conversan (frases chilenas), chocan en el pasillo y se les cae algo, hacen fila y pagan; el Agente API atiende la caja y el Agente Worker repone, recoge y trapea. Solo se anima cuando está a la vista |
| `src/tienda.css` | Estilos de la tienda, la intro, el carrito con canasto (los productos vuelan adentro) y los marcos que dibujan los agentes |
| `src/search.js` | Buscar un pedido: el archivador (cajones y fichas), la ficha que vuela a la impresora y la boleta |
| `src/caret.js` | Cursor de texto grueso (3 px) para el RUT y el número de pedido: el del navegador mide 1 px y casi no se ve |
| `src/checks.js` | Las pruebas de cada requisito del PDF |
| `src/api.js` | Cliente de la API real y del modo de prueba (misma forma) |
| `src/ui.js` | Piezas compartidas: dinero, textos de estado y de error, botón Copiar y avisos |
| `src/swarm.js` | Los cursores de los agentes bot: la primera vez que se abre cada sección dibujan marcos sobre lo que tiene `data-build` (solo decoración: el contenido ya está a la vista), y también hacen el pedido de ejemplo y las pruebas |
| `src/agents.js` | Los seis agentes (nombre, velocidad) |
| `src/products.js` | Los productos de la tienda, con precios en pesos chilenos |
| `src/icons.js` | La carita de los agentes bot e íconos propios de la tecnología |

La idea de los cursores con nombre está inspirada en [swarm-site](https://github.com/califa/swarm-site); la
implementación es propia. Con *reducir movimiento* activado en el sistema operativo, no hay animaciones.

## Deploy

Pendiente (Vercel u otro). En producción no existe el proxy de Vite: el sitio funcionará en modo de prueba, o habrá
que publicar la API y configurar su URL.
