import { formatPrice } from "./lib.js";

export function renderTotal(price) {
  document.title = formatPrice(price);
}

export async function openInvoices() {
  const { renderInvoices } = await import("./lazy.js");
  return renderInvoices([]);
}

renderTotal(globalThis.initialPrice);
globalThis.addEventListener?.("click", openInvoices);
