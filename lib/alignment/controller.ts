import type { SimMetrics } from "@/lib/state/types"

export type AlignmentLevel = "good" | "warn" | "critical"

export type AlignmentDiagnostics = {
  score: number
  overall: AlignmentLevel
  conservedDelta: AlignmentLevel
  dominance: AlignmentLevel
  entropy: AlignmentLevel
}

export type AlignmentControl = {
  budgetGainScale: number
  deadbandScale: number
  dominanceTarget: number
  dominancePenalty: number
  equityBoost: number
}

function points(level: AlignmentLevel): number {
  if (level === "good") return 1
  if (level === "warn") return 0.5
  return 0
}

function classifyConservedDelta(delta: number): AlignmentLevel {
  const abs = Math.abs(delta)
  if (abs <= 0.1) return "good"
  if (abs <= 0.4) return "warn"
  return "critical"
}

function classifyDominance(dominance: number): AlignmentLevel {
  if (dominance >= 0.45 && dominance <= 0.65) return "good"
  if (dominance >= 0.35 && dominance <= 0.8) return "warn"
  return "critical"
}

function classifyEntropy(entropy: number): AlignmentLevel {
  if (entropy >= 0.5) return "good"
  if (entropy >= 0.35) return "warn"
  return "critical"
}

function overallLevel(score: number): AlignmentLevel {
  if (score >= 0.8) return "good"
  if (score >= 0.45) return "warn"
  return "critical"
}

export function evaluateAlignment(metrics: SimMetrics): AlignmentDiagnostics {
  const conservedDelta = classifyConservedDelta(metrics.conservedDelta)
  const dominance = classifyDominance(metrics.dominanceIndex)
  const entropy = classifyEntropy(metrics.entropySpread)

  const score = (points(conservedDelta) + points(dominance) + points(entropy)) / 3

  return {
    score,
    overall: overallLevel(score),
    conservedDelta,
    dominance,
    entropy
  }
}

export function deriveAlignmentControl(diagnostics: AlignmentDiagnostics): AlignmentControl {
  const budgetGainScale =
    diagnostics.conservedDelta === "critical" ? 1.65 : diagnostics.conservedDelta === "warn" ? 1.25 : 1

  const deadbandScale = diagnostics.conservedDelta === "good" ? 1.2 : 0.9

  const dominancePenalty =
    diagnostics.dominance === "critical" ? 0.14 : diagnostics.dominance === "warn" ? 0.08 : 0.04

  const equityBoost =
    diagnostics.entropy === "critical" || diagnostics.dominance === "critical"
      ? 0.8
      : diagnostics.entropy === "warn" || diagnostics.dominance === "warn"
        ? 0.55
        : 0.35

  return {
    budgetGainScale,
    deadbandScale,
    dominanceTarget: 0.6,
    dominancePenalty,
    equityBoost
  }
}
