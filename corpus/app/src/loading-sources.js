// The ways an invoice source and a sync task fail, passed to the same code.
export function failingNetwork() {
  throw new TypeError("Failed to fetch");
}

export function failingParse() {
  return JSON.parse("<html>");
}

export function failContacts() {
  throw new Error("contacts-sync-failed");
}

export function failCalendar() {
  throw new Error("calendar-sync-failed");
}

export function failQuota() {
  throw new RangeError("quota-exceeded");
}
