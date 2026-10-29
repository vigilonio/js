import { formatPrice } from "./pricing.js";

export function renderSummary(order) {
  const subtotal = formatPrice(order.subtotal);
  const shipping = formatPrice(order.shipping);
  return `${subtotal} + ${shipping}`;
}
