import { event, type Operator, type StagePreset } from "@/lib/operators/types"
import type { Basin, ProbeParticle, SimInvariant, SimState } from "@/lib/state/types"
import { clusterPoints, computeDensityGradient, computeEnergyGradient, dynamicInvariants } from "@/lib/sim/math"
import { computeMetrics } from "@/lib/metrics"
import { deriveAlignmentControl, evaluateAlignment } from "@/lib/alignment/controller"

const DOMAIN = 1
const MAX_PROBE_TRAIL_POINTS = 20
const RESPAWN_RADIUS_PX = 100

function seededUnit(seed: number, salt: number): number {
  const x = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453
  return x - Math.floor(x)
}

function randomProbe(state: SimState, salt: number): ProbeParticle {
  const viewportMin = Math.max(1, state.globals.viewportMinPx)
  const respawnRadiusWorld = Math.min(DOMAIN, (RESPAWN_RADIUS_PX * 2) / viewportMin)
  const radius =
    Math.sqrt(seededUnit(state.globals.seed, state.globals.tick * 131 + salt * 29)) *
    respawnRadiusWorld
  const theta = seededUnit(state.globals.seed, state.globals.tick * 149 + salt * 31) * Math.PI * 2
  const px = Math.cos(theta) * radius
  const py = Math.sin(theta) * radius
  return {
    x: px,
    y: py,
    prevX: px,
    prevY: py,
    speed: 0,
    age: 0,
    trail: [[px, py]]
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
  const targetProbes = 222
  const step = Math.max(0.003, dt * 0.6)
  const alpha = 0.3

  while (state.probes.length < targetProbes) {
    state.probes.push(randomProbe(state, state.probes.length + 1))
  }

  if (state.probes.length > targetProbes) {
    state.probes.length = targetProbes
  }

  for (let i = 0; i < state.probes.length; i += 1) {
    const p = state.probes[i]
    p.prevX = p.x
    p.prevY = p.y
    const gradE = computeEnergyGradient(state, [p.x, p.y])
    const gradD = computeDensityGradient(state, [p.x, p.y])

    p.x += (-gradE[0] - alpha * gradD[0]) * step
    p.y += (-gradE[1] - alpha * gradD[1]) * step
    p.speed = Math.hypot(p.x - p.prevX, p.y - p.prevY)
    p.age += 1
    p.trail.push([p.x, p.y])
    if (p.trail.length > MAX_PROBE_TRAIL_POINTS) p.trail.shift()

    if (Math.abs(p.x) > DOMAIN || Math.abs(p.y) > DOMAIN) {
      state.probes[i] = randomProbe(state, i + 1)
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
    if (basin.frames < 10) continue
    if (basin.count < 10) continue

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
      energy: 0.35,
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
      (p) => Math.hypot(p.x - inv.position[0], p.y - inv.position[1]) < 0.3
    ).length
  }

  for (let i = 0; i < dynamics.length; i += 1) {
    for (let j = i + 1; j < dynamics.length; j += 1) {
      const invA = dynamics[i]
      const invB = dynamics[j]
      const dist = Math.hypot(invA.position[0] - invB.position[0], invA.position[1] - invB.position[1])
      if (dist >= 0.25) continue

      if (invA.energy >= invB.energy) {
        invB.energy -= 0.008
        context.emit(event("SUPPRESSED", { invariantId: invB.id, relatedIds: [invA.id] }))
      } else {
        invA.energy -= 0.008
        context.emit(event("SUPPRESSED", { invariantId: invA.id, relatedIds: [invB.id] }))
      }
    }
  }

  for (const inv of dynamics) {
    inv.energy += (intakeById[inv.id] ?? 0) * 0.001
    inv.energy -= 0.002
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
      (p) => Math.hypot(p.x - inv.position[0], p.y - inv.position[1]) < 0.3
    ).length
  }

  const totalIntake = dynamics.reduce((sum, inv) => sum + (intakeById[inv.id] ?? 0), 0)
  const equalShare = dynamics.length > 0 ? 1 / dynamics.length : 0

  for (const inv of dynamics) {
    const intakeShare = (intakeById[inv.id] ?? 0) / (totalIntake || 1)
    const share = 0.7 * intakeShare + 0.3 * equalShare
    inv.energy += share * budget
    inv.energy -= 0.002

    const safeEnergy = Math.max(0, inv.energy)
    inv.strength = 1.5 * (safeEnergy / (1 + safeEnergy))
    inv.stability = Math.max(0, Math.min(1, safeEnergy / 0.8))

    if (inv.energy < 0) {
      context.emit(event("DEATH", { invariantId: inv.id, reason: "selection pressure" }))
    }
  }

  const totalStrength = dynamics.reduce((sum, inv) => sum + Math.max(0, inv.strength), 0)
  for (const inv of dynamics) {
    const dominanceShare = totalStrength > 1e-6 ? Math.max(0, inv.strength) / totalStrength : 0
    if (dominanceShare > 0.45) {
      inv.energy = Math.max(0, inv.energy - (dominanceShare - 0.45) * 0.08)
    }
  }

  state.invariants = state.invariants.filter((inv) => !inv.dynamic || inv.energy >= 0)
}

