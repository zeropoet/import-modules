"use client"

import { useEffect, useRef } from "react"
import { getRegistryEntries } from "@/lib/invariants/registry"
import type { StagePreset } from "@/lib/operators/types"
import { createSimulationState, stepSimulation } from "@/lib/sim/engine"
import { computeDensity, computeEnergy } from "@/lib/sim/math"
import type { RegistryEntry, SimMetrics, SimState } from "@/lib/state/types"

type Telemetry = {
  tick: number
  metrics: SimMetrics
  registryEntries: RegistryEntry[]
  eventCount: number
}

type Props = {
  preset: StagePreset
  seed: number
  onTelemetry?: (telemetry: Telemetry) => void
}

type WorldBounds = {
  scale: number
  cx: number
  cy: number
  halfW: number
  halfH: number
}

function getWorldBounds(width: number, height: number): WorldBounds {
  const scale = 2 / Math.min(width, height)
  return {
    scale,
    cx: width / 2,
    cy: height / 2,
    halfW: (width * scale) / 2,
    halfH: (height * scale) / 2
  }
}

export default function Canvas({ preset, seed, onTelemetry }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const presetRef = useRef<StagePreset>(preset)
  const simRef = useRef<SimState>(createSimulationState(seed))

  useEffect(() => {
    presetRef.current = preset
  }, [preset])

  useEffect(() => {
    simRef.current = createSimulationState(seed)
  }, [seed])

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const el: HTMLCanvasElement = canvas

    const context = el.getContext("2d")
    if (!context) return

    const ctx = context
    let width = 1
    let height = 1
    let rafId = 0
    let telemetryCounter = 0

    function resizeCanvas() {
      const dpr = window.devicePixelRatio || 1
      width = Math.max(1, window.innerWidth)
      height = Math.max(1, window.innerHeight)

      el.style.width = `${width}px`
      el.style.height = `${height}px`
      el.width = Math.floor(width * dpr)
      el.height = Math.floor(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    function render() {
      const activePreset = presetRef.current
      const sim = simRef.current
      sim.globals.viewportMinPx = Math.min(width, height)
      stepSimulation(sim, activePreset, 0.008)
      const registryEntries = getRegistryEntries(sim.registry)
      const registryById = new Map(registryEntries.map((entry) => [entry.id, entry]))

      ctx.clearRect(0, 0, width, height)
      const bounds = getWorldBounds(width, height)
      const resolution = 4

      for (let x = 0; x < width; x += resolution) {
        for (let y = 0; y < height; y += resolution) {
          const nx = (x - bounds.cx) * bounds.scale
          const ny = (y - bounds.cy) * bounds.scale
          const density = computeDensity(sim, [nx, ny])
          const energy = computeEnergy(sim, [nx, ny])

          if (activePreset.colorMode === "energy") {
            const brightness = Math.max(0, Math.min(72, density * 120))
            const hue = ((200 + energy * 120) % 360 + 360) % 360
            ctx.fillStyle = `hsl(${hue}, 80%, ${brightness}%)`
          } else {
            const value = Math.max(0, Math.min(255, Math.floor(density * 255)))
            ctx.fillStyle = `rgb(${value}, ${value}, ${value})`
          }

          ctx.fillRect(x, y, resolution, resolution)
        }
      }

      ctx.save()
      ctx.strokeStyle = "rgba(235, 242, 255, 0.35)"
      ctx.lineWidth = 1

      ctx.beginPath()
      ctx.moveTo(bounds.cx, 0)
      ctx.lineTo(bounds.cx, height)
      ctx.stroke()

      ctx.beginPath()
      ctx.moveTo(0, bounds.cy)
      ctx.lineTo(width, bounds.cy)
      ctx.stroke()

      ctx.fillStyle = "rgba(240, 246, 255, 0.8)"
      ctx.font = "11px Avenir Next, Segoe UI, sans-serif"
      ctx.fillText("y", bounds.cx + 6, 14)
      ctx.fillText("x", width - 12, bounds.cy - 6)
      ctx.restore()

      if (activePreset.showProbes) {
        for (const p of sim.probes) {
          const sx = p.x / bounds.scale + bounds.cx
          const sy = p.y / bounds.scale + bounds.cy
          const speedNorm = Math.max(0, Math.min(1, p.speed / 0.018))
          const ageNorm = Math.max(0, Math.min(1, p.age / 450))
          const hue = 210 - speedNorm * 165
          const lightness = 48 + speedNorm * 26
          const alpha = Math.max(0.12, 0.85 - ageNorm * 0.6) * (0.7 + speedNorm * 0.3)
          const size = 1.3 + speedNorm * 1.8 + ageNorm * 3.2

          for (let i = 1; i < p.trail.length; i += 1) {
            const prev = p.trail[i - 1]
            const curr = p.trail[i]
            const trailT = i / (p.trail.length - 1 || 1)
            const segAlpha = alpha * trailT * (0.85 - ageNorm * 0.35)
            const segWidth = (0.5 + speedNorm * 1.1) * trailT

            ctx.beginPath()
            ctx.moveTo(prev[0] / bounds.scale + bounds.cx, prev[1] / bounds.scale + bounds.cy)
            ctx.lineTo(curr[0] / bounds.scale + bounds.cx, curr[1] / bounds.scale + bounds.cy)
            ctx.strokeStyle = `hsla(${hue}, 90%, ${lightness}%, ${segAlpha})`
            ctx.lineWidth = segWidth
            ctx.stroke()
          }

          const headAlpha = Math.max(0.1, alpha * (0.95 - ageNorm * 0.55))
          ctx.fillStyle = `hsla(${hue}, 96%, ${lightness + 4}%, ${headAlpha})`
          ctx.fillRect(sx - size / 2, sy - size / 2, size, size)
        }
      }

      if (activePreset.showBasins) {
        const basinNodes = [...sim.basins].sort((a, b) => b.count - a.count).slice(0, 10)

        for (const basin of basinNodes) {
          const sx = basin.x / bounds.scale + bounds.cx
          const sy = basin.y / bounds.scale + bounds.cy
          const radius = Math.min(26, 2.2 + basin.count * 0.62)

          ctx.beginPath()
          ctx.arc(sx, sy, radius, 0, Math.PI * 2)
          ctx.fillStyle = "rgba(255, 255, 255, 0.18)"
          ctx.fill()
        }
      }

      const dynamicInvariants = sim.invariants.filter((inv) => inv.dynamic)
      const topDynamicIds = new Set(
        [...dynamicInvariants].sort((a, b) => b.energy - a.energy).slice(0, 5).map((inv) => inv.id)
      )
      for (const inv of dynamicInvariants) {
        const sx = inv.position[0] / bounds.scale + bounds.cx
        const sy = inv.position[1] / bounds.scale + bounds.cy
        const age = sim.globals.tick - (registryById.get(inv.id)?.birthTick ?? sim.globals.tick)
        const energyNorm = Math.max(0, Math.min(1, inv.energy / 25))
        const ageNorm = Math.max(0, Math.min(1, age / 250))
        const ageWindow = 110
        const agePhase = (age % ageWindow) / ageWindow
        const ageEpoch = Math.floor(age / ageWindow)
        const hue = 210 - energyNorm * 165 + ageEpoch * 9 + agePhase * 14
        const breath = 0.5 + 0.5 * Math.sin(sim.globals.time * 2.2 + age * 0.045)
        const radius = 3 + inv.stability * 3 + energyNorm * 3 + breath * 1.4
        const lineWidth = 1 + ageNorm * 2.3

        ctx.beginPath()
        ctx.arc(sx, sy, radius + 2, 0, Math.PI * 2)
        ctx.fillStyle = `hsla(${hue}, 82%, 56%, 0.22)`
        ctx.fill()

        ctx.beginPath()
        ctx.arc(sx, sy, radius, 0, Math.PI * 2)
        ctx.strokeStyle = `hsla(${hue}, 90%, 70%, 0.96)`
        ctx.lineWidth = lineWidth
        ctx.stroke()

        ctx.beginPath()
        ctx.arc(sx, sy, Math.max(1.2, radius * 0.35), 0, Math.PI * 2)
        ctx.fillStyle = `hsla(${hue}, 88%, 64%, 0.8)`
        ctx.fill()

        if (ageNorm > 0.18) {
          const haloRadius = radius + 4 + ageNorm * 5
          const start = agePhase * Math.PI * 2
          const sweep = Math.PI * (0.55 + ageNorm * 0.75)
          ctx.beginPath()
          ctx.arc(sx, sy, haloRadius, start, start + sweep)
          ctx.strokeStyle = `hsla(${hue + 22}, 84%, 72%, ${0.18 + ageNorm * 0.32})`
          ctx.lineWidth = 0.8 + ageNorm * 1.1
          ctx.stroke()
        }

        if (ageNorm > 0.58) {
          const orbitRadius = radius + 8 + ageNorm * 4
          const orbitTheta = sim.globals.time * 1.3 + age * 0.05
          const ox = sx + Math.cos(orbitTheta) * orbitRadius
          const oy = sy + Math.sin(orbitTheta) * orbitRadius
          ctx.beginPath()
          ctx.arc(ox, oy, 1.1 + breath * 0.9, 0, Math.PI * 2)
          ctx.fillStyle = `hsla(${hue + 35}, 92%, 74%, ${0.26 + ageNorm * 0.45})`
          ctx.fill()
        }

        if (topDynamicIds.has(inv.id)) {
          ctx.fillStyle = "rgba(240, 246, 255, 0.95)"
          ctx.font = "11px Avenir Next, Segoe UI, sans-serif"
          ctx.fillText(`${inv.id} a${age} e${inv.energy.toFixed(1)}`, sx + radius + 4, sy - radius - 4)
        }
      }

      for (const anchor of sim.anchors) {
        const sx = anchor.position[0] / bounds.scale + bounds.cx
        const sy = anchor.position[1] / bounds.scale + bounds.cy
        const size = 7
        ctx.fillStyle = "rgba(229, 237, 255, 0.95)"
        ctx.fillRect(sx - size / 2, sy - size / 2, size, size)
        ctx.fillStyle = "rgba(217, 228, 252, 0.96)"
        ctx.font = "11px Avenir Next, Segoe UI, sans-serif"
        ctx.fillText(anchor.id, sx + 7, sy - 7)
      }

      telemetryCounter += 1
      if (onTelemetry && telemetryCounter % 10 === 0) {
        onTelemetry({
          tick: sim.globals.tick,
          metrics: { ...sim.metrics },
          registryEntries,
          eventCount: sim.events.length
        })
      }

      rafId = requestAnimationFrame(render)
    }

    resizeCanvas()
    window.addEventListener("resize", resizeCanvas)
    render()

    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener("resize", resizeCanvas)
    }
  }, [onTelemetry])

  return <canvas ref={ref} style={{ display: "block" }} />
}
