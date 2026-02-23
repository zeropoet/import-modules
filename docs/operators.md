# Operators

Operators are formal laws that transform `SimState` per tick.

## Contract
- Signature: `(state, params, dt, context) => void | state`
- Input: canonical `SimState`
- Output: same state mutated in a controlled pattern (or replacement state)
- Emission: operators can emit lifecycle events via `context.emit`

## Invariants
- Domain bounded to `globals.domainRadius`
- Budget finite and non-negative
- No NaNs in invariant energy/strength/stability
- Constitution hash unchanged at runtime

## Composition
Use `compose(operators)` from `lib/operators/compose.ts` to create a single `step` function.
