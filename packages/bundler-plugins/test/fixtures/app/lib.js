export function formatPrice(price) {
  if (price === undefined) {
    throw new TypeError("price-missing");
  }
  return "$" + price.toFixed(2);
}
