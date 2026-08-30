export function usageErr(message) {
  return Object.assign(new Error(message), { kind: 'usage' })
}
