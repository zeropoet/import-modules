import type { SimEvent, SimEventType } from "@/lib/events/types"
import type { SimState } from "@/lib/state/types"

export type OperatorParams = {
  presetId: string
  maxInvariants: number
}

export type OperatorContext = {
  emit: (event: Omit<SimEvent, "tick">) => void
}

export type Operator = (
  state: SimState,
  params: OperatorParams,
  dt: number,
  context: OperatorContext
) => void | SimState

export type StagePreset = {
  id: string
  label: string
  description: string
  colorMode: "grayscale" | "energy"
  showProbes: boolean
  showBasins: boolean
  operators: Operator[]
}

export function event(type: SimEventType, partial: Omit<SimEvent, "type" | "tick"> = {}): Omit<SimEvent, "tick"> {
  return { type, ...partial }
}
