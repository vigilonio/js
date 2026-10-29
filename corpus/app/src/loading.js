export function loadInvoices(source) {
  try {
    return source();
  } catch (cause) {
    throw new Error("invoices-load-failed", { cause });
  }
}

export function syncAll(tasks) {
  const failures = [];
  for (const task of tasks) {
    try {
      task();
    } catch (failure) {
      failures.push(failure);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, "sync-failed");
  }
}
