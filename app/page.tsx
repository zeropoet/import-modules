"use client"

import { useMemo, useState } from "react"
import Canvas from "@/components/Canvas"
import { Stage, Stage0, Stage1B, Stage2, Stage3, Stage4, Stage5 } from "@/lib/stage"

export default function Home() {
  const stages = useMemo(
    () =>
      [
        { id: Stage0.id, label: "Stage 0 - Closure", stage: Stage0 },
        { id: Stage1B.id, label: "Stage 1B - Oscillating Energy", stage: Stage1B },
        { id: Stage2.id, label: "Stage 2 - Basin Detection", stage: Stage2 },
        { id: Stage3.id, label: "Stage 3 - Emergent Promotion", stage: Stage3 },
        { id: Stage4.id, label: "Stage 4 - Competitive Ecosystem", stage: Stage4 },
        { id: Stage5.id, label: "Stage 5 - Selection Pressure", stage: Stage5 }
      ] satisfies Array<{ id: string; label: string; stage: Stage }>,
    []
  )
  const [selectedStageId, setSelectedStageId] = useState<string>(Stage5.id)
  const selectedStage = stages.find((entry) => entry.id === selectedStageId)?.stage ?? Stage5

  return (
    <main style={{ width: "100vw", height: "100vh", overflow: "hidden" }}>
      <div style={{ position: "fixed", top: 12, left: 12, zIndex: 10 }}>
        <select
          aria-label="Select stage"
          value={selectedStageId}
          onChange={(event) => setSelectedStageId(event.target.value)}
        >
          {stages.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </select>
      </div>
      <Canvas stage={selectedStage} />
    </main>
  )
}
