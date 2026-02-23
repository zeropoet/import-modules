import type { SimMetrics } from "@/lib/state/types"

type Props = {
  metrics: SimMetrics
}

function fmt(value: number, digits = 3): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "nan"
}

export default function HUDMetrics({ metrics }: Props) {
  return (
    <section className="hud-panel">
      <h3>Metrics</h3>
      <ul>
        <li>Total Energy: {fmt(metrics.totalEnergy)}</li>
        <li>Budget: {fmt(metrics.budget)}</li>
        <li>Conserved Delta: {fmt(metrics.conservedDelta)}</li>
        <li>Living Invariants: {metrics.livingInvariants}</li>
        <li>Entropy Spread: {fmt(metrics.entropySpread)}</li>
        <li>Dominance (top-k): {fmt(metrics.dominanceIndex)}</li>
        <li>Basin Stability: {fmt(metrics.basinOccupancyStability)}</li>
      </ul>
    </section>
  )
}
