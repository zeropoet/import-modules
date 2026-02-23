import type { SimInvariant, SimState, Vec2 } from "@/lib/state/types"

export function computeDensity(state: SimState, coords: Vec2): number {
  let base = state.fields.density(coords, state.globals.time)

  for (const inv of state.invariants) {
    const dx = inv.position[0] - coords[0]
    const dy = inv.position[1] - coords[1]
    const dist = Math.hypot(dx, dy)
    const influence = inv.dynamic ? inv.strength : inv.strength * 1.5
    base += influence * Math.exp(-dist * 4)
  }

  return base
}

export function computeEnergy(state: SimState, coords: Vec2): number {
  if (!state.globals.energyEnabled) return 0
  return state.fields.energy(coords, state.globals.time)
}

export function computeEnergyGradient(state: SimState, coords: Vec2): Vec2 {
  const eps = 0.001
  const e = computeEnergy(state, coords)
  const ex = computeEnergy(state, [coords[0] + eps, coords[1]])
  const ey = computeEnergy(state, [coords[0], coords[1] + eps])
  return [(ex - e) / eps, (ey - e) / eps]
}

export function computeDensityGradient(state: SimState, coords: Vec2): Vec2 {
  const eps = 0.001
  const d = computeDensity(state, coords)
  const dx = computeDensity(state, [coords[0] + eps, coords[1]])
  const dy = computeDensity(state, [coords[0], coords[1] + eps])
  return [(dx - d) / eps, (dy - d) / eps]
}

export type BasinCluster = {
  x: number
  y: number
  count: number
}

export function clusterPoints(points: Array<{ x: number; y: number }>, radius: number): BasinCluster[] {
  const clusters: Array<{ xSum: number; ySum: number; count: number }> = []

  for (const point of points) {
    let bestIndex = -1
    let bestDistance = Number.POSITIVE_INFINITY

    for (let i = 0; i < clusters.length; i += 1) {
      const cluster = clusters[i]
      const cx = cluster.xSum / cluster.count
      const cy = cluster.ySum / cluster.count
      const distance = Math.hypot(point.x - cx, point.y - cy)
      if (distance < radius && distance < bestDistance) {
        bestIndex = i
        bestDistance = distance
      }
    }

    if (bestIndex === -1) {
      clusters.push({ xSum: point.x, ySum: point.y, count: 1 })
    } else {
      clusters[bestIndex].xSum += point.x
      clusters[bestIndex].ySum += point.y
      clusters[bestIndex].count += 1
    }
  }

  return clusters.map((cluster) => ({
    x: cluster.xSum / cluster.count,
    y: cluster.ySum / cluster.count,
    count: cluster.count
  }))
}

export function dynamicInvariants(state: SimState): SimInvariant[] {
  return state.invariants.filter((inv) => inv.dynamic)
}
