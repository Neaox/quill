/**
 * Search-param helpers shared by the route files beside this one. The `-`
 * prefix is the file-based router's convention for a module inside
 * `src/routes` that is not itself a route.
 */

/**
 * One optional string search param: present when the URL carried a string,
 * and the key omitted entirely when it did not, so `exactOptionalPropertyTypes`
 * can tell "absent" from "set to undefined".
 */
export function optionalStringSearch(
  search: Record<string, unknown>,
  key: string,
): Record<string, string> {
  const value = search[key]
  return typeof value === 'string' ? { [key]: value } : {}
}
