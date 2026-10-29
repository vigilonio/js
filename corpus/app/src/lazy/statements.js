// Loaded with a dynamic import, so it is a chunk of its own.
async function fetchStatements() {
  await Promise.resolve();
  throw new Error("statements-unavailable");
}

export async function openBilling() {
  return fetchStatements();
}

export async function openReports() {
  return fetchStatements();
}
