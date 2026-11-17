// Los productos de la tienda. Precios en pesos chilenos (enteros, el CLP no usa decimales).
export const PRODUCTS = [
  { sku: "GO-TAZA", name: "Taza Gopher", price: 8990, mark: "☕" },
  { sku: "GO-POLERA", name: "Polera Go", price: 15990, mark: "👕" },
  { sku: "GO-LIBRETA", name: "Libreta", price: 6490, mark: "📓" },
  { sku: "GO-STICKERS", name: "Stickers", price: 2990, mark: "⭐" },
  { sku: "GO-CAFE", name: "Café en grano", price: 11990, mark: "🫘" },
  { sku: "GO-MOCHILA", name: "Mochila", price: 29990, mark: "🎒" },
];

/** Nombre del producto para imprimir en la boleta (si no lo conocemos, el SKU). */
export const productName = (sku) => PRODUCTS.find((p) => p.sku === sku)?.name ?? sku;
