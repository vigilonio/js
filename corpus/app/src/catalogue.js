// Common TypeError, ReferenceError, SyntaxError, and RangeError shapes, each
// behind a parameter so a minifier cannot fold it away.
export const userId = (user) => user.id;
export const userName = (user) => user.name;
export const userEmail = (user) => user.email;
export const field = (record, key) => record[key];
export const save = (api) => api.save();
export const invoke = (api, method) => api[method]();
export const useMissingHelper = () => missingGlobalHelper();
export const copy = (list) => [...list];
export function sum(list) {
  let total = 0;
  for (const value of list) {
    total += value;
  }
  return total;
}
export function rename(user) {
  user.name = "renamed";
}
export function assign(record, key) {
  record[key] = "assigned";
}
export const make = (api) => new api.Client();
export const parseSettings = (text) => JSON.parse(text);
export const allocate = (length) => new Array(length);
export const hasId = (record) => "id" in record;
