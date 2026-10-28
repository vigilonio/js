import { formatPrice } from "./lib.js";

export function renderInvoices(invoices) {
  return invoices.map((invoice) => formatPrice(invoice.total)).join("\n");
}
