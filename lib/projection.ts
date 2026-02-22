export function projectTo2D(coords: number[]): [number, number] {
  // Simple orthographic projection.
  return [coords[0] ?? 0, coords[1] ?? 0]
}
