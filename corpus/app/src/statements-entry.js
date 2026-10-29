// Opens the lazily loaded statements chunk from two places.
export function openBillingStatements() {
  return import("./lazy/statements.js").then(({ openBilling }) => openBilling());
}

export function openReportStatements() {
  return import("./lazy/statements.js").then(({ openReports }) => openReports());
}
