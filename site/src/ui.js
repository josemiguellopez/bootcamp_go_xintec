// Piezas de interfaz compartidas: formato de dinero, estados en palabras simples,
// el recibo de un pedido, el botón "Copiar" y los avisos breves.

/** Pesos chilenos, sin decimales: 21970 -> "$21.970". */
const CLP = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP" });
export const money = (pesos) => CLP.format(pesos);

export const shortId = (id) => (id ? id.slice(0, 8) + "…" : "");
export const newKey = () => "pedido-" + crypto.randomUUID().slice(0, 8);

/** Los seis estados que definió el profesor, dichos para cualquier persona. */
export const STATUS = {
  en_preparacion: { text: "En preparación", help: "Recibido y guardado. Un trabajador lo dejará listo para despacho en unos segundos." },
  listo_para_despacho: { text: "Listo para despacho", help: "Preparado. Cuando salga a reparto, márquelo como enviado." },
  en_transito: { text: "En camino", help: "El pedido va en camino al cliente." },
  entregado: { text: "Entregado", help: "El cliente recibió el pedido." },
  no_entregado: { text: "No entregado", help: "No se pudo entregar. Puede intentarlo de nuevo o devolverlo a la tienda." },
  devuelto: { text: "Devuelto", help: "El pedido volvió a la tienda. Es el estado final." },
};

/** Cada código de error de la API, explicado con palabras simples. */
export const EXPLAIN = {
  ORDER_EMPTY_ITEMS: "El pedido no tiene productos. Agregue al menos uno con el botón +.",
  ORDER_TOO_MANY_ITEMS: "El pedido tiene más de 100 productos distintos.",
  ORDER_INVALID_CUSTOMER: "El RUT no es válido. Revise los números y el dígito verificador (por ejemplo 12.345.678-5).",
  ORDER_INVALID_TRANSITION: "Ese cambio de estado no está permitido desde el estado actual.",
  ORDER_INVALID_STATUS: "Ese estado no existe.",
  ORDER_INVALID_QUANTITY: "La cantidad de cada producto debe estar entre 1 y 10.000.",
  ORDER_INVALID_PRICE: "El precio debe ser mayor que cero.",
  ORDER_INVALID_SKU: "Cada producto necesita un código.",
  INVALID_JSON: "El pedido llegó mal escrito o con datos que el sistema no conoce.",
  PAYLOAD_TOO_LARGE: "El pedido es demasiado grande.",
  IDEMPOTENCY_KEY_INVALID: "La clave para reintentar es demasiado larga.",
  ORDER_NOT_FOUND: "No existe ningún pedido con ese número. Revise que esté completo.",
  ORDER_INVALID_ID: "Ese no es un número de pedido válido. Tiene la forma 4f1c2a8e-6a8e-4e0f-9b43-6a1f1d1f6c11.",
  ROUTE_NOT_FOUND: "Esa dirección no existe en la API.",
  INTERNAL_ERROR: "El sistema tuvo un problema interno. Por seguridad no muestra detalles.",
  TIMEOUT: "El sistema tardó demasiado en responder. Intente de nuevo.",
};

/** Crea un elemento con clase y texto (sin innerHTML, para no inyectar nada). */
export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

let toastTimer = 0;
/** Muestra un aviso breve abajo de la pantalla. */
export function toast(message) {
  const box = document.getElementById("toast");
  box.textContent = message;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (box.hidden = true), 2200);
}

/** Copia texto al portapapeles y avisa. */
export async function copy(text, message = "Número copiado") {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Navegadores sin permiso de portapapeles: copiamos con un campo temporal.
    const area = el("textarea");
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  toast(message);
}

/** Botón "Copiar" para un número de pedido. */
export function copyButton(id) {
  const btn = el("button", "btn copy-btn", "Copiar");
  btn.type = "button";
  btn.setAttribute("aria-label", "Copiar el número de pedido");
  btn.addEventListener("click", () => copy(id));
  return btn;
}

/** Dibuja un mensaje de error grande y claro dentro de box. */
export function renderProblem(box, title, message, detail) {
  box.dataset.state = "error";
  const head = el("div", "receipt-head");
  head.append(el("span", "receipt-check bad", "!"), el("h3", "receipt-title", title));
  box.replaceChildren(head, el("p", "receipt-problem", message));
  if (detail) box.append(el("p", "receipt-detail", detail));
}
