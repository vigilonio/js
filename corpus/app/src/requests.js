export function loadProfile(response) {
  if (!response.ok) {
    throw new Error("Request failed");
  }
  return response.body;
}

export function loadReport(response) {
  if (response.status !== 200) {
    throw new Error("Request failed");
  }
  return response.body;
}
