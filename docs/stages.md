# Stages

Each stage is now a composition of operators. The simulation state is continuous while stage selection only swaps the active operator list.

## Stage 1
- Operators: `closure`
- New law introduced: anchor closure only.

## Stage 2
- Operators: `closure`, `oscillation`
- New law introduced: oscillating energy field.

## Stage 3
- Operators: `closure`, `oscillation`, `basinDetection`
- New law introduced: probe advection + basin detection.

## Stage 4
- Operators: `closure`, `oscillation`, `basinDetection`, `emergentPromotion`, `competitiveEcosystem`
- New law introduced: promotion and local competition.

## Stage 5
- Operators: `closure`, `oscillation`, `basinDetection`, `emergentPromotion`, `competitiveEcosystem`, `selectionPressure`
- New law introduced: global budget selection pressure.

## Stage 6 Foundation
Stage 6 is no longer a view-level toggle. It should be introduced by adding a new operator or changing composition rules in `lib/operators/stagePresets.ts`.
