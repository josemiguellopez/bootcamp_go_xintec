// Cursor de texto grueso para los campos importantes (RUT y número de pedido).
//
// El cursor del navegador mide 1 píxel de ancho y casi no se ve; su grosor no se
// puede cambiar con CSS en todos los navegadores. Aquí se esconde el original
// (caret-color: transparent) y se dibuja una barra de 3 px que parpadea, en la
// misma posición: se mide el texto que hay antes del cursor con un <span> espejo
// que usa la misma letra.

export function thickCaret(input) {
  const wrap = input.parentElement;
  if (getComputedStyle(wrap).position === "static") wrap.style.position = "relative";

  const mirror = document.createElement("span");
  mirror.className = "caret-mirror";
  mirror.setAttribute("aria-hidden", "true");
  const bar = document.createElement("span");
  bar.className = "caret-bar";
  bar.setAttribute("aria-hidden", "true");
  bar.hidden = true;
  wrap.append(mirror, bar);
  input.classList.add("has-caret");

  function update() {
    const focused = document.activeElement === input;
    if (!focused || input.selectionStart !== input.selectionEnd) {
      bar.hidden = true; // sin foco, o con texto seleccionado (se ve la selección)
      return;
    }
    const cs = getComputedStyle(input);
    mirror.style.font = cs.font;
    mirror.style.letterSpacing = cs.letterSpacing;
    mirror.textContent = input.value.slice(0, input.selectionStart ?? input.value.length);
    const left = input.offsetLeft + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft);
    const right = input.offsetLeft + input.offsetWidth - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight);
    const x = Math.min(right, left + mirror.offsetWidth - input.scrollLeft);
    const h = Math.round(parseFloat(cs.fontSize) * 1.25);
    bar.style.height = `${h}px`;
    bar.style.transform = `translate(${x}px, ${input.offsetTop + (input.offsetHeight - h) / 2}px)`;
    bar.hidden = false;
    // Al moverse, el cursor se ve fijo un momento (como el original) y luego parpadea.
    bar.classList.remove("blink");
    void bar.offsetWidth;
    bar.classList.add("blink");
  }

  const later = () => requestAnimationFrame(update);
  for (const type of ["focus", "blur", "input", "click", "keyup", "select"]) input.addEventListener(type, later);
  input.addEventListener("keydown", later);
  document.addEventListener("selectionchange", () => {
    if (document.activeElement === input) later();
  });
  window.addEventListener("resize", later);
}
