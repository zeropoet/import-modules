import type { SimEvent } from "@/lib/events/types"

export type Vec2 = [number, number]

export type FieldFns = {
  density: (coords: Vec2, t: number) => number
  energy: (coords: Vec2, t: number) => number
}

export type ProbeParticle = {
  x: number
  y: number
}

export type Basin = {
  id: string
  x: number
  y: number
  count: number
  frames: number
  matched: boolean
  promoted: boolean
}

export type SimInvariant = {
  id: string
  position: Vec2
  strength: number
  dynamic: boolean
  energy: number
  stability: number
}

export type RegistryEntry = {
  id: string
  birthTick: number
  deathTick?: number
  lineageParentIds: string[]
  energyHistory: number[]
  positionHistory: Vec2[]
  peakStrength: number
  kills: number
  territoryWins: number
}

export type InvariantRegistry = {
  entries: Record<string, RegistryEntry>
}

export type SimMetrics = {
  totalEnergy: number
  budget: number
  conservedDelta: number
  livingInvariants: number
  entropySpread: number
  dominanceIndex: number
  basinOccupancyStability: number
}

export type SimGlobals = {
  tick: number
  time: number
  seed: number
  budget: number
  domainRadius: number
  constitutionHash: string
  energyEnabled: boolean
}

export type SimState = {
  anchors: SimInvariant[]
  invariants: SimInvariant[]
  fields: FieldFns
  probes: ProbeParticle[]
  basins: Basin[]
  globals: SimGlobals
  registry: InvariantRegistry
  events: SimEvent[]
  metrics: SimMetrics
}
