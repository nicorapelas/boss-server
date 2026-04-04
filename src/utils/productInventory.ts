/** When false, product is a service / labour line: no stock checks or decrements. Default true for legacy docs. */
export function productTracksInventory(p: { trackInventory?: boolean } | null | undefined): boolean {
  if (!p) return true
  return p.trackInventory !== false
}
