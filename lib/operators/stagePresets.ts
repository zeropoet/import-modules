import { event, type Operator, type StagePreset } from "@/lib/operators/types"
import type { Basin, ProbeParticle, SimInvariant, SimState } from "@/lib/state/types"
import { clusterPoints, computeDensityGradient, computeEnergyGradient, dynamicInvariants } from "@/lib/sim/math"

const DOMAIN = 1

function seededUnit(seed: number, salt: number): number {
  const x = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453
  return x - Math.floor(x)
}

function randomProbe(seed: number, tick: number, salt: number): ProbeParticle {
  const x = seededUnit(seed, tick * 113 + salt * 17)
  const y = seededUnit(seed, tick * 197 + salt * 23)
  return {
    x: (x * 2 - 1) * DOMAIN,
    y: (y * 2 - 1) * DOMAIN
  }
}

function ensureAnchor(state: SimState, id: string, position: [number, number], strength: number): void {
  if (state.invariants.some((inv) => inv.id === id)) return
  state.invariants.push({
    id,
    position,
    strength,
    dynamic: false,
    energy: 0,
    stability: 1
  })
}

const closureOperator: Operator = (state) => {
  state.globals.energyEnabled = false
  ensureAnchor(state, "B", [-0.5, 0], 1)
  ensureAnchor(state, "Ci", [0.5, 0], 1)
  state.anchors = state.invariants.filter((inv) => !inv.dynamic)
}

const oscillationOperator: Operator = (state) => {
  state.globals.energyEnabled = true
}

const basinDetectionOperator: Operator = (state, _params, dt) => {
  const targetProbes = 260
  const step = Math.max(0.003, dt * 0.6)
  const alpha = 0.3

  while (state.probes.length < targetProbes) {
    state.probes.push(randomProbe(state.globals.seed, state.globals.tick, state.probes.length + 1))
  }

  if (state.probes.length > targetProbes) {
    state.probes.length = targetProbes
  }

  for (let i = 0; i < state.probes.length; i += 1) {
    const p = state.probes[i]
    const gradE = computeEnergyGradient(state, [p.x, p.y])
    const gradD = computeDensityGradient(state, [p.x, p.y])

    p.x += (-gradE[0] - alpha * gradD[0]) * step
    p.y += (-gradE[1] - alpha * gradD[1]) * step

    if (Math.abs(p.x) > DOMAIN || Math.abs(p.y) > DOMAIN) {
      state.probes[i] = randomProbe(state.globals.seed, state.globals.tick, i + 1)
    }
  }

  const clusters = clusterPoints(state.probes, 0.12)
  for (const basin of state.basins) basin.matched = false

  for (let i = 0; i < clusters.length; i += 1) {
    const cluster = clusters[i]
    if (cluster.count < 8) continue

    let best: Basin | undefined
    let bestDistance = Number.POSITIVE_INFINITY

    for (const basin of state.basins) {
      const distance = Math.hypot(cluster.x - basin.x, cluster.y - basin.y)
      if (distance < 0.14 && distance < bestDistance) {
        bestDistance = distance
        best = basin
      }
    }

    if (!best) {
      state.basins.push({
        id: `basin-${state.globals.tick}-${i}`,
        x: cluster.x,
        y: cluster.y,
        count: cluster.count,
        frames: 1,
        matched: true,
        promoted: false
      })
      continue
    }

    best.x = best.x * 0.65 + cluster.x * 0.35
    best.y = best.y * 0.65 + cluster.y * 0.35
    best.count = cluster.count
    best.frames += 1
    best.matched = true
  }

  state.basins = state.basins
    .map((basin) => {
      if (!basin.matched) {
        basin.frames -= 1
        basin.count = 0
      }
      return basin
    })
    .filter((basin) => basin.frames > 0)
}

const emergentPromotionOperator: Operator = (state, params, _dt, context) => {
  for (const basin of state.basins) {
    if (basin.frames < 18) continue
    if (basin.count < 25) continue

    const exists = state.invariants.some(
      (inv) => Math.hypot(inv.position[0] - basin.x, inv.position[1] - basin.y) < 0.1
    )
    if (exists || state.invariants.length >= params.maxInvariants) continue

    const gradE = computeEnergyGradient(state, [basin.x, basin.y])
    const gradD = computeDensityGradient(state, [basin.x, basin.y])
    const gradMag = Math.hypot(gradE[0] + 0.3 * gradD[0], gradE[1] + 0.3 * gradD[1])
    if (gradMag > 0.5) continue

    const id = `dyn-${state.globals.tick}-${state.invariants.length}`
    const created: SimInvariant = {
      id,
      position: [basin.x, basin.y],
      strength: 0.5,
      dynamic: true,
      energy: 0.2,
      stability: 1
    }

    state.invariants.push(created)
    basin.promoted = true
    context.emit(event("PROMOTION", { invariantId: id, relatedIds: [basin.id] }))
    context.emit(event("BIRTH", { invariantId: id, reason: "promoted from persistent basin" }))
  }
}

