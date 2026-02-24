"use client"

import { useEffect, useState } from "react"
import Canvas from "@/components/Canvas"
import HUDAudio from "@/components/HUDAudio"
import HUDMetrics from "@/components/HUDMetrics"
import HUDRegistry from "@/components/HUDRegistry"
import HUDSchema from "@/components/HUDSchema"
import { stagePresets } from "@/lib/operators/stagePresets"
import type { RegistryEntry, SimMetrics } from "@/lib/state/types"

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000)
}

type Telemetry = {
  tick: number
  metrics: SimMetrics
  registryEntries: RegistryEntry[]
  eventCount: number
  anchors: Array<{ id: string; position: [number, number] }>
}

const EMPTY_METRICS: SimMetrics = {
  totalEnergy: 0,
  budget: 0,
  conservedDelta: 0,
  livingInvariants: 0,
  entropySpread: 0,
  dominanceIndex: 0,
  basinOccupancyStability: 0,
  alignmentScore: 0
}

const DEFAULT_SEED = 424242

export default function Home() {
  const selectedPreset = stagePresets[stagePresets.length - 1]
  const [seedInput, setSeedInput] = useState(() => String(DEFAULT_SEED))
  const [activeSeed, setActiveSeed] = useState(DEFAULT_SEED)
  const [telemetry, setTelemetry] = useState<Telemetry>({
    tick: 0,
    metrics: EMPTY_METRICS,
    registryEntries: [],
    eventCount: 0,
    anchors: []
  })

  const anchorSummary =
    telemetry.anchors.length > 0
      ? telemetry.anchors
          .map((anchor) => `${anchor.id}(${anchor.position[0].toFixed(2)}, ${anchor.position[1].toFixed(2)})`)
          .join(" · ")
      : "waiting for telemetry"

  useEffect(() => {
    const nextSeed = randomSeed()
    setSeedInput(String(nextSeed))
    setActiveSeed(nextSeed)
  }, [])

  function applySeedFromInput() {
    const parsed = Number.parseInt(seedInput, 10)
    if (!Number.isFinite(parsed)) return
    setActiveSeed(parsed)
  }

  async function copySeed() {
    try {
      await navigator.clipboard.writeText(String(activeSeed))
    } catch {
      // Clipboard can be unavailable in some browser contexts.
    }
  }

  return (
    <main className="shell">
      <div className="center-logo-wrap" aria-hidden="true">
        <img src="center-logo.svg" alt="" className="center-logo" />
      </div>
      <aside className="bottom-dock">
        <details className="panel-drop">
          <summary>Constitution</summary>
          <div className="drop-content">
            <p className="description">
              Active Constitution: <strong>ØVEL x Void Architecture</strong>
            </p>
            <p className="description">Invariant: ØVEL</p>

            <label>
              Seed (record/replay)
              <input
                value={seedInput}
                onChange={(event) => setSeedInput(event.target.value)}
                inputMode="numeric"
                aria-label="Simulation seed"
              />
            </label>

            <div className="button-row">
              <button type="button" onClick={applySeedFromInput}>
                Apply Seed
              </button>
              <button type="button" onClick={copySeed}>
                Copy Active Seed
              </button>
            </div>

            <HUDAudio
              telemetry={{
                tick: telemetry.tick,
                metrics: telemetry.metrics,
                eventCount: telemetry.eventCount
              }}
            />

            <p className="active-seed">Active Seed: {activeSeed}</p>
            <p className="active-seed">Tick: {telemetry.tick}</p>
            <p className="active-seed">Events this frame: {telemetry.eventCount}</p>
            <p className="active-seed">Anchor Lattice: {telemetry.anchors.length} fixed anchors (configured set)</p>
            <p className="active-seed">Anchor Map: {anchorSummary}</p>
          </div>
        </details>

        <details className="panel-drop panel-registry">
          <summary>Registry</summary>
          <div className="drop-content">
            <HUDRegistry entries={telemetry.registryEntries} tick={telemetry.tick} />
          </div>
        </details>

        <details className="panel-drop">
          <summary>Legend</summary>
          <div className="drop-content">
            <HUDSchema />
          </div>
        </details>

        <details className="panel-drop">
          <summary>Metrics</summary>
          <div className="drop-content">
            <HUDMetrics metrics={telemetry.metrics} />
          </div>
        </details>
      </aside>
      <Canvas preset={selectedPreset} seed={activeSeed} showOriginConnections onTelemetry={setTelemetry} />
    </main>
  )
}
