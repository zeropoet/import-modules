import type { SimState } from "@/lib/state/types"

export type ConstraintViolation = {
  code: string
  message: string
}

export function validateState(state: SimState, expectedConstitutionHash: string): ConstraintViolation[] {
  const issues: ConstraintViolation[] = []

  for (const inv of state.invariants) {
    if (Math.abs(inv.position[0]) > state.globals.domainRadius || Math.abs(inv.position[1]) > state.globals.domainRadius) {
      issues.push({ code: "BOUNDED_DOMAIN", message: `Invariant ${inv.id} escaped bounded domain` })
    }

    if (!Number.isFinite(inv.energy) || !Number.isFinite(inv.strength) || !Number.isFinite(inv.stability)) {
      issues.push({ code: "FINITE_VALUES", message: `Invariant ${inv.id} has non-finite numeric values` })
    }
  }

  if (!Number.isFinite(state.globals.budget) || state.globals.budget < 0) {
    issues.push({ code: "FINITE_BUDGET", message: "Global budget must be finite and non-negative" })
  }

  if (state.globals.constitutionHash !== expectedConstitutionHash) {
    issues.push({ code: "CONSTITUTION_IMMUTABLE", message: "Constitution changed during runtime" })
  }

  return issues
}
