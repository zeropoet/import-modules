"use client"

import { useEffect, useRef } from "react"
import { getRegistryEntries } from "@/lib/invariants/registry"
import type { StagePreset } from "@/lib/operators/types"
import { createSimulationState, stepSimulation } from "@/lib/sim/engine"
import { computeDensityGradient, computeEnergyGradient } from "@/lib/sim/math"
import type { RegistryEntry, SimMetrics, SimState } from "@/lib/state/types"

type Telemetry = {
  tick: number
  metrics: SimMetrics
  registryEntries: RegistryEntry[]
  eventCount: number
  anchors: Array<{ id: string; position: [number, number] }>
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
    const trailLayer = document.createElement("canvas")
    const trailContext = trailLayer.getContext("2d")
    const TRAIL_FALLOFF = 0.08
    const AXIS_OPACITY = 0.42
    const CENTER_FORCE_OPACITY = 0.42
    const HELIOS_LATTICE_WORLD_CAP = 64
    const PETAL_CAPTURE_ENABLED = true
    const PETAL_WORLD_CAP = 64
    const PETAL_CLUSTER_SWAY_GAIN = 0.22
    const SIM_STEP = 0.008
    const TARGET_FRAME_MS = 16.6667
    const MAX_FRAME_MS = 50
    const MAX_SIM_STEPS_PER_FRAME = 4
    let width = 1
    let height = 1
    let rafId = 0
    let telemetryCounter = 0
    let lastFrameTime = 0
    let simAccumulator = 0
    let fieldResolution = 4

    function resizeCanvas() {
      const dpr = window.devicePixelRatio || 1
      const viewportW = window.visualViewport?.width ?? window.innerWidth
      const viewportH = window.visualViewport?.height ?? window.innerHeight
      width = Math.max(1, Math.floor(viewportW))
      height = Math.max(1, Math.floor(viewportH))
      el.width = Math.floor(width * dpr)
      el.height = Math.floor(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      if (trailContext) {
        trailLayer.width = el.width
        trailLayer.height = el.height
        trailContext.setTransform(dpr, 0, 0, dpr, 0, 0)
        trailContext.lineCap = "round"
      }
    }

    function render(now: number) {
      const activePreset = presetRef.current
      const sim = simRef.current
      const bounds = getWorldBounds(width, height)
      sim.globals.viewportMinPx = Math.min(width, height)
      const WORLD_OVERFLOW_PX = 120
      sim.globals.worldOverflow = WORLD_OVERFLOW_PX * bounds.scale
      sim.globals.worldHalfW = bounds.halfW
      sim.globals.worldHalfH = bounds.halfH
      const frameMsRaw = lastFrameTime > 0 ? now - lastFrameTime : TARGET_FRAME_MS
      lastFrameTime = now
      const frameMs = Math.max(0, Math.min(MAX_FRAME_MS, frameMsRaw))
      simAccumulator += (frameMs / TARGET_FRAME_MS) * SIM_STEP
      let simSteps = 0
      while (simAccumulator >= SIM_STEP && simSteps < MAX_SIM_STEPS_PER_FRAME) {
        stepSimulation(sim, activePreset, SIM_STEP)
        simAccumulator -= SIM_STEP
        simSteps += 1
      }
      if (frameMs > 20) {
        fieldResolution = Math.min(8, fieldResolution + 1)
      } else if (frameMs < 15) {
        fieldResolution = Math.max(4, fieldResolution - 1)
      }
      const registryEntries = getRegistryEntries(sim.registry)
      const registryById = new Map(registryEntries.map((entry) => [entry.id, entry]))
      const anchorRadiusWorld = sim.anchors.reduce(
        (max, anchor) => Math.max(max, Math.hypot(anchor.position[0], anchor.position[1])),
        0
      )
      const centerForceRadiusPx = Math.max(8, (anchorRadiusWorld / bounds.scale) * 0.3)

      ctx.clearRect(0, 0, width, height)
      const sampleDensityAtTime = (coords: [number, number], t: number): number => {
        let base = sim.fields.density(coords, t)
        for (const inv of sim.invariants) {
          const dx = inv.position[0] - coords[0]
          const dy = inv.position[1] - coords[1]
          const dist = Math.hypot(dx, dy)
          const influence = inv.dynamic ? inv.strength : inv.strength * 1.5
          base += influence * Math.exp(-dist * 4)
        }
        return base
      }
      const sampleEnergyAtTime = (coords: [number, number], t: number): number => {
        if (!sim.globals.energyEnabled) return 0
        return sim.fields.energy(coords, t)
      }
      const resolution = fieldResolution
      for (let x = 0; x < width; x += resolution) {
        for (let y = 0; y < height; y += resolution) {
          const nx = (x - bounds.cx) * bounds.scale
          const ny = (y - bounds.cy) * bounds.scale
          const density = sampleDensityAtTime([nx, ny], sim.globals.time)
          const energy = sampleEnergyAtTime([nx, ny], sim.globals.time)

          if (activePreset.colorMode === "energy") {
            const brightness = Math.max(24, Math.min(82, density * 120))
            const hue = ((200 + energy * 120) % 360 + 360) % 360
            ctx.fillStyle = `hsl(${hue}, 80%, ${brightness}%)`
          } else {
            const value = Math.max(42, Math.min(255, Math.floor(density * 255)))
            ctx.fillStyle = `rgb(${value}, ${value}, ${value})`
          }

          ctx.fillRect(x, y, resolution, resolution)
        }
      }

      if (trailContext) {
        if (TRAIL_FALLOFF > 0) {
          trailContext.save()
          trailContext.globalCompositeOperation = "destination-out"
          trailContext.fillStyle = `rgba(0, 0, 0, ${TRAIL_FALLOFF})`
          trailContext.fillRect(0, 0, width, height)
          trailContext.restore()
        }
      }

      ctx.save()
      ctx.lineWidth = 1

      ctx.beginPath()
      ctx.moveTo(bounds.cx, 0)
      ctx.lineTo(bounds.cx, height)
      ctx.strokeStyle = `rgba(255, 255, 255, ${AXIS_OPACITY})`
      ctx.stroke()

      ctx.beginPath()
      ctx.moveTo(0, bounds.cy)
      ctx.lineTo(width, bounds.cy)
      ctx.strokeStyle = `rgba(255, 255, 255, ${AXIS_OPACITY})`
      ctx.stroke()

      ctx.fillStyle = `rgba(255, 255, 255, ${AXIS_OPACITY})`
      ctx.font = "11px Avenir Next, Segoe UI, sans-serif"
      ctx.fillText("y", bounds.cx + 6, 14)
      ctx.fillText("x", width - 12, bounds.cy - 6)
      ctx.restore()

      const centerGradE = computeEnergyGradient(sim, [0, 0])
      const centerGradD = computeDensityGradient(sim, [0, 0])
      const centerForce = Math.hypot(centerGradE[0] + 0.3 * centerGradD[0], centerGradE[1] + 0.3 * centerGradD[1])
      const centerForceNorm = Math.max(0, Math.min(1, centerForce / 2.2))
      const coreGradient = ctx.createRadialGradient(
        bounds.cx,
        bounds.cy,
        0,
        bounds.cx,
        bounds.cy,
        centerForceRadiusPx
      )
      coreGradient.addColorStop(0, `rgba(255, 255, 255, ${CENTER_FORCE_OPACITY})`)
      coreGradient.addColorStop(0.68, `rgba(255, 255, 255, ${CENTER_FORCE_OPACITY * 0.55})`)
      coreGradient.addColorStop(1, "rgba(255, 255, 255, 0)")
      ctx.beginPath()
      ctx.arc(bounds.cx, bounds.cy, centerForceRadiusPx, 0, Math.PI * 2)
      ctx.fillStyle = coreGradient
      ctx.fill()

      if (activePreset.showProbes) {
        for (const p of sim.probes) {
          const sx = p.x / bounds.scale + bounds.cx
          const sy = p.y / bounds.scale + bounds.cy
          const speedNorm = Math.max(0, Math.min(1, p.speed / 0.018))
          const ageNorm = Math.max(0, Math.min(1, p.age / 450))
          const massNorm = Math.max(0, Math.min(1, (p.mass - 0.6) / 1.6))
          const flameHeat = Math.max(0, Math.min(1, speedNorm * 0.78 + massNorm * 0.22))
          const hue = 8 + flameHeat * 46
          const lightness = 34 + flameHeat * 40
          const alpha = Math.max(0.12, 0.85 - ageNorm * 0.6) * (0.7 + speedNorm * 0.3)
          const size = 1 + speedNorm * 1.6 + ageNorm * 2.2 + massNorm * 3.2

          if (trailContext) {
            const psx = p.prevX / bounds.scale + bounds.cx
            const psy = p.prevY / bounds.scale + bounds.cy
            const trailGradient = trailContext.createLinearGradient(psx, psy, sx, sy)
            trailGradient.addColorStop(
              0,
              `hsla(${Math.max(4, hue - 10)}, 96%, ${Math.max(18, lightness - 16)}%, ${Math.max(0.05, alpha * 0.22)})`
            )
            trailGradient.addColorStop(
              1,
              `hsla(${hue}, 100%, ${Math.min(84, lightness + 6)}%, ${Math.max(0.14, Math.min(0.95, alpha))})`
            )
            trailContext.beginPath()
            trailContext.moveTo(psx, psy)
            trailContext.lineTo(sx, sy)
            trailContext.strokeStyle = trailGradient
            trailContext.lineWidth = 0.5 + speedNorm * 1 + massNorm * 0.8
            trailContext.stroke()
          }

          const headAlpha = Math.max(0.1, alpha * (0.95 - ageNorm * 0.55))
          ctx.fillStyle = `hsla(${hue}, 100%, ${Math.min(90, lightness + 10)}%, ${headAlpha})`
          ctx.fillRect(sx - size / 2, sy - size / 2, size, size)

        }
      }

      if (trailContext) {
        ctx.drawImage(trailLayer, 0, 0, width, height)
      }

      const flameLinkedWorldIds = new Set<string>()
      if (PETAL_CAPTURE_ENABLED) {
        const tau = Math.PI * 2
        const worlds = sim.invariants.filter((inv) => inv.dynamic)
        const petalWorlds = [...worlds].slice(0, PETAL_WORLD_CAP)
        if (petalWorlds.length === 0) {
          // no-op
        } else {
          const meanWorldRadius =
            petalWorlds.reduce((sum, world) => sum + Math.hypot(world.position[0], world.position[1]), 0) /
            petalWorlds.length
        let worldClusterX = 0
        let worldClusterY = 0
        for (const world of petalWorlds) {
          const vMag = Math.hypot(world.vx, world.vy)
          const posTheta = Math.atan2(world.position[1], world.position[0])
          const velTheta = Math.atan2(world.vy, world.vx || 1e-6)
          const blendTheta = posTheta * 0.4 + velTheta * 0.6
          const weight = Math.max(0.2, vMag * 40 + world.energy * 0.05 + world.stability * 0.35)
          worldClusterX += Math.cos(blendTheta) * weight
          worldClusterY += Math.sin(blendTheta) * weight
        }
          const clusterTheta = Math.atan2(worldClusterY, worldClusterX)

        for (let i = 0; i < petalWorlds.length; i += 1) {
          const world = petalWorlds[i]
          flameLinkedWorldIds.add(world.id)
          const worldRadius = Math.hypot(world.position[0], world.position[1])
          const density = Math.max(0, Math.min(1, world.mass / 1.8))
          const unfurl = Math.max(0, Math.min(1, (sim.globals.tick - 80) / 420))
          const maxRadiusPx = (worldRadius / bounds.scale) * (0.42 + unfurl * 0.85)
          const worldTheta = Math.atan2(world.position[1], world.position[0])
          const vMag = Math.hypot(world.vx, world.vy)
          const velTheta = Math.atan2(world.vy, world.vx || 1e-6)
          const flowTheta = worldTheta * 0.5 + velTheta * 0.5
          const baseThetaRaw = flowTheta + sim.globals.time * (0.04 + vMag * 1.8)
          const deltaToCluster = Math.atan2(Math.sin(clusterTheta - baseThetaRaw), Math.cos(clusterTheta - baseThetaRaw))
          const sway = Math.sin(sim.globals.time * 1.6 + i * 0.45 + deltaToCluster * 2.4) * PETAL_CLUSTER_SWAY_GAIN
          const baseTheta = baseThetaRaw + deltaToCluster * PETAL_CLUSTER_SWAY_GAIN * 0.35 + sway * (0.25 + density * 0.35)
          const petalSpan = (tau / Math.max(10, petalWorlds.length)) * (0.65 + density * 0.4)
          const p0 = baseTheta - petalSpan
          const p1 = baseTheta + petalSpan
          const tip = maxRadiusPx + density * 36 + (vMag / Math.max(0.0001, meanWorldRadius)) * 10
          const growthNorm = Math.max(0, Math.min(1, tip / Math.max(1, Math.min(width, height) * 0.42)))
          const gravityDrop = tip * growthNorm * (0.08 + unfurl * 0.18)
          const curl = growthNorm * (0.1 + density * 0.16)
          const tipTheta = baseTheta + Math.sin(sim.globals.time * 1.2 + i * 0.4) * 0.05 * growthNorm
          const cp = tip * (0.48 + density * 0.22)
          const c0x = bounds.cx + Math.cos(p0) * cp - Math.sin(p0) * tip * curl * 0.24
          const c0y = bounds.cy + Math.sin(p0) * cp + Math.cos(p0) * tip * curl * 0.14 + gravityDrop * 0.42
          const c1x = bounds.cx + Math.cos(p1) * cp + Math.sin(p1) * tip * curl * 0.24
          const c1y = bounds.cy + Math.sin(p1) * cp - Math.cos(p1) * tip * curl * 0.14 + gravityDrop * 0.42
          const worldTipX = world.position[0] / bounds.scale + bounds.cx
          const worldTipY = world.position[1] / bounds.scale + bounds.cy
          const tipX = worldTipX + Math.cos(tipTheta) * tip * 0.18 - Math.sin(baseTheta) * tip * curl * 0.1
          const tipY = worldTipY + Math.sin(tipTheta) * tip * 0.18 + gravityDrop
          const hue = 12 + density * 36 + i * 0.9
          const alpha = 0.04 + density * 0.13

          ctx.beginPath()
          ctx.moveTo(bounds.cx, bounds.cy)
          ctx.quadraticCurveTo(c0x, c0y, tipX, tipY)
          ctx.quadraticCurveTo(c1x, c1y, bounds.cx, bounds.cy)
          ctx.fillStyle = `hsla(${hue}, 92%, ${46 + density * 24}%, ${alpha})`
          ctx.fill()
        }
        }
      }

      if (activePreset.showBasins) {
        const basinNodes = [...sim.basins].sort((a, b) => b.count - a.count).slice(0, 10)

        for (const basin of basinNodes) {
          const sx = basin.x / bounds.scale + bounds.cx
          const sy = basin.y / bounds.scale + bounds.cy
          const radius = Math.min(13, 1.1 + basin.count * 0.31)

          ctx.beginPath()
          ctx.arc(sx, sy, radius, 0, Math.PI * 2)
          ctx.fillStyle = "rgba(255, 255, 255, 0.18)"
          ctx.fill()
        }
      }

      const dynamicInvariants = sim.invariants.filter((inv) => inv.dynamic)
      const basinById = new Map(sim.basins.map((basin) => [basin.id, basin]))
      const heliosLatticeActive = dynamicInvariants.length >= HELIOS_LATTICE_WORLD_CAP
      if (heliosLatticeActive && dynamicInvariants.length > 0) {
        const centroidXWorld = dynamicInvariants.reduce((sum, inv) => sum + inv.position[0], 0) / dynamicInvariants.length
        const centroidYWorld = dynamicInvariants.reduce((sum, inv) => sum + inv.position[1], 0) / dynamicInvariants.length
        const meanRadiusWorld =
          dynamicInvariants.reduce(
            (sum, inv) => sum + Math.hypot(inv.position[0] - centroidXWorld, inv.position[1] - centroidYWorld),
            0
          ) / dynamicInvariants.length
        const singularityIntensity = Math.max(0, Math.min(1, 1 - meanRadiusWorld / 0.26))
        const sx = centroidXWorld / bounds.scale + bounds.cx
        const sy = centroidYWorld / bounds.scale + bounds.cy
        const glowRadius = 26 + singularityIntensity * 90

        const singularityGlow = ctx.createRadialGradient(sx, sy, 0, sx, sy, glowRadius)
        singularityGlow.addColorStop(0, `rgba(255, 255, 255, ${0.2 + singularityIntensity * 0.62})`)
        singularityGlow.addColorStop(0.35, `rgba(255, 242, 204, ${0.1 + singularityIntensity * 0.46})`)
        singularityGlow.addColorStop(0.72, `rgba(255, 214, 153, ${0.04 + singularityIntensity * 0.28})`)
        singularityGlow.addColorStop(1, "rgba(255, 255, 255, 0)")
        ctx.beginPath()
        ctx.arc(sx, sy, glowRadius, 0, Math.PI * 2)
        ctx.fillStyle = singularityGlow
        ctx.fill()
      }
      const topDynamicIds = new Set(
        [...dynamicInvariants].sort((a, b) => b.energy - a.energy).slice(0, 5).map((inv) => inv.id)
      )
      for (const inv of dynamicInvariants) {
        if (!inv.originClusterId) continue
        const origin = basinById.get(inv.originClusterId)
        if (!origin) continue
        const sx = inv.position[0] / bounds.scale + bounds.cx
        const sy = inv.position[1] / bounds.scale + bounds.cy
        const ox = origin.x / bounds.scale + bounds.cx
        const oy = origin.y / bounds.scale + bounds.cy
        const tetherAlpha = Math.max(0.08, Math.min(0.28, 0.16 + inv.stability * 0.14))
        ctx.beginPath()
        ctx.moveTo(sx, sy)
        ctx.lineTo(ox, oy)
        ctx.strokeStyle = `rgba(255, 208, 128, ${tetherAlpha})`
        ctx.lineWidth = 0.7
        ctx.stroke()
      }
      for (const inv of dynamicInvariants) {
        const sx = inv.position[0] / bounds.scale + bounds.cx
        const sy = inv.position[1] / bounds.scale + bounds.cy
        const flameLinked = flameLinkedWorldIds.has(inv.id)
        const age = sim.globals.tick - (registryById.get(inv.id)?.birthTick ?? sim.globals.tick)
        const distressRemaining = Math.max(0, (inv.distressUntilTick ?? sim.globals.tick) - sim.globals.tick)
        const distressed = distressRemaining > 0
        const energyNorm = Math.max(0, Math.min(1, inv.energy / 25))
        const ageNorm = Math.max(0, Math.min(1, age / 250))
        const ageWindow = 110
        const agePhase = (age % ageWindow) / ageWindow
        const ageEpoch = Math.floor(age / ageWindow)
        const baseHue = 210 - energyNorm * 165 + ageEpoch * 9 + agePhase * 14
        const flameHue = 14 + energyNorm * 42
        const hue = distressed ? 18 + Math.sin(sim.globals.time * 8 + age * 0.08) * 10 : flameLinked ? flameHue : baseHue
        const breath = 0.5 + 0.5 * Math.sin(sim.globals.time * 2.2 + age * 0.045)
        const radius = 3 + inv.stability * 3 + energyNorm * 3 + breath * 1.4
        const lineWidth = 1 + ageNorm * 2.3

        ctx.beginPath()
        ctx.arc(sx, sy, radius + 2, 0, Math.PI * 2)
        ctx.fillStyle = distressed
          ? `hsla(${hue}, 96%, 58%, 0.33)`
          : flameLinked
            ? `hsla(${hue}, 96%, 50%, 0.28)`
            : `hsla(${hue}, 82%, 56%, 0.22)`
        ctx.fill()

        ctx.beginPath()
        ctx.arc(sx, sy, radius, 0, Math.PI * 2)
        ctx.strokeStyle = `hsla(${hue}, 90%, 70%, 0.96)`
        ctx.lineWidth = lineWidth
        ctx.stroke()

        ctx.beginPath()
        ctx.arc(sx, sy, Math.max(1.2, radius * 0.35), 0, Math.PI * 2)
        ctx.fillStyle = distressed
          ? `hsla(${hue + 8}, 100%, 66%, 0.92)`
          : flameLinked
            ? `hsla(${hue + 10}, 100%, 72%, 0.94)`
            : `hsla(${hue}, 88%, 64%, 0.8)`
        ctx.fill()

        if (heliosLatticeActive || ageNorm > 0.18) {
          const haloRadius = radius + 3 + ageNorm * 4.2
          const start = agePhase * Math.PI * 2
          const sweep = Math.PI * (0.8 + ageNorm * 0.85)
          const haloAlpha = heliosLatticeActive ? 0.36 + ageNorm * 0.28 : 0.16 + ageNorm * 0.28

          // Elder boundary ring; in Helios state this becomes persistent for every world.
          ctx.beginPath()
          ctx.arc(sx, sy, haloRadius, 0, Math.PI * 2)
          ctx.strokeStyle = `hsla(${hue + 10}, 82%, 70%, ${haloAlpha * 0.34})`
          ctx.lineWidth = 0.9 + ageNorm * (heliosLatticeActive ? 1 : 0.7)
          ctx.stroke()

          if (!heliosLatticeActive) {
            ctx.beginPath()
            ctx.arc(sx, sy, haloRadius, start, start + sweep)
            ctx.strokeStyle = `hsla(${hue + 14}, 86%, 74%, ${haloAlpha})`
            ctx.lineWidth = 0.9 + ageNorm * 1
            ctx.stroke()
          }
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
          ctx.fillStyle = "rgba(255, 255, 255, 0.96)"
          ctx.font = "11px Avenir Next, Segoe UI, sans-serif"
          const distressLabel = distressed ? ` d${distressRemaining}` : ""
          ctx.fillText(`${inv.id} a${age} e${inv.energy.toFixed(1)}${distressLabel}`, sx + radius + 4, sy - radius - 4)
        }
      }

      for (const anchor of sim.anchors) {
        const sx = anchor.position[0] / bounds.scale + bounds.cx
        const sy = anchor.position[1] / bounds.scale + bounds.cy
        const size = 7
        ctx.fillStyle = "rgba(229, 237, 255, 0.95)"
        ctx.fillRect(sx - size / 2, sy - size / 2, size, size)
        ctx.fillStyle = "rgba(255, 255, 255, 0.96)"
        ctx.font = "11px Avenir Next, Segoe UI, sans-serif"
        ctx.fillText(anchor.id, sx + 7, sy - 7)
      }

      telemetryCounter += 1
      if (onTelemetry && telemetryCounter % 10 === 0) {
        onTelemetry({
          tick: sim.globals.tick,
          metrics: { ...sim.metrics },
          registryEntries,
          eventCount: sim.events.length,
          anchors: sim.anchors.map((anchor) => ({ id: anchor.id, position: [...anchor.position] as [number, number] }))
        })
      }

      rafId = requestAnimationFrame(render)
    }

    resizeCanvas()
    window.addEventListener("resize", resizeCanvas)
    window.visualViewport?.addEventListener("resize", resizeCanvas)
    rafId = requestAnimationFrame(render)

    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener("resize", resizeCanvas)
      window.visualViewport?.removeEventListener("resize", resizeCanvas)
    }
  }, [onTelemetry])

  return <canvas ref={ref} style={{ position: "fixed", inset: 0, width: "100vw", height: "100dvh", display: "block" }} />
}
