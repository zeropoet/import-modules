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
  paletteMode?: "default" | "deep-sea" | "chrome" | "flame"
  renderControls?: {
    fieldResolutionMin: number
    fieldResolutionMax: number
    rippleGain: number
    rippleFrequency: number
    vignetteStrength: number
  }
  showOriginConnections?: boolean
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

export default function Canvas({
  preset,
  seed,
  paletteMode = "default",
  renderControls,
  showOriginConnections = false,
  onTelemetry
}: Props) {
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
    const TRAIL_FALLOFF = 0.03
    const AXIS_OPACITY = 0.52
    const CENTER_FORCE_OPACITY = 0.36
    const HELIOS_LATTICE_WORLD_CAP = 64
    const PETAL_CAPTURE_ENABLED = false
    const PETAL_WORLD_CAP = 64
    const PETAL_CLUSTER_SWAY_GAIN = 0.22
    const RIPPLE_WORLD_CAP = 24
    const FIELD_DYNAMIC_INFLUENCE_CAP = 180
    const RIPPLE_DENSITY_GAIN = 0.032
    const RIPPLE_ENERGY_GAIN = 0.046
    const RIPPLE_SPATIAL_FREQ = 22
    const RIPPLE_TIME_FREQ = 5.2
    const RIPPLE_DECAY = 5.8
    const HELIOS_RIPPLE_BOOST = 1.35
    const PARTICLE_RIPPLE_CAP = 40
    const PARTICLE_RIPPLE_DENSITY_GAIN = 0.016
    const PARTICLE_RIPPLE_ENERGY_GAIN = 0.026
    const PARTICLE_RIPPLE_SPATIAL_FREQ = 31
    const PARTICLE_RIPPLE_TIME_FREQ = 6.8
    const PARTICLE_RIPPLE_DECAY = 8.2
    const STARTUP_PROBE_TRAIL_TICKS = 220
    const STARTUP_PROBE_TRAIL_WIDTH_BOOST = 8
    const STARTUP_PROBE_TRAIL_ALPHA_BOOST = 0.22
    const SPAWNING_WORLD_FIRE_TICKS = 90
    const HELIOS_GHOST_TRAIL_MAX_POINTS = 240
    const WORLD_TRAIL_CAP = 160
    const VIGNETTE_STRENGTH = renderControls?.vignetteStrength ?? 1
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
    let fieldResolution = renderControls?.fieldResolutionMin ?? 3
    let adaptiveQuality = 1
    let hoverWorldId: string | null = null
    const WORLD_PICK_RADIUS_PX = 30
    let dragState: {
      pointerId: number
      worldId: string
      offsetX: number
      offsetY: number
    } | null = null

    function resizeCanvas() {
      const dpr = window.devicePixelRatio || 1
      const viewportW = window.visualViewport?.width ?? window.innerWidth
      const viewportH = window.visualViewport?.height ?? window.innerHeight
      width = Math.max(1, Math.floor(viewportW))
      height = Math.max(1, Math.floor(viewportH))
      el.width = Math.floor(width * dpr)
      el.height = Math.floor(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.imageSmoothingEnabled = true
      ctx.lineJoin = "round"
      ctx.lineCap = "round"

      if (trailContext) {
        trailLayer.width = el.width
        trailLayer.height = el.height
        trailContext.setTransform(dpr, 0, 0, dpr, 0, 0)
        trailContext.imageSmoothingEnabled = true
        trailContext.lineCap = "round"
      }
    }

    function pointerToWorld(clientX: number, clientY: number): [number, number] {
      const rect = el.getBoundingClientRect()
      const x = clientX - rect.left
      const y = clientY - rect.top
      const bounds = getWorldBounds(width, height)
      return [(x - bounds.cx) * bounds.scale, (y - bounds.cy) * bounds.scale]
    }

    function findNearestWorld(clientX: number, clientY: number): { id: string; x: number; y: number } | null {
      const sim = simRef.current
      const bounds = getWorldBounds(width, height)
      const rect = el.getBoundingClientRect()
      const sx = clientX - rect.left
      const sy = clientY - rect.top
      let nearest: { id: string; x: number; y: number; distPx: number } | null = null

      for (const world of sim.invariants) {
        if (!world.dynamic) continue
        const wx = world.position[0] / bounds.scale + bounds.cx
        const wy = world.position[1] / bounds.scale + bounds.cy
        const distPx = Math.hypot(wx - sx, wy - sy)
        if (distPx > WORLD_PICK_RADIUS_PX) continue
        if (!nearest || distPx < nearest.distPx) {
          nearest = { id: world.id, x: world.position[0], y: world.position[1], distPx }
        }
      }

      if (!nearest) return null
      return { id: nearest.id, x: nearest.x, y: nearest.y }
    }

    function onPointerDown(event: PointerEvent) {
      const hit = findNearestWorld(event.clientX, event.clientY)
      if (!hit) return
      const worldPoint = pointerToWorld(event.clientX, event.clientY)
      dragState = {
        pointerId: event.pointerId,
        worldId: hit.id,
        offsetX: hit.x - worldPoint[0],
        offsetY: hit.y - worldPoint[1]
      }
      el.setPointerCapture(event.pointerId)
      event.preventDefault()
    }

    function onPointerMove(event: PointerEvent) {
      const currentDrag = dragState
      if (currentDrag && currentDrag.pointerId === event.pointerId) {
        const sim = simRef.current
        const world = sim.invariants.find((inv) => inv.id === currentDrag.worldId && inv.dynamic)
        if (!world) return
        const worldPoint = pointerToWorld(event.clientX, event.clientY)
        world.position[0] = worldPoint[0] + currentDrag.offsetX
        world.position[1] = worldPoint[1] + currentDrag.offsetY
        world.vx = 0
        world.vy = 0
        event.preventDefault()
        return
      }
      const hover = findNearestWorld(event.clientX, event.clientY)
      hoverWorldId = hover?.id ?? null
    }

    function endDrag(pointerId: number) {
      if (!dragState || dragState.pointerId !== pointerId) return
      if (el.hasPointerCapture(pointerId)) {
        el.releasePointerCapture(pointerId)
      }
      dragState = null
    }

    function onPointerUp(event: PointerEvent) {
      endDrag(event.pointerId)
    }

    function onPointerCancel(event: PointerEvent) {
      endDrag(event.pointerId)
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
        adaptiveQuality = Math.max(0.55, adaptiveQuality - 0.04)
      } else if (frameMs < 15) {
        adaptiveQuality = Math.min(1, adaptiveQuality + 0.015)
      }
      const baseResMin = Math.max(2, renderControls?.fieldResolutionMin ?? 3)
      const baseResMax = Math.max(baseResMin, renderControls?.fieldResolutionMax ?? 8)
      const autoResMin = Math.max(baseResMin, Math.floor(baseResMin + (1 - adaptiveQuality) * 2))
      const autoResMax = Math.max(autoResMin, Math.floor(baseResMax + (1 - adaptiveQuality) * 3))
      if (frameMs > 20) {
        fieldResolution = Math.min(autoResMax, fieldResolution + 1)
      } else if (frameMs < 15) {
        fieldResolution = Math.max(autoResMin, fieldResolution - 1)
      }
      const registryEntries = getRegistryEntries(sim.registry)
      const registryById = new Map(registryEntries.map((entry) => [entry.id, entry]))
      const anchorRadiusWorld = sim.anchors.reduce(
        (max, anchor) => Math.max(max, Math.hypot(anchor.position[0], anchor.position[1])),
        0
      )
      const centerForceRadiusPx = Math.max(8, (anchorRadiusWorld / bounds.scale) * 0.3)
      const dynamicWorlds = sim.invariants.filter((inv) => inv.dynamic)
      const heliosArchitecturalPhase = dynamicWorlds.length >= HELIOS_LATTICE_WORLD_CAP
      let worldCentroidX = 0
      let worldCentroidY = 0
      let worldSpinSign = 1
      if (heliosArchitecturalPhase && dynamicWorlds.length > 0) {
        worldCentroidX = dynamicWorlds.reduce((sum, world) => sum + world.position[0], 0) / dynamicWorlds.length
        worldCentroidY = dynamicWorlds.reduce((sum, world) => sum + world.position[1], 0) / dynamicWorlds.length
        const angularMomentum = dynamicWorlds.reduce((sum, world) => {
          const rx = world.position[0] - worldCentroidX
          const ry = world.position[1] - worldCentroidY
          return sum + (rx * world.vy - ry * world.vx)
        }, 0)
        worldSpinSign = angularMomentum >= 0 ? 1 : -1
      }
      const rippleGainScale = renderControls?.rippleGain ?? 1
      const rippleFrequencyScale = renderControls?.rippleFrequency ?? 1
      const startupTrailBoost = Math.max(0, Math.min(1, 1 - sim.globals.tick / STARTUP_PROBE_TRAIL_TICKS))
      const worldCap = Math.max(1, Math.floor(RIPPLE_WORLD_CAP * adaptiveQuality))
      const particleCap = Math.max(0, Math.floor(PARTICLE_RIPPLE_CAP * adaptiveQuality))
      const influenceCap = Math.max(32, Math.floor(FIELD_DYNAMIC_INFLUENCE_CAP * adaptiveQuality))
      const dynamicInfluenceWorlds = dynamicWorlds.slice(0, influenceCap)
      const rippleWorlds = dynamicWorlds.slice(0, worldCap).map((world) => ({
        x: world.position[0],
        y: world.position[1],
        speedNorm: Math.max(0, Math.min(1, Math.hypot(world.vx, world.vy) / 0.055))
      }))
      const rippleParticles = activePreset.showProbes
        ? sim.probes.slice(0, particleCap).map((p) => ({
        x: p.x,
        y: p.y,
        speedNorm: Math.max(0, Math.min(1, p.speed / 0.028))
      }))
        : []
      const heliosRippleBoost = heliosArchitecturalPhase ? HELIOS_RIPPLE_BOOST : 1

      ctx.clearRect(0, 0, width, height)
      const sampleDensityAtTime = (coords: [number, number], t: number): number => {
        let base = sim.fields.density(coords, t)
        for (const anchor of sim.anchors) {
          const dx = anchor.position[0] - coords[0]
          const dy = anchor.position[1] - coords[1]
          const dist = Math.hypot(dx, dy)
          base += anchor.strength * 1.5 * Math.exp(-dist * 4)
        }
        for (const inv of dynamicInfluenceWorlds) {
          const dx = inv.position[0] - coords[0]
          const dy = inv.position[1] - coords[1]
          const dist = Math.hypot(dx, dy)
          base += inv.strength * Math.exp(-dist * 4)
        }
        for (const world of rippleWorlds) {
          const dx = world.x - coords[0]
          const dy = world.y - coords[1]
          const dist = Math.hypot(dx, dy)
          const speedNorm = world.speedNorm
          if (speedNorm <= 1e-4) continue
          const envelope = Math.exp(-dist * RIPPLE_DECAY) * speedNorm
          const phase =
            dist * (RIPPLE_SPATIAL_FREQ * rippleFrequencyScale) -
            t * (RIPPLE_TIME_FREQ * rippleFrequencyScale + speedNorm * 1.8)
          base += Math.sin(phase) * envelope * RIPPLE_DENSITY_GAIN * heliosRippleBoost * rippleGainScale
        }
        for (const p of rippleParticles) {
          const dx = p.x - coords[0]
          const dy = p.y - coords[1]
          const dist = Math.hypot(dx, dy)
          const speedNorm = p.speedNorm
          if (speedNorm <= 1e-4) continue
          const envelope = Math.exp(-dist * PARTICLE_RIPPLE_DECAY) * speedNorm
          const phase =
            dist * (PARTICLE_RIPPLE_SPATIAL_FREQ * rippleFrequencyScale) -
            t * (PARTICLE_RIPPLE_TIME_FREQ * rippleFrequencyScale + speedNorm * 2.4)
          base += Math.sin(phase) * envelope * PARTICLE_RIPPLE_DENSITY_GAIN * rippleGainScale
        }
        return base
      }
      const sampleEnergyAtTime = (coords: [number, number], t: number): number => {
        if (!sim.globals.energyEnabled) return 0
        let base = sim.fields.energy(coords, t)
        for (const world of rippleWorlds) {
          const dx = world.x - coords[0]
          const dy = world.y - coords[1]
          const dist = Math.hypot(dx, dy)
          const speedNorm = world.speedNorm
          if (speedNorm <= 1e-4) continue
          const envelope = Math.exp(-dist * (RIPPLE_DECAY - 0.9)) * (0.35 + speedNorm * 0.65)
          const phase =
            dist * (RIPPLE_SPATIAL_FREQ * 0.92 * rippleFrequencyScale) -
            t * (RIPPLE_TIME_FREQ * rippleFrequencyScale + speedNorm * 2.1)
          base += Math.sin(phase) * envelope * RIPPLE_ENERGY_GAIN * heliosRippleBoost * rippleGainScale
        }
        for (const p of rippleParticles) {
          const dx = p.x - coords[0]
          const dy = p.y - coords[1]
          const dist = Math.hypot(dx, dy)
          const speedNorm = p.speedNorm
          if (speedNorm <= 1e-4) continue
          const envelope = Math.exp(-dist * (PARTICLE_RIPPLE_DECAY - 1.1)) * (0.3 + speedNorm * 0.7)
          const phase =
            dist * (PARTICLE_RIPPLE_SPATIAL_FREQ * 0.88 * rippleFrequencyScale) -
            t * (PARTICLE_RIPPLE_TIME_FREQ * rippleFrequencyScale + speedNorm * 2.8)
          base += Math.sin(phase) * envelope * PARTICLE_RIPPLE_ENERGY_GAIN * rippleGainScale
        }
        return base
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
            const energyNorm = Math.max(0, Math.min(1, (energy + 1) / 2))
            if (paletteMode === "deep-sea") {
              const hue = 194 + energyNorm * 36
              const saturation = 62 + energyNorm * 18
              const lightness = Math.max(14, Math.min(72, brightness * (0.72 + energyNorm * 0.2)))
              ctx.fillStyle = `hsl(${hue}, ${saturation}%, ${lightness}%)`
            } else if (paletteMode === "chrome") {
              const hue = 204 + energyNorm * 20
              const saturation = 10 + energyNorm * 18
              const lightness = Math.max(20, Math.min(88, brightness * (0.84 + energyNorm * 0.22)))
              ctx.fillStyle = `hsl(${hue}, ${saturation}%, ${lightness}%)`
            } else if (paletteMode === "flame") {
              const hue = 8 + energyNorm * 48
              const saturation = 84 + energyNorm * 14
              const lightness = Math.max(16, Math.min(86, brightness * (0.78 + energyNorm * 0.28)))
              ctx.fillStyle = `hsl(${hue}, ${saturation}%, ${lightness}%)`
            } else {
              const hue = ((200 + energy * 120) % 360 + 360) % 360
              ctx.fillStyle = `hsl(${hue}, 80%, ${brightness}%)`
            }
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

      const axisX = Math.round(bounds.cx) + 0.5
      const axisY = Math.round(bounds.cy) + 0.5
      ctx.save()
      ctx.lineWidth = 1

      ctx.beginPath()
      ctx.moveTo(axisX, 0)
      ctx.lineTo(axisX, height)
      ctx.strokeStyle = `rgba(255, 255, 255, ${AXIS_OPACITY})`
      ctx.stroke()

      ctx.beginPath()
      ctx.moveTo(0, axisY)
      ctx.lineTo(width, axisY)
      ctx.strokeStyle = `rgba(255, 255, 255, ${AXIS_OPACITY})`
      ctx.stroke()

      ctx.fillStyle = `rgba(255, 255, 255, ${AXIS_OPACITY})`
      ctx.font = "11px Avenir Next, Segoe UI, sans-serif"
      ctx.fillText("y", axisX + 6, 14)
      ctx.fillText("x", width - 12, axisY - 6)
      ctx.restore()

      const vignetteRadius = Math.hypot(bounds.cx, bounds.cy)
      const vignette = ctx.createRadialGradient(bounds.cx, bounds.cy, vignetteRadius * 0.18, bounds.cx, bounds.cy, vignetteRadius)
      vignette.addColorStop(0, "rgba(0, 0, 0, 0)")
      vignette.addColorStop(0.62, "rgba(0, 0, 0, 0.14)")
      vignette.addColorStop(0.82, `rgba(0, 0, 0, ${VIGNETTE_STRENGTH * 0.56})`)
      vignette.addColorStop(1, `rgba(0, 0, 0, ${VIGNETTE_STRENGTH})`)
      ctx.fillStyle = vignette
      ctx.fillRect(0, 0, width, height)

      const centerGradE = computeEnergyGradient(sim, [0, 0])
      const centerGradD = computeDensityGradient(sim, [0, 0])
      const centerForce = Math.hypot(centerGradE[0] + 0.3 * centerGradD[0], centerGradE[1] + 0.3 * centerGradD[1])
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
        if (heliosArchitecturalPhase && dynamicWorlds.length > 0) {
          const centerSX = worldCentroidX / bounds.scale + bounds.cx
          const centerSY = worldCentroidY / bounds.scale + bounds.cy
          const projected = sim.probes.map((p) => {
            const sx = p.x / bounds.scale + bounds.cx
            const sy = p.y / bounds.scale + bounds.cy
            return {
              p,
              sx,
              sy,
              angle: Math.atan2(p.y - worldCentroidY, p.x - worldCentroidX),
              radiusPx: Math.hypot(sx - centerSX, sy - centerSY),
              speedNorm: Math.max(0, Math.min(1, p.speed / 0.026))
            }
          })
          projected.sort((a, b) => a.angle - b.angle)
          const architectureGlow = ctx.createRadialGradient(centerSX, centerSY, 0, centerSX, centerSY, 180)
          architectureGlow.addColorStop(0, "rgba(255, 228, 179, 0.22)")
          architectureGlow.addColorStop(0.45, "rgba(255, 188, 109, 0.1)")
          architectureGlow.addColorStop(1, "rgba(255, 255, 255, 0)")
          ctx.beginPath()
          ctx.arc(centerSX, centerSY, 180, 0, Math.PI * 2)
          ctx.fillStyle = architectureGlow
          ctx.fill()

          const neighborStride = Math.max(2, Math.floor(5 - adaptiveQuality * 2))
          for (let i = 0; i < projected.length; i += 1) {
            const curr = projected[i]
            const nextIndex = (i + neighborStride * worldSpinSign + projected.length) % projected.length
            const next = projected[nextIndex]
            const spokeAlpha = Math.max(0.04, Math.min(0.24, 0.22 - curr.radiusPx / 520 + curr.speedNorm * 0.1))
            const line = ctx.createLinearGradient(curr.sx, curr.sy, next.sx, next.sy)
            line.addColorStop(0, `rgba(255, 214, 153, ${spokeAlpha})`)
            line.addColorStop(1, `rgba(255, 241, 217, ${spokeAlpha * 0.5})`)
            ctx.beginPath()
            ctx.moveTo(curr.sx, curr.sy)
            ctx.lineTo(next.sx, next.sy)
            ctx.strokeStyle = line
            ctx.lineWidth = 0.8
            ctx.stroke()
          }

          for (const node of projected) {
            const hue = 26 + node.speedNorm * 24
            const nodeAlpha = Math.max(0.14, Math.min(0.55, 0.38 - node.radiusPx / 620 + node.speedNorm * 0.2))
            const nodeSize = 1.2 + node.speedNorm * 2 + Math.max(0, 2.4 - node.radiusPx / 180)
            ctx.fillStyle = `hsla(${hue}, 96%, 72%, ${nodeAlpha})`
            ctx.fillRect(node.sx - nodeSize / 2, node.sy - nodeSize / 2, nodeSize, nodeSize)

            if (trailContext) {
              const psx = node.p.prevX / bounds.scale + bounds.cx
              const psy = node.p.prevY / bounds.scale + bounds.cy
              trailContext.beginPath()
              trailContext.moveTo(psx, psy)
              trailContext.lineTo(node.sx, node.sy)
              trailContext.strokeStyle = `rgba(255, 204, 128, ${Math.max(0.06, nodeAlpha * 0.3)})`
              trailContext.lineWidth = 2.6
              trailContext.stroke()
            }
          }
        } else {
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
            const size = 1.8 + speedNorm * 2.1 + ageNorm * 2.9 + massNorm * 4.1

            if (trailContext) {
              const psx = p.prevX / bounds.scale + bounds.cx
              const psy = p.prevY / bounds.scale + bounds.cy
              if (startupTrailBoost > 0.04 && p.trail.length > 2) {
                const historySpan = Math.min(p.trail.length - 1, 6 + Math.floor(startupTrailBoost * 10))
                const startIndex = Math.max(0, p.trail.length - 1 - historySpan)
                for (let h = startIndex + 1; h < p.trail.length; h += 1) {
                  const prev = p.trail[h - 1]
                  const curr = p.trail[h]
                  const hx0 = prev[0] / bounds.scale + bounds.cx
                  const hy0 = prev[1] / bounds.scale + bounds.cy
                  const hx1 = curr[0] / bounds.scale + bounds.cx
                  const hy1 = curr[1] / bounds.scale + bounds.cy
                  const segProgress = (h - startIndex) / Math.max(1, historySpan)
                  const segAlpha = (0.06 + segProgress * 0.24) * startupTrailBoost
                  trailContext.beginPath()
                  trailContext.moveTo(hx0, hy0)
                  trailContext.lineTo(hx1, hy1)
                  trailContext.strokeStyle = `hsla(${hue}, 100%, ${Math.min(84, lightness + 8)}%, ${segAlpha})`
                  trailContext.lineWidth = 1
                  trailContext.stroke()
                }
              }
              const trailGradient = trailContext.createLinearGradient(psx, psy, sx, sy)
              trailGradient.addColorStop(
                0,
                `hsla(${Math.max(4, hue - 10)}, 96%, ${Math.max(18, lightness - 16)}%, ${Math.max(0.03, alpha * (0.14 + startupTrailBoost * STARTUP_PROBE_TRAIL_ALPHA_BOOST))})`
              )
              trailGradient.addColorStop(
                1,
                `hsla(${hue}, 100%, ${Math.min(84, lightness + 6)}%, ${Math.max(0.14, Math.min(0.95, alpha + startupTrailBoost * STARTUP_PROBE_TRAIL_ALPHA_BOOST))})`
              )
              trailContext.beginPath()
              trailContext.moveTo(psx, psy)
              trailContext.lineTo(sx, sy)
              trailContext.strokeStyle = trailGradient
              trailContext.lineWidth = 1
              trailContext.stroke()
            }

            const headAlpha = Math.max(0.1, alpha * (0.95 - ageNorm * 0.55))
            ctx.fillStyle = `hsla(${hue}, 100%, ${Math.min(90, lightness + 10)}%, ${headAlpha})`
            ctx.fillRect(sx - size / 2, sy - size / 2, size, size)
          }
        }
      }

      if (trailContext) {
        ctx.drawImage(trailLayer, 0, 0, width, height)
      }

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
      const worldStyleFor = (inv: (typeof dynamicInvariants)[number]) => {
        const birthTick = registryById.get(inv.id)?.birthTick ?? sim.globals.tick
        const age = sim.globals.tick - birthTick
        const ageNorm = Math.max(0, Math.min(1, age / 250))
        const energyNorm = Math.max(0, Math.min(1, inv.energy / 25))
        const spawning = age <= SPAWNING_WORLD_FIRE_TICKS
        const fireHue = 8 + energyNorm * 42 + (1 - ageNorm) * 10

        if (spawning) {
          return {
            shellFill: `hsla(${Math.max(4, fireHue - 12)}, 95%, ${36 + energyNorm * 14}%, 0.44)`,
            ringStroke: `hsla(${fireHue}, 98%, ${56 + energyNorm * 18}%, 0.98)`,
            coreFill: `hsla(${Math.min(64, fireHue + 6)}, 100%, ${64 + energyNorm * 14}%, 0.92)`
          }
        }

        return {
          shellFill: "rgba(255, 255, 255, 0.34)",
          ringStroke: "rgba(255, 255, 255, 0.96)",
          coreFill: "rgba(255, 255, 255, 0.9)"
        }
      }
      if (showOriginConnections && dynamicInvariants.length > 0) {
        const linkedWorlds = [...dynamicInvariants]
          .sort((a, b) => Math.hypot(a.position[0], a.position[1]) - Math.hypot(b.position[0], b.position[1]))
          .slice(0, HELIOS_LATTICE_WORLD_CAP)

        for (const world of linkedWorlds) {
          const sx = world.position[0] / bounds.scale + bounds.cx
          const sy = world.position[1] / bounds.scale + bounds.cy
          const alpha = 0.18 + Math.min(0.26, world.stability * 0.2)

          ctx.beginPath()
          ctx.moveTo(bounds.cx, bounds.cy)
          ctx.lineTo(sx, sy)
          ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`
          ctx.lineWidth = 0.54
          ctx.stroke()
        }
      }
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
      const ghostPointCap = Math.max(24, Math.floor(HELIOS_GHOST_TRAIL_MAX_POINTS * Math.max(0.7, adaptiveQuality)))
      const trailWorldCap = Math.max(32, Math.floor(WORLD_TRAIL_CAP * Math.max(0.45, adaptiveQuality)))
      for (const inv of dynamicInvariants.slice(0, trailWorldCap)) {
        const entry = registryById.get(inv.id)
        if (!entry || entry.positionHistory.length < 3) continue

        const history = entry.positionHistory
        const historyLastIndex = history.length - 1
        const stride = Math.max(1, Math.ceil(history.length / ghostPointCap))
        const worldAge = Math.max(0, sim.globals.tick - entry.birthTick)
        const totalHistory = Math.max(1, historyLastIndex)
        const energyNorm = Math.max(0, Math.min(1, inv.energy / 25))

        let prevIndex = 0
        let prev = history[0]
        let prevX = prev[0] / bounds.scale + bounds.cx
        let prevY = prev[1] / bounds.scale + bounds.cy

        for (let sourceIndex = stride; sourceIndex <= historyLastIndex; sourceIndex += stride) {
          const clampedIndex = Math.min(historyLastIndex, sourceIndex)
          const curr = history[clampedIndex]
          const currX = curr[0] / bounds.scale + bounds.cx
          const currY = curr[1] / bounds.scale + bounds.cy
          const segAge = Math.max(0, worldAge - (totalHistory - clampedIndex))
          const segProgress = clampedIndex / totalHistory
          const fade = Math.max(0, Math.min(1, Math.pow(segProgress, 0.85)))

          let stroke = "rgba(255, 255, 255, 0.3)"
          if (segAge <= SPAWNING_WORLD_FIRE_TICKS) {
            const segAgeNorm = Math.max(0, Math.min(1, segAge / Math.max(1, SPAWNING_WORLD_FIRE_TICKS)))
            const fireHue = 10 + (1 - segAgeNorm) * 12 + energyNorm * 32
            const alpha = 0.03 + fade * 0.34
            stroke = `hsla(${fireHue}, 98%, ${56 + (1 - segAgeNorm) * 12}%, ${alpha})`
          } else {
            const alpha = 0.03 + fade * 0.28
            stroke = `rgba(255, 255, 255, ${alpha})`
          }

          ctx.beginPath()
          ctx.moveTo(prevX, prevY)
          ctx.lineTo(currX, currY)
          ctx.strokeStyle = stroke
          ctx.lineWidth = 1
          ctx.stroke()

          prevIndex = clampedIndex
          prevX = currX
          prevY = currY
        }

        if (prevIndex < historyLastIndex) {
          const curr = history[historyLastIndex]
          const currX = curr[0] / bounds.scale + bounds.cx
          const currY = curr[1] / bounds.scale + bounds.cy
          const segAge = Math.max(0, worldAge - (totalHistory - historyLastIndex))
          const segProgress = historyLastIndex / totalHistory
          const fade = Math.max(0, Math.min(1, Math.pow(segProgress, 0.85)))

          let stroke = "rgba(255, 255, 255, 0.3)"
          if (segAge <= SPAWNING_WORLD_FIRE_TICKS) {
            const segAgeNorm = Math.max(0, Math.min(1, segAge / Math.max(1, SPAWNING_WORLD_FIRE_TICKS)))
            const fireHue = 10 + (1 - segAgeNorm) * 12 + energyNorm * 32
            const alpha = 0.03 + fade * 0.34
            stroke = `hsla(${fireHue}, 98%, ${56 + (1 - segAgeNorm) * 12}%, ${alpha})`
          } else {
            const alpha = 0.03 + fade * 0.28
            stroke = `rgba(255, 255, 255, ${alpha})`
          }

          ctx.beginPath()
          ctx.moveTo(prevX, prevY)
          ctx.lineTo(currX, currY)
          ctx.strokeStyle = stroke
          ctx.lineWidth = 1
          ctx.stroke()
        }
      }
      const topDynamicIds = new Set(
        [...dynamicInvariants].sort((a, b) => b.energy - a.energy).slice(0, 3).map((inv) => inv.id)
      )
      const showTopLabels = frameMs < 24
      for (const inv of dynamicInvariants) {
        const sx = inv.position[0] / bounds.scale + bounds.cx
        const sy = inv.position[1] / bounds.scale + bounds.cy
        const age = sim.globals.tick - (registryById.get(inv.id)?.birthTick ?? sim.globals.tick)
        const distressRemaining = Math.max(0, (inv.distressUntilTick ?? sim.globals.tick) - sim.globals.tick)
        const distressed = distressRemaining > 0
        const energyNorm = Math.max(0, Math.min(1, inv.energy / 25))
        const ageNorm = Math.max(0, Math.min(1, age / 250))
        const ageWindow = 110
        const agePhase = (age % ageWindow) / ageWindow
        const breath = 0.5 + 0.5 * Math.sin(sim.globals.time * 2.2 + age * 0.045)
        const radius = 3 + inv.stability * 3 + energyNorm * 3 + breath * 1.4
        const lineWidth = 1 + ageNorm * 2.3
        const style = worldStyleFor(inv)
        const shellFill = style.shellFill
        const ringStroke = style.ringStroke
        const coreFill = style.coreFill

        ctx.beginPath()
        ctx.arc(sx, sy, radius + 2, 0, Math.PI * 2)
        ctx.fillStyle = shellFill
        ctx.fill()

        ctx.beginPath()
        ctx.arc(sx, sy, radius, 0, Math.PI * 2)
        ctx.strokeStyle = ringStroke
        ctx.lineWidth = lineWidth
        ctx.stroke()

        ctx.beginPath()
        ctx.arc(sx, sy, Math.max(1.2, radius * 0.35), 0, Math.PI * 2)
        ctx.fillStyle = coreFill
        ctx.fill()

        if (heliosLatticeActive || ageNorm > 0.18) {
          const haloRadius = radius + 3 + ageNorm * 4.2
          const start = agePhase * Math.PI * 2
          const sweep = Math.PI * (0.8 + ageNorm * 0.85)
          const haloAlpha = heliosLatticeActive ? 0.36 + ageNorm * 0.28 : 0.16 + ageNorm * 0.28

          // Elder boundary ring; in Helios state this becomes persistent for every world.
          ctx.beginPath()
          ctx.arc(sx, sy, haloRadius, 0, Math.PI * 2)
          ctx.strokeStyle = `rgba(255, 255, 255, ${haloAlpha * 0.34})`
          ctx.lineWidth = 0.9 + ageNorm * (heliosLatticeActive ? 1 : 0.7)
          ctx.stroke()

          if (!heliosLatticeActive) {
            ctx.beginPath()
            ctx.arc(sx, sy, haloRadius, start, start + sweep)
            ctx.strokeStyle = `rgba(255, 255, 255, ${haloAlpha})`
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
          ctx.fillStyle = `rgba(255, 255, 255, ${0.26 + ageNorm * 0.45})`
          ctx.fill()
        }

        if (showTopLabels && (topDynamicIds.has(inv.id) || hoverWorldId === inv.id)) {
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
    el.style.touchAction = "none"
    el.addEventListener("pointerdown", onPointerDown)
    el.addEventListener("pointermove", onPointerMove)
    el.addEventListener("pointerup", onPointerUp)
    el.addEventListener("pointercancel", onPointerCancel)
    window.addEventListener("resize", resizeCanvas)
    window.visualViewport?.addEventListener("resize", resizeCanvas)
    rafId = requestAnimationFrame(render)

    return () => {
      cancelAnimationFrame(rafId)
      el.removeEventListener("pointerdown", onPointerDown)
      el.removeEventListener("pointermove", onPointerMove)
      el.removeEventListener("pointerup", onPointerUp)
      el.removeEventListener("pointercancel", onPointerCancel)
      window.removeEventListener("resize", resizeCanvas)
      window.visualViewport?.removeEventListener("resize", resizeCanvas)
    }
  }, [onTelemetry, showOriginConnections, paletteMode, renderControls])

  return <canvas ref={ref} style={{ position: "fixed", inset: 0, width: "100vw", height: "100dvh", display: "block" }} />
}
