import type { Operator, OperatorContext, OperatorParams } from "@/lib/operators/types"
import type { SimState } from "@/lib/state/types"

export type StepFn = (state: SimState, params: OperatorParams, dt: number, context: OperatorContext) => SimState

export function compose(operators: Operator[]): StepFn {
  return (state, params, dt, context) => {
    let nextState = state

    for (const operator of operators) {
      const result = operator(nextState, params, dt, context)
      if (result) nextState = result
    }

    return nextState
  }
}