const budgetRegulatorOperator: Operator = (state, _params, dt) => {
  const dynamics = dynamicInvariants(state)
  if (dynamics.length === 0) return

  const totalEnergy = dynamics.reduce((sum, inv) => sum + Math.max(0, inv.energy), 0)
  const metrics = computeMetrics(state)
  const alignment = evaluateAlignment(metrics)
  const controlProfile = deriveAlignmentControl(alignment)

  const error = totalEnergy - state.globals.budget
  const EPSILON = 0.02 * controlProfile.deadbandScale
  const KP = 0.2 * controlProfile.budgetGainScale
  const KI = 0.03 * controlProfile.budgetGainScale

  if (Math.abs(error) < EPSILON) {
    state.globals.regulatorIntegral *= 0.96
    return
  }

  state.globals.regulatorIntegral += error * dt
  state.globals.regulatorIntegral = Math.max(-50, Math.min(50, state.globals.regulatorIntegral))
  const control = KP * error + KI * state.globals.regulatorIntegral
  const fallbackShare = 1 / dynamics.length

  const inverseTotal = dynamics.reduce(
    (sum, candidate) => sum + 1 / (Math.max(0.01, candidate.energy) + 0.05),
    0
  )

  for (const inv of dynamics) {
    const removalShare = totalEnergy > 1e-6 ? Math.max(0, inv.energy) / totalEnergy : fallbackShare
    const inverseWeight = 1 / (Math.max(0.01, inv.energy) + 0.05)
    const inverseShare = inverseTotal > 1e-6 ? inverseWeight / inverseTotal : fallbackShare
    const additionShare = inverseShare * controlProfile.equityBoost + fallbackShare * (1 - controlProfile.equityBoost)

    if (control >= 0) {
      inv.energy = Math.max(0, inv.energy - control * removalShare)
    } else {
      inv.energy = Math.max(0, inv.energy - control * additionShare)
    }
    inv.strength = 1.5 * (inv.energy / (1 + inv.energy))
    inv.stability = Math.max(0, Math.min(1, inv.energy / 0.8))
  }

  const totalStrength = dynamics.reduce((sum, inv) => sum + Math.max(0, inv.strength), 0)
  for (const inv of dynamics) {
    const dominanceShare = totalStrength > 1e-6 ? Math.max(0, inv.strength) / totalStrength : 0
    if (dominanceShare <= controlProfile.dominanceTarget) continue
    inv.energy = Math.max(
      0,
      inv.energy - (dominanceShare - controlProfile.dominanceTarget) * controlProfile.dominancePenalty
    )
  }
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
    selectionPressureOperator,
    budgetRegulatorOperator
  ]
}

export const stagePresets: StagePreset[] = [Stage1, Stage2, Stage3, Stage4, Stage5]

export function getStagePreset(id: string): StagePreset {
  return stagePresets.find((preset) => preset.id === id) ?? Stage5
}
