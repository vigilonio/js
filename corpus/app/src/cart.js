import { formatPrice } from "./pricing.js";

export function renderCartTotal(cart) {
  return `Total: ${formatPrice(cart.total)}`;
}
