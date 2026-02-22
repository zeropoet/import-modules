import { Stage } from "./stage"

export function computeDensity(stage: Stage, coords: number[], t: number): number {
  let base = stage.densityField(coords, t)

  for (const inv of stage.invariants) {
    const dist = Math.sqrt(
      inv.position.reduce((sum, p, i) => sum + Math.pow(p - (coords[i] ?? 0), 2), 0)
    )
    const influence = inv.dynamic ? inv.strength : inv.strength * 1.5
    base += influence * Math.exp(-dist * 4)
  }

  return base
}

export function computeEnergy(stage: Stage, coords: number[], t: number): number {
  if (!stage.energyField) return 0
  return stage.energyField(coords, t)
}

export function computeEnergyGradient(stage: Stage, coords: number[], t: number): [number, number] {
  const eps = 0.001
  const e = computeEnergy(stage, coords, t)
  const ex = computeEnergy(stage, [coords[0] + eps, coords[1]], t)
  const ey = computeEnergy(stage, [coords[0], coords[1] + eps], t)

  return [(ex - e) / eps, (ey - e) / eps]
}

export function computeDensityGradient(stage: Stage, coords: number[], t: number): [number, number] {
  const eps = 0.001
  const d = computeDensity(stage, coords, t)
  const dx = computeDensity(stage, [coords[0] + eps, coords[1]], t)
  const dy = computeDensity(stage, [coords[0], coords[1] + eps], t)

  return [(dx - d) / eps, (dy - d) / eps]
}
