export type Invariant = {
  id: string
  position: number[]
  strength: number
  dynamic?: boolean
  energy?: number
  stability?: number
}

export type Stage = {
  id: string
  dimensions: number
  invariants: Invariant[]
  densityField: (coords: number[], t: number) => number
  energyField?: (coords: number[], t: number) => number
  colorMode?: "grayscale" | "energy"
  showProbes?: boolean
  showBasins?: boolean
  promoteDynamics?: boolean
  ecosystemMode?: boolean
  globalSelectionMode?: boolean
}

// Stage 0 - Minimal 2D closure
export const Stage0: Stage = {
  id: "stage-0",
  dimensions: 2,
  colorMode: "grayscale",
  showProbes: false,
  showBasins: false,
  promoteDynamics: false,
  ecosystemMode: false,
  globalSelectionMode: false,
  invariants: [
    { id: "B", position: [-0.5, 0], strength: 1 },
    { id: "Ci", position: [0.5, 0], strength: 1 }
  ],
  densityField: (coords) => {
    const [x, y] = coords
    return Math.exp(-(x * x + y * y))
  }
}

// Stage 1B - Oscillating energy field
export const Stage1B: Stage = {
  id: "stage-1B-oscillating-energy",
  dimensions: 2,
  colorMode: "energy",
  showProbes: false,
  showBasins: false,
  promoteDynamics: false,
  ecosystemMode: false,
  globalSelectionMode: false,
  invariants: [
    { id: "B", position: [-0.5, 0], strength: 1 },
    { id: "Ci", position: [0.5, 0], strength: 1 }
  ],
  densityField: (coords) => {
    const [x, y] = coords
    return Math.exp(-(x * x + y * y))
  },
  energyField: (coords, t) => {
    const [x, y] = coords
    const r = Math.sqrt(x * x + y * y)
    const theta = Math.atan2(y, x)

    const radial = Math.sin(6 * r - t * 2) * 0.3
    const angular = Math.cos(3 * theta + t) * 0.2
    const pulse = Math.sin(t * 0.5) * 0.1

    return radial + angular + pulse
  }
}

// Stage 2 - Basin detection and crystallization probes
export const Stage2: Stage = {
  id: "stage-2-basin-detection",
  dimensions: 2,
  colorMode: "energy",
  showProbes: true,
  showBasins: true,
  promoteDynamics: false,
  ecosystemMode: false,
  globalSelectionMode: false,
  invariants: Stage1B.invariants,
  densityField: Stage1B.densityField,
  energyField: Stage1B.energyField
}

// Stage 3 - Emergent invariant promotion
export const Stage3: Stage = {
  id: "stage-3-emergent-invariant-promotion",
  dimensions: 2,
  colorMode: "energy",
  showProbes: true,
  showBasins: true,
  promoteDynamics: true,
  ecosystemMode: false,
  globalSelectionMode: false,
  invariants: Stage1B.invariants,
  densityField: Stage1B.densityField,
  energyField: Stage1B.energyField
}

// Stage 4 - Competitive invariant ecosystem
export const Stage4: Stage = {
  id: "stage-4-competitive-ecosystem",
  dimensions: 2,
  colorMode: "energy",
  showProbes: true,
  showBasins: true,
  promoteDynamics: true,
  ecosystemMode: true,
  globalSelectionMode: false,
  invariants: Stage1B.invariants,
  densityField: Stage1B.densityField,
  energyField: Stage1B.energyField
}

// Stage 5 - Single-species selection pressure
export const Stage5: Stage = {
  id: "stage-5-single-species-selection",
  dimensions: 2,
  colorMode: "energy",
  showProbes: true,
  showBasins: true,
  promoteDynamics: true,
  ecosystemMode: true,
  globalSelectionMode: true,
  invariants: Stage1B.invariants,
  densityField: Stage1B.densityField,
  energyField: Stage1B.energyField
}

// Backward-compatible alias.
export const Stage1 = Stage1B
