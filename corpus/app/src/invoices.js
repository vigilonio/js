import { formatPrice } from "./pricing.js";

export function renderInvoiceTotal(invoice) {
  return `Due: ${formatPrice(invoice.amountDue)}`;
}
