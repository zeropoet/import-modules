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

export default function Canvas({ preset, seed, showOriginConnections = false, onTelemetry }: Props) {
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
    const TRAIL_FALLOFF = 0.12
    const AXIS_OPACITY = 0.52
    const CENTER_FORCE_OPACITY = 0.36
    const HELIOS_LATTICE_WORLD_CAP = 64
    const PETAL_CAPTURE_ENABLED = false
    const PETAL_WORLD_CAP = 64
    const PETAL_CLUSTER_SWAY_GAIN = 0.22
    const RIPPLE_WORLD_CAP = 24
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
    const SPAWNING_WORLD_FIRE_TICKS = 90
    const HELIOS_GHOST_TRAIL_MAX_POINTS = 120
    const VIGNETTE_STRENGTH = 1
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
    let fieldResolution = 3
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
      if (!currentDrag || currentDrag.pointerId !== event.pointerId) return
      const sim = simRef.current
      const world = sim.invariants.find((inv) => inv.id === currentDrag.worldId && inv.dynamic)
      if (!world) return
      const worldPoint = pointerToWorld(event.clientX, event.clientY)
      world.position[0] = worldPoint[0] + currentDrag.offsetX
      world.position[1] = worldPoint[1] + currentDrag.offsetY
      world.vx = 0
      world.vy = 0
      event.preventDefault()
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
        fieldResolution = Math.min(6, fieldResolution + 1)
      } else if (frameMs < 15) {
        fieldResolution = Math.max(3, fieldResolution - 1)
      }
      const registryEntries = getRegistryEntries(sim.registry)
      const registryById = new Map(registryEntries.map((entry) => [entry.id, entry]))
      const anchorRadiusWorld = sim.anchors.reduce(
        (max, anchor) => Math.max(max, Math.hypot(anchor.position[0], anchor.position[1])),
        0
      )
      const centerForceRadiusPx = Math.max(8, (anchorRadiusWorld / bounds.scale) * 0.3)
      const dynamicWorlds = sim.invariants.filter((inv) => inv.dynamic)
      const rippleWorlds = dynamicWorlds.slice(0, RIPPLE_WORLD_CAP)
      const rippleParticles = sim.probes.slice(0, PARTICLE_RIPPLE_CAP)
      const heliosRippleBoost = dynamicWorlds.length >= HELIOS_LATTICE_WORLD_CAP ? HELIOS_RIPPLE_BOOST : 1

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
        for (const world of rippleWorlds) {
          const dx = world.position[0] - coords[0]
          const dy = world.position[1] - coords[1]
          const dist = Math.hypot(dx, dy)
          const speedNorm = Math.max(0, Math.min(1, Math.hypot(world.vx, world.vy) / 0.055))
          if (speedNorm <= 1e-4) continue
          const envelope = Math.exp(-dist * RIPPLE_DECAY) * speedNorm
          const phase = dist * RIPPLE_SPATIAL_FREQ - t * (RIPPLE_TIME_FREQ + speedNorm * 1.8)
          base += Math.sin(phase) * envelope * RIPPLE_DENSITY_GAIN * heliosRippleBoost
        }
        for (const p of rippleParticles) {
          const dx = p.x - coords[0]
          const dy = p.y - coords[1]
          const dist = Math.hypot(dx, dy)
          const speedNorm = Math.max(0, Math.min(1, p.speed / 0.028))
          if (speedNorm <= 1e-4) continue
          const envelope = Math.exp(-dist * PARTICLE_RIPPLE_DECAY) * speedNorm
          const phase = dist * PARTICLE_RIPPLE_SPATIAL_FREQ - t * (PARTICLE_RIPPLE_TIME_FREQ + speedNorm * 2.4)
          base += Math.sin(phase) * envelope * PARTICLE_RIPPLE_DENSITY_GAIN
        }
        return base
      }
      const sampleEnergyAtTime = (coords: [number, number], t: number): number => {
        if (!sim.globals.energyEnabled) return 0
        let base = sim.fields.energy(coords, t)
        for (const world of rippleWorlds) {
          const dx = world.position[0] - coords[0]
          const dy = world.position[1] - coords[1]
          const dist = Math.hypot(dx, dy)
          const speedNorm = Math.max(0, Math.min(1, Math.hypot(world.vx, world.vy) / 0.055))
          if (speedNorm <= 1e-4) continue
          const envelope = Math.exp(-dist * (RIPPLE_DECAY - 0.9)) * (0.35 + speedNorm * 0.65)
          const phase = dist * (RIPPLE_SPATIAL_FREQ * 0.92) - t * (RIPPLE_TIME_FREQ + speedNorm * 2.1)
          base += Math.sin(phase) * envelope * RIPPLE_ENERGY_GAIN * heliosRippleBoost
        }
        for (const p of rippleParticles) {
          const dx = p.x - coords[0]
          const dy = p.y - coords[1]
          const dist = Math.hypot(dx, dy)
          const speedNorm = Math.max(0, Math.min(1, p.speed / 0.028))
          if (speedNorm <= 1e-4) continue
          const envelope = Math.exp(-dist * (PARTICLE_RIPPLE_DECAY - 1.1)) * (0.3 + speedNorm * 0.7)
          const phase =
            dist * (PARTICLE_RIPPLE_SPATIAL_FREQ * 0.88) - t * (PARTICLE_RIPPLE_TIME_FREQ + speedNorm * 2.8)
          base += Math.sin(phase) * envelope * PARTICLE_RIPPLE_ENERGY_GAIN
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
      if (heliosLatticeActive) {
        for (const inv of dynamicInvariants) {
          const entry = registryById.get(inv.id)
          if (!entry || entry.positionHistory.length < 3) continue

          const history = entry.positionHistory
          const stride = Math.max(1, Math.ceil(history.length / HELIOS_GHOST_TRAIL_MAX_POINTS))
          const points: Array<[number, number]> = []
          for (let i = 0; i < history.length; i += stride) {
            const point = history[i]
            points.push([point[0] / bounds.scale + bounds.cx, point[1] / bounds.scale + bounds.cy])
          }
          const last = history[history.length - 1]
          points.push([last[0] / bounds.scale + bounds.cx, last[1] / bounds.scale + bounds.cy])
          if (points.length < 3) continue

          const start = points[0]
          const end = points[points.length - 1]
          const ghostGradient = ctx.createLinearGradient(start[0], start[1], end[0], end[1])
          ghostGradient.addColorStop(0, "rgba(228, 242, 255, 0.02)")
          ghostGradient.addColorStop(0.5, "rgba(210, 232, 255, 0.08)")
          ghostGradient.addColorStop(1, "rgba(240, 248, 255, 0.22)")

          ctx.beginPath()
          ctx.moveTo(points[0][0], points[0][1])
          for (let i = 1; i < points.length; i += 1) {
            ctx.lineTo(points[i][0], points[i][1])
          }
          ctx.strokeStyle = ghostGradient
          ctx.lineWidth = 0.7
          ctx.stroke()
        }
      }
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
        const spawning = age <= SPAWNING_WORLD_FIRE_TICKS
        const fireHue = 8 + energyNorm * 42 + (1 - ageNorm) * 10
        const shellFill = spawning
          ? `hsla(${Math.max(4, fireHue - 12)}, 95%, ${36 + energyNorm * 14}%, 0.44)`
          : heliosLatticeActive
            ? "rgba(255, 255, 255, 0.34)"
            : "rgba(0, 0, 0, 0.42)"
        const ringStroke = spawning
          ? `hsla(${fireHue}, 98%, ${56 + energyNorm * 18}%, 0.98)`
          : heliosLatticeActive
            ? "rgba(255, 255, 255, 0.96)"
            : "rgba(0, 0, 0, 0.96)"
        const coreFill = spawning
          ? `hsla(${Math.min(64, fireHue + 6)}, 100%, ${64 + energyNorm * 14}%, 0.92)`
          : heliosLatticeActive
            ? "rgba(255, 255, 255, 0.9)"
            : "rgba(0, 0, 0, 0.9)"

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
  }, [onTelemetry, showOriginConnections])

  return <canvas ref={ref} style={{ position: "fixed", inset: 0, width: "100vw", height: "100dvh", display: "block" }} />
}
