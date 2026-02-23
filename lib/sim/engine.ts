import { validateState } from "@/lib/constraints/validate"
import { createRegistry, registerBirth, registerDeath, registerWin, sampleInvariant } from "@/lib/invariants/registry"
import { computeMetrics } from "@/lib/metrics"
import { compose } from "@/lib/operators/compose"
import type { StagePreset } from "@/lib/operators/types"
import type { SimEvent } from "@/lib/events/types"
import type { SimState, SimInvariant } from "@/lib/state/types"

export const CONSTITUTION_HASH = "constitutional-field-v2"

function baseFields() {
  return {
    density: ([x, y]: [number, number]) => Math.exp(-(x * x + y * y)),
    energy: ([x, y]: [number, number], t: number) => {
      const r = Math.sqrt(x * x + y * y)
      const theta = Math.atan2(y, x)

      const radial = Math.sin(6 * r - t * 2) * 0.3
      const angular = Math.cos(3 * theta + t) * 0.2
      const pulse = Math.sin(t * 0.5) * 0.1

      return radial + angular + pulse
    }
  }
}

function createAnchor(id: string, position: [number, number]): SimInvariant {
  return {
    id,
    position,
    strength: 1,
    dynamic: false,
    energy: 0,
    stability: 1
  }
}

export function createSimulationState(seed: number): SimState {
  const anchors = [createAnchor("B", [-0.5, 0]), createAnchor("Ci", [0.5, 0])]
  const registry = createRegistry()

  const state: SimState = {
    anchors,
    invariants: [...anchors],
    fields: baseFields(),
    probes: [],
    basins: [],
    globals: {
      tick: 0,
      time: 0,
      seed,
      budget: 0.3,
      domainRadius: 1,
      constitutionHash: CONSTITUTION_HASH,
      energyEnabled: false
    },
    registry,
    events: [],
    metrics: {
      totalEnergy: 0,
      budget: 0.3,
      conservedDelta: -0.3,
      livingInvariants: 0,
      entropySpread: 0,
      dominanceIndex: 0,
      basinOccupancyStability: 0
    }
  }

  for (const anchor of anchors) {
    registerBirth(registry, anchor, 0, [])
  }

  return state
}

function applyEventsToRegistry(state: SimState): void {
  for (const evt of state.events) {
    if (evt.type === "BIRTH" || evt.type === "PROMOTION") {
      const inv = state.invariants.find((candidate) => candidate.id === evt.invariantId)
      if (!inv) continue
      registerBirth(state.registry, inv, evt.tick, evt.relatedIds ?? [])
      continue
    }

    if (evt.type === "DEATH" || evt.type === "STARVATION") {
      if (!evt.invariantId) continue
      registerDeath(state.registry, evt.invariantId, evt.tick)
      continue
    }

    if (evt.type === "SUPPRESSED") {
      const winner = evt.relatedIds?.[0]
      if (winner) registerWin(state.registry, winner)
    }
  }
}

export function stepSimulation(state: SimState, preset: StagePreset, dt: number): SimState {
  state.events = []
  state.globals.tick += 1
  state.globals.time += dt

  const step = compose(preset.operators)
  step(
    state,
    { presetId: preset.id, maxInvariants: 150 },
    dt,
    {
      emit: (partialEvent) => {
        const event: SimEvent = { tick: state.globals.tick, ...partialEvent }
        state.events.push(event)
      }
    }
  )

  state.anchors = state.invariants.filter((inv) => !inv.dynamic)

  for (const inv of state.invariants) {
    sampleInvariant(state.registry, inv)
  }

  applyEventsToRegistry(state)
  state.metrics = computeMetrics(state)

  const violations = validateState(state, CONSTITUTION_HASH)
  if (violations.length > 0) {
    state.events.push({
      type: "SUPPRESSED",
      tick: state.globals.tick,
      reason: violations.map((issue) => issue.code).join(",")
    })
  }

  return state
}
