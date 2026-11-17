// Los seis agentes. Cada uno representa una pieza real del sistema EventFlow.
//   speed:  qué tan rápido se mueve (1 = normal)
//   typeMs: milisegundos por letra al escribir
// Los colores están definidos en style.css (--a-<id>) para usarlos también en el HTML.
export const AGENTS = [
  { id: "cliente", name: "Cliente", speed: 1.5, typeMs: 10 },
  { id: "api", name: "API", speed: 1.75, typeMs: 8 },
  { id: "postgres", name: "PostgreSQL", speed: 1.25, typeMs: 13 },
  { id: "rabbit", name: "RabbitMQ", speed: 1.55, typeMs: 9 },
  { id: "worker", name: "Worker", speed: 1.15, typeMs: 14 },
  { id: "email", name: "Email", speed: 1.4, typeMs: 11 },
];

/** Color del agente, leído de la variable CSS --a-<id>. */
export function agentColor(id) {
  return getComputedStyle(document.documentElement).getPropertyValue(`--a-${id}`).trim();
}
