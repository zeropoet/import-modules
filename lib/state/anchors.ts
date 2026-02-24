export type AnchorSpec = {
  id: string
  position: [number, number]
  strength: number
}

function anchor(id: string, position: [number, number], strength = 1): AnchorSpec {
  return { id, position, strength }
}

// Keep this toggle to compare baseline vs extended constitutional anchor sets.
export const USE_EXTENDED_ANCHORS = true
export const USE_R90_ANCHORS = true

export function getConfiguredAnchors(): AnchorSpec[] {
  const base: AnchorSpec[] = [
    anchor("B", [-0.5, 0]),
    anchor("Ci", [0.5, 0])
  ]

  if (!USE_EXTENDED_ANCHORS) return base

  const diagonal = 0.5 / Math.sqrt(2)
  const extended: AnchorSpec[] = [
    ...base,
    anchor("B-y", [0, -0.5]),
    anchor("Ci-y", [0, 0.5]),
    ...(USE_R90_ANCHORS
      ? [
          anchor("B-r90", [-diagonal, -diagonal]),
          anchor("Ci-r90", [diagonal, -diagonal]),
          anchor("B-y-r90", [diagonal, diagonal]),
          anchor("Ci-y-r90", [-diagonal, diagonal])
        ]
      : [])
  ]
  return extended
}
