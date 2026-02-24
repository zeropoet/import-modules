export type AnchorSpec = {
  id: string
  position: [number, number]
  strength: number
}

// Keep this toggle to compare baseline vs extended constitutional anchor sets.
export const USE_EXTENDED_ANCHORS = true
export const USE_R90_ANCHORS = true

export function getConfiguredAnchors(): AnchorSpec[] {
  const base: AnchorSpec[] = [
    { id: "B", position: [-0.5, 0], strength: 1 },
    { id: "Ci", position: [0.5, 0], strength: 1 }
  ]

  if (!USE_EXTENDED_ANCHORS) return base

  const diagonal = 0.5 / Math.sqrt(2)
  return [
    ...base,
    { id: "B-y", position: [0, -0.5], strength: 1 },
    { id: "Ci-y", position: [0, 0.5], strength: 1 },
    ...(USE_R90_ANCHORS
      ? [
          { id: "B-r90", position: [-diagonal, -diagonal], strength: 1 },
          { id: "Ci-r90", position: [diagonal, -diagonal], strength: 1 },
          { id: "B-y-r90", position: [diagonal, diagonal], strength: 1 },
          { id: "Ci-y-r90", position: [-diagonal, diagonal], strength: 1 }
        ]
      : [])
  ]
}
