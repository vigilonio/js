export function formatPrice(amount) {
  if (amount === undefined) {
    throw new TypeError("price-missing");
  }
  return `$${amount.toFixed(2)}`;
}
