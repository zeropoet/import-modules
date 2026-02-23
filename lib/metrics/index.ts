import type { SimMetrics, SimState } from "@/lib/state/types"
import { evaluateAlignment } from "@/lib/alignment/controller"

function shannonEntropy(weights: number[]): number {
  const total = weights.reduce((sum, value) => sum + value, 0)
  if (total <= 0) return 0

  let entropy = 0
  for (const weight of weights) {
    if (weight <= 0) continue
    const p = weight / total
    entropy += -p * Math.log2(p)
  }

  const maxEntropy = Math.log2(Math.max(2, weights.length))
  return maxEntropy > 0 ? entropy / maxEntropy : 0
}

export function computeMetrics(state: SimState): SimMetrics {
  const livingDynamics = state.invariants.filter((inv) => inv.dynamic)
  const energies = livingDynamics.map((inv) => Math.max(0, inv.energy))
  const strengths = livingDynamics.map((inv) => Math.max(0, inv.strength))

  const totalEnergy = energies.reduce((sum, e) => sum + e, 0)
  const budget = state.globals.budget
  const conservedDelta = totalEnergy - budget

  const sortedStrengths = [...strengths].sort((a, b) => b - a)
  const topK = sortedStrengths.slice(0, Math.min(3, sortedStrengths.length))
  const totalStrength = sortedStrengths.reduce((sum, value) => sum + value, 0)
  const dominanceIndex = totalStrength > 0 ? topK.reduce((sum, value) => sum + value, 0) / totalStrength : 0

  const basinStability =
    state.basins.length > 0
      ? state.basins.reduce((sum, basin) => sum + Math.min(1, basin.frames / 20), 0) / state.basins.length
      : 0

  const core: SimMetrics = {
    totalEnergy,
    budget,
    conservedDelta,
    livingInvariants: livingDynamics.length,
    entropySpread: shannonEntropy(strengths),
    dominanceIndex,
    basinOccupancyStability: basinStability,
    alignmentScore: 0
  }

  const alignment = evaluateAlignment(core)
  core.alignmentScore = alignment.score
  return core
}
