import type { SimMetrics } from "@/lib/state/types"
import { evaluateAlignment, type AlignmentLevel } from "@/lib/alignment/controller"

type Props = {
  metrics: SimMetrics
}

function fmt(value: number, digits = 3): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "nan"
}

type MetricLevel = AlignmentLevel

function levelForConservedDelta(value: number): MetricLevel {
  const delta = Math.abs(value)
  if (delta < 0.12) return "good"
  if (delta < 0.5) return "warn"
  return "critical"
}

function levelForLivingInvariants(value: number): MetricLevel {
  if (value >= 4) return "good"
  if (value >= 2) return "warn"
  return "critical"
}

function levelForEntropy(value: number): MetricLevel {
  if (value >= 0.55) return "good"
  if (value >= 0.3) return "warn"
  return "critical"
}

function levelForDominance(value: number): MetricLevel {
  if (value <= 0.6) return "good"
  if (value <= 0.82) return "warn"
  return "critical"
}

function levelForBasinStability(value: number): MetricLevel {
  if (value >= 0.65) return "good"
  if (value >= 0.35) return "warn"
  return "critical"
}

function Item({
  label,
  value,
  level
}: {
  label: string
  value: string | number
  level: MetricLevel
}) {
  return (
    <li className={`metric-item metric-${level}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </li>
  )
}

export default function HUDMetrics({ metrics }: Props) {
  const alignment = evaluateAlignment(metrics)

  function statusClass(level: MetricLevel): string {
    return `status-badge metric-${level}`
  }

  return (
    <section className="hud-panel">
      <h3>Metrics</h3>
      <ul className="metric-list">
        <Item
          label="Alignment Score"
          value={metrics.alignmentScore.toFixed(3)}
          level={alignment.overall}
        />
        <Item label="Total Energy" value={fmt(metrics.totalEnergy)} level="good" />
        <Item label="Budget" value={fmt(metrics.budget)} level="good" />
        <Item
          label="Conserved Delta"
          value={fmt(metrics.conservedDelta)}
          level={levelForConservedDelta(metrics.conservedDelta)}
        />
        <Item
          label="Living Invariants"
          value={metrics.livingInvariants}
          level={levelForLivingInvariants(metrics.livingInvariants)}
        />
        <Item
          label="Entropy Spread"
          value={fmt(metrics.entropySpread)}
          level={levelForEntropy(metrics.entropySpread)}
        />
        <Item
          label="Dominance (top-k)"
          value={fmt(metrics.dominanceIndex)}
          level={levelForDominance(metrics.dominanceIndex)}
        />
        <Item
          label="Basin Stability"
          value={fmt(metrics.basinOccupancyStability)}
          level={levelForBasinStability(metrics.basinOccupancyStability)}
        />
      </ul>
      <div className="alignment-statuses">
        <span className={statusClass(alignment.conservedDelta)}>delta: {alignment.conservedDelta}</span>
        <span className={statusClass(alignment.dominance)}>dominance: {alignment.dominance}</span>
        <span className={statusClass(alignment.entropy)}>entropy: {alignment.entropy}</span>
      </div>
    </section>
  )
}