const competitiveEcosystemOperator: Operator = (state, _params, _dt, context) => {
  const dynamics = dynamicInvariants(state)
  const intakeById: Record<string, number> = {}

  for (const inv of dynamics) {
    intakeById[inv.id] = state.probes.filter(
      (p) => Math.hypot(p.x - inv.position[0], p.y - inv.position[1]) < 0.2
    ).length
  }

  for (let i = 0; i < dynamics.length; i += 1) {
    for (let j = i + 1; j < dynamics.length; j += 1) {
      const invA = dynamics[i]
      const invB = dynamics[j]
      const dist = Math.hypot(invA.position[0] - invB.position[0], invA.position[1] - invB.position[1])
      if (dist >= 0.25) continue

      if (invA.energy >= invB.energy) {
        invB.energy -= 0.02
        context.emit(event("SUPPRESSED", { invariantId: invB.id, relatedIds: [invA.id] }))
      } else {
        invA.energy -= 0.02
        context.emit(event("SUPPRESSED", { invariantId: invA.id, relatedIds: [invB.id] }))
      }
    }
  }

  for (const inv of dynamics) {
    inv.energy += (intakeById[inv.id] ?? 0) * 0.001
    inv.energy -= 0.005
    inv.strength = 0.3 + inv.energy * 2
    inv.stability = Math.max(0, Math.min(1, inv.energy / 0.8))

    if (inv.energy < 0) {
      context.emit(event("STARVATION", { invariantId: inv.id }))
      context.emit(event("DEATH", { invariantId: inv.id, reason: "energy below zero" }))
    }
  }

  state.invariants = state.invariants.filter((inv) => !inv.dynamic || inv.energy >= 0)
}

const selectionPressureOperator: Operator = (state, _params, _dt, context) => {
  const dynamics = dynamicInvariants(state)
  const intakeById: Record<string, number> = {}
  const budget = Math.max(0.05, state.globals.budget)

  for (const inv of dynamics) {
    intakeById[inv.id] = state.probes.filter(
      (p) => Math.hypot(p.x - inv.position[0], p.y - inv.position[1]) < 0.2
    ).length
  }

  const totalIntake = dynamics.reduce((sum, inv) => sum + (intakeById[inv.id] ?? 0), 0)

  for (const inv of dynamics) {
    const share = (intakeById[inv.id] ?? 0) / (totalIntake || 1)
    inv.energy += share * budget
    inv.energy -= 0.005

    const safeEnergy = Math.max(0, inv.energy)
    inv.strength = 1.5 * (safeEnergy / (1 + safeEnergy))
    inv.stability = Math.max(0, Math.min(1, safeEnergy / 0.8))

    if (inv.energy < 0) {
      context.emit(event("DEATH", { invariantId: inv.id, reason: "selection pressure" }))
    }
  }

  state.invariants = state.invariants.filter((inv) => !inv.dynamic || inv.energy >= 0)
}

export const Stage1: StagePreset = {
  id: "stage-1-closure",
  label: "Stage 1 - Closure",
  description: "Base closure law with fixed anchors.",
  colorMode: "grayscale",
  showProbes: false,
  showBasins: false,
  operators: [closureOperator]
}

export const Stage2: StagePreset = {
  id: "stage-2-oscillation",
  label: "Stage 2 - Oscillation",
  description: "Adds oscillating energy field.",
  colorMode: "energy",
  showProbes: false,
  showBasins: false,
  operators: [closureOperator, oscillationOperator]
}

export const Stage3: StagePreset = {
  id: "stage-3-basin-detection",
  label: "Stage 3 - Basin Detection",
  description: "Adds probes and basin detection over oscillation.",
  colorMode: "energy",
  showProbes: true,
  showBasins: true,
  operators: [closureOperator, oscillationOperator, basinDetectionOperator]
}

export const Stage4: StagePreset = {
  id: "stage-4-promotion-ecosystem",
  label: "Stage 4 - Promotion + Ecosystem",
  description: "Promotes persistent basins and introduces local competition.",
  colorMode: "energy",
  showProbes: true,
  showBasins: true,
  operators: [
    closureOperator,
    oscillationOperator,
    basinDetectionOperator,
    emergentPromotionOperator,
    competitiveEcosystemOperator
  ]
}

export const Stage5: StagePreset = {
  id: "stage-5-selection-pressure",
  label: "Stage 5 - Selection Pressure",
  description: "Adds global budget selection on top of local ecosystem dynamics.",
  colorMode: "energy",
  showProbes: true,
  showBasins: true,
  operators: [
    closureOperator,
    oscillationOperator,
    basinDetectionOperator,
    emergentPromotionOperator,
    competitiveEcosystemOperator,
    selectionPressureOperator
  ]
}

export const stagePresets: StagePreset[] = [Stage1, Stage2, Stage3, Stage4, Stage5]

export function getStagePreset(id: string): StagePreset {
  return stagePresets.find((preset) => preset.id === id) ?? Stage5
}
