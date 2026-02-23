"use client"

import { useEffect, useMemo, useRef, useState } from "react"
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

type PanelId = "constitution" | "metrics" | "registry" | "legend"

type PanelPosition = {
  x: number
  y: number
}

type DragState = {
  id: PanelId
  pointerStartX: number
  pointerStartY: number
  originX: number
  originY: number
  width: number
  height: number
  moved: boolean
}

const PANEL_IDS: PanelId[] = ["constitution", "metrics", "registry", "legend"]
const PANEL_MARGIN = 14
const SNAP_DISTANCE = 18
const PANEL_GAP = 10
const DEFAULT_SEED = 424242

const INITIAL_POSITIONS: Record<PanelId, PanelPosition> = {
  constitution: { x: 18, y: 18 },
  registry: { x: 18, y: 280 },
  legend: { x: 520, y: 18 },
  metrics: { x: 520, y: 280 }
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

function clampPosition(x: number, y: number, width: number, height: number): PanelPosition {
  const maxX = window.innerWidth - width - PANEL_MARGIN
  const maxY = window.innerHeight - height - PANEL_MARGIN
  return {
    x: Math.max(PANEL_MARGIN, Math.min(maxX, x)),
    y: Math.max(PANEL_MARGIN, Math.min(maxY, y))
  }
}

function overlaps(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 && b0 < a1
}

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
  const [positions, setPositions] = useState<Record<PanelId, PanelPosition>>(INITIAL_POSITIONS)
  const [openPanels, setOpenPanels] = useState<Record<PanelId, boolean>>({
    constitution: true,
    metrics: true,
    registry: true,
    legend: false
  })
  const [dragState, setDragState] = useState<DragState | null>(null)

  const panelRefs = useRef<Record<PanelId, HTMLDivElement | null>>({
    constitution: null,
    metrics: null,
    registry: null,
    legend: null
  })
  const suppressedToggleRef = useRef<PanelId | null>(null)

  useEffect(() => {
    const nextSeed = randomSeed()
    setSeedInput(String(nextSeed))
    setActiveSeed(nextSeed)
  }, [])

  useEffect(() => {
    const rafId = window.requestAnimationFrame(() => {
      const constitutionRect = panelRefs.current.constitution?.getBoundingClientRect()
      const registryRect = panelRefs.current.registry?.getBoundingClientRect()
      const legendRect = panelRefs.current.legend?.getBoundingClientRect()
      const metricsRect = panelRefs.current.metrics?.getBoundingClientRect()

      const constitutionWidth = constitutionRect?.width ?? 380
      const legendWidth = legendRect?.width ?? 380
      const leftX = PANEL_MARGIN
      const rightX = Math.max(PANEL_MARGIN, window.innerWidth - legendWidth - PANEL_MARGIN)

      const constitutionY = PANEL_MARGIN
      const registryY = constitutionY + (constitutionRect?.height ?? 220) + PANEL_GAP
      const legendY = PANEL_MARGIN
      const metricsY = legendY + (legendRect?.height ?? 170) + PANEL_GAP

      const leftConstitution = clampPosition(leftX, constitutionY, constitutionWidth, constitutionRect?.height ?? 220)
      const leftRegistry = clampPosition(leftX, registryY, registryRect?.width ?? constitutionWidth, registryRect?.height ?? 220)
      const rightLegend = clampPosition(rightX, legendY, legendWidth, legendRect?.height ?? 170)
      const rightMetrics = clampPosition(rightX, metricsY, metricsRect?.width ?? legendWidth, metricsRect?.height ?? 220)

      setPositions({
        constitution: leftConstitution,
        registry: leftRegistry,
        legend: rightLegend,
        metrics: rightMetrics
      })
    })

    return () => window.cancelAnimationFrame(rafId)
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

  function beginDrag(id: PanelId, event: React.PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return

    const panel = panelRefs.current[id]
    if (!panel) return
    const rect = panel.getBoundingClientRect()
    const origin = positions[id]

    setDragState({
      id,
      pointerStartX: event.clientX,
      pointerStartY: event.clientY,
      originX: origin.x,
      originY: origin.y,
      width: rect.width,
      height: rect.height,
      moved: false
    })

    event.preventDefault()
  }

  function togglePanel(id: PanelId) {
    if (suppressedToggleRef.current === id) {
      suppressedToggleRef.current = null
      return
    }

    setOpenPanels((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  useEffect(() => {
    if (!dragState) return
    const activeDrag = dragState

    function applySnapping(id: PanelId, x: number, y: number, width: number, height: number): PanelPosition {
      let nextX = x
      let nextY = y

      if (Math.abs(nextX - PANEL_MARGIN) < SNAP_DISTANCE) nextX = PANEL_MARGIN
      if (Math.abs(nextY - PANEL_MARGIN) < SNAP_DISTANCE) nextY = PANEL_MARGIN

      const rightEdge = window.innerWidth - width - PANEL_MARGIN
      const bottomEdge = window.innerHeight - height - PANEL_MARGIN
      if (Math.abs(nextX - rightEdge) < SNAP_DISTANCE) nextX = rightEdge
      if (Math.abs(nextY - bottomEdge) < SNAP_DISTANCE) nextY = bottomEdge

      const rectA = { x: nextX, y: nextY, w: width, h: height }

      for (const otherId of PANEL_IDS) {
        if (otherId === id) continue
        const ref = panelRefs.current[otherId]
        if (!ref) continue

        const otherRect = ref.getBoundingClientRect()
        const otherPos = positions[otherId]
        const rectB = { x: otherPos.x, y: otherPos.y, w: otherRect.width, h: otherRect.height }

        const verticalOverlap = overlaps(rectA.y, rectA.y + rectA.h, rectB.y, rectB.y + rectB.h)
        if (verticalOverlap) {
          if (Math.abs(rectA.x - rectB.x) < SNAP_DISTANCE) nextX = rectB.x
          if (Math.abs(rectA.x + rectA.w - (rectB.x + rectB.w)) < SNAP_DISTANCE) nextX = rectB.x + rectB.w - rectA.w
          if (Math.abs(rectA.x - (rectB.x + rectB.w + PANEL_GAP)) < SNAP_DISTANCE) nextX = rectB.x + rectB.w + PANEL_GAP
          if (Math.abs(rectA.x + rectA.w + PANEL_GAP - rectB.x) < SNAP_DISTANCE) nextX = rectB.x - rectA.w - PANEL_GAP
        }

        const horizontalOverlap = overlaps(rectA.x, rectA.x + rectA.w, rectB.x, rectB.x + rectB.w)
        if (horizontalOverlap) {
          if (Math.abs(rectA.y - rectB.y) < SNAP_DISTANCE) nextY = rectB.y
          if (Math.abs(rectA.y - (rectB.y + rectB.h + PANEL_GAP)) < SNAP_DISTANCE) nextY = rectB.y + rectB.h + PANEL_GAP
          if (Math.abs(rectA.y + rectA.h + PANEL_GAP - rectB.y) < SNAP_DISTANCE) nextY = rectB.y - rectA.h - PANEL_GAP
        }
      }

      return clampPosition(nextX, nextY, width, height)
    }

    function onPointerMove(event: PointerEvent) {
      setPositions((prev) => {
        const dx = event.clientX - activeDrag.pointerStartX
        const dy = event.clientY - activeDrag.pointerStartY

        const rawX = activeDrag.originX + dx
        const rawY = activeDrag.originY + dy
        const clamped = clampPosition(rawX, rawY, activeDrag.width, activeDrag.height)
        const snapped = applySnapping(
          activeDrag.id,
          clamped.x,
          clamped.y,
          activeDrag.width,
          activeDrag.height
        )

        if (!activeDrag.moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
          setDragState((current) => (current ? { ...current, moved: true } : current))
        }

        return { ...prev, [activeDrag.id]: snapped }
      })
    }

    function onPointerUp() {
      if (activeDrag.moved) suppressedToggleRef.current = activeDrag.id
      setDragState(null)
    }

    window.addEventListener("pointermove", onPointerMove)
    window.addEventListener("pointerup", onPointerUp, { once: true })

    return () => {
      window.removeEventListener("pointermove", onPointerMove)
      window.removeEventListener("pointerup", onPointerUp)
    }
  }, [dragState, positions])

  useEffect(() => {
    function onResize() {
      setPositions((prev) => {
        const next = { ...prev }
        for (const id of PANEL_IDS) {
          const panel = panelRefs.current[id]
          if (!panel) continue
          const rect = panel.getBoundingClientRect()
          next[id] = clampPosition(prev[id].x, prev[id].y, rect.width, rect.height)
        }
        return next
      })
    }

    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  const panelClass = useMemo(
    () => ({
      constitution: "",
      metrics: "",
      registry: "panel-registry",
      legend: ""
    }),
    []
  )

  return (
    <main className="shell">
      <div
        ref={(node) => {
          panelRefs.current.constitution = node
        }}
        className={`float-panel ${panelClass.constitution} ${dragState?.id === "constitution" ? "dragging" : ""}`}
        style={{ transform: `translate3d(${positions.constitution.x}px, ${positions.constitution.y}px, 0)` }}
      >
        <button className="panel-handle" onPointerDown={(event) => beginDrag("constitution", event)} onClick={() => togglePanel("constitution")}>
          Constitution
        </button>
        {openPanels.constitution && (
          <div className="panel-body">
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
        )}
      </div>

      <div
        ref={(node) => {
          panelRefs.current.metrics = node
        }}
        className={`float-panel ${panelClass.metrics} ${dragState?.id === "metrics" ? "dragging" : ""}`}
        style={{ transform: `translate3d(${positions.metrics.x}px, ${positions.metrics.y}px, 0)` }}
      >
        <button className="panel-handle" onPointerDown={(event) => beginDrag("metrics", event)} onClick={() => togglePanel("metrics")}>
          Metrics
        </button>
        {openPanels.metrics && (
          <div className="panel-body">
            <HUDMetrics metrics={telemetry.metrics} />
          </div>
        )}
      </div>

      <div
        ref={(node) => {
          panelRefs.current.registry = node
        }}
        className={`float-panel ${panelClass.registry} ${dragState?.id === "registry" ? "dragging" : ""}`}
        style={{ transform: `translate3d(${positions.registry.x}px, ${positions.registry.y}px, 0)` }}
      >
        <button className="panel-handle" onPointerDown={(event) => beginDrag("registry", event)} onClick={() => togglePanel("registry")}>
          Registry
        </button>
        {openPanels.registry && (
          <div className="panel-body">
            <HUDRegistry entries={telemetry.registryEntries} tick={telemetry.tick} />
          </div>
        )}
      </div>

      <div
        ref={(node) => {
          panelRefs.current.legend = node
        }}
        className={`float-panel ${panelClass.legend} ${dragState?.id === "legend" ? "dragging" : ""}`}
        style={{ transform: `translate3d(${positions.legend.x}px, ${positions.legend.y}px, 0)` }}
      >
        <button className="panel-handle" onPointerDown={(event) => beginDrag("legend", event)} onClick={() => togglePanel("legend")}>
          Legend
        </button>
        {openPanels.legend && (
          <div className="panel-body">
            <HUDSchema />
          </div>
        )}
      </div>

      <Canvas preset={selectedPreset} seed={activeSeed} onTelemetry={setTelemetry} />
    </main>
  )
}
