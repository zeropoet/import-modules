"use client"

import { useEffect, useState } from "react"
import Canvas from "@/components/Canvas"
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
}

const EMPTY_METRICS: SimMetrics = {
  totalEnergy: 0,
  budget: 0,
  conservedDelta: 0,
  livingInvariants: 0,
  entropySpread: 0,
  dominanceIndex: 0,
  basinOccupancyStability: 0
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
    eventCount: 0
  })

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
      <div className="panel control-panel">
        <h2>Constitutional Field</h2>
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

        <p className="active-seed">Active Seed: {activeSeed}</p>
        <p className="active-seed">Tick: {telemetry.tick}</p>
        <p className="active-seed">Events this frame: {telemetry.eventCount}</p>
      </div>

      <div className="hud-right">
        <HUDSchema />
        <HUDMetrics metrics={telemetry.metrics} />
        <HUDRegistry entries={telemetry.registryEntries} tick={telemetry.tick} />
      </div>

      <Canvas preset={selectedPreset} seed={activeSeed} onTelemetry={setTelemetry} />
    </main>
  )
}
