"use client"

import { useEffect, useRef } from "react"
import { computeDensity, computeDensityGradient, computeEnergy, computeEnergyGradient } from "@/lib/engine"
import { Invariant, Stage } from "@/lib/stage"

type Props = {
  stage: Stage
}

type Particle = {
  x: number
  y: number
}

type WorldBounds = {
  scale: number
  cx: number
  cy: number
  halfW: number
  halfH: number
}

type BasinCluster = {
  x: number
  y: number
  count: number
}

type PersistentBasin = {
  x: number
  y: number
  frames: number
  count: number
  promoted: boolean
  matched: boolean
}

export default function Canvas({ stage }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const showParticles = stage.showProbes ?? false
  const showBasins = stage.showBasins ?? false
  const promoteDynamics = stage.promoteDynamics ?? false
  const ecosystemMode = stage.ecosystemMode ?? false
  const globalSelectionMode = stage.globalSelectionMode ?? false
  const colorMode = stage.colorMode ?? "grayscale"

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const el: HTMLCanvasElement = canvas

    const context = el.getContext("2d")
    if (!context) return
    const ctx: CanvasRenderingContext2D = context

    let t = 0
    let rafId = 0
    let width = 1
    let height = 1
    let particles: Particle[] = []
    let activeInvariants: Invariant[] = []
    let persistentBasins: PersistentBasin[] = []
    let dynamicCounter = 0

    function resetInvariants() {
      activeInvariants = stage.invariants.map((inv) =>
        inv.dynamic ? { ...inv } : { ...inv, energy: undefined }
      )
      persistentBasins = []
      dynamicCounter = 0
    }

    function getWorldBounds(): WorldBounds {
      const scale = 2 / Math.min(width, height)
      return {
        scale,
        cx: width / 2,
        cy: height / 2,
        halfW: (width * scale) / 2,
        halfH: (height * scale) / 2
      }
    }

    function randomParticle(bounds: WorldBounds): Particle {
      return {
        x: (Math.random() * 2 - 1) * bounds.halfW,
        y: (Math.random() * 2 - 1) * bounds.halfH
      }
    }

    function resetParticles() {
      const bounds = getWorldBounds()
      if (!showParticles) {
        particles = []
        return
      }

      const count = Math.max(120, Math.min(500, Math.floor((width * height) / 9000)))
      particles = Array.from({ length: count }, () => randomParticle(bounds))
    }

    function resizeCanvas() {
      const dpr = window.devicePixelRatio || 1
      width = Math.max(1, window.innerWidth)
      height = Math.max(1, window.innerHeight)

      el.style.width = `${width}px`
      el.style.height = `${height}px`
      el.width = Math.floor(width * dpr)
      el.height = Math.floor(height * dpr)

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      resetParticles()
    }

    function clusterParticles(points: Particle[], radius: number): BasinCluster[] {
      const clusters: Array<{ xSum: number; ySum: number; count: number }> = []

      for (const point of points) {
        let bestIndex = -1
        let bestDistance = Number.POSITIVE_INFINITY

        for (let i = 0; i < clusters.length; i += 1) {
          const cluster = clusters[i]
          const cx = cluster.xSum / cluster.count
          const cy = cluster.ySum / cluster.count
          const distance = Math.hypot(point.x - cx, point.y - cy)
          if (distance < radius && distance < bestDistance) {
            bestIndex = i
            bestDistance = distance
          }
        }

        if (bestIndex === -1) {
          clusters.push({ xSum: point.x, ySum: point.y, count: 1 })
        } else {
          clusters[bestIndex].xSum += point.x
          clusters[bestIndex].ySum += point.y
          clusters[bestIndex].count += 1
        }
      }

      return clusters.map((cluster) => ({
        x: cluster.xSum / cluster.count,
        y: cluster.ySum / cluster.count,
        count: cluster.count
      }))
    }

    function render() {
      t += 0.008
      ctx.clearRect(0, 0, width, height)

      const resolution = 4
      const bounds = getWorldBounds()

      if (promoteDynamics) {
        const driftStage: Stage = { ...stage, invariants: activeInvariants }
        for (const inv of activeInvariants) {
          if (!inv.dynamic) continue
          const gradE = computeEnergyGradient(driftStage, inv.position, t)
          const driftStep = ecosystemMode ? 0.003 : 0.005
          inv.position[0] += -gradE[0] * driftStep
          inv.position[1] += -gradE[1] * driftStep
          inv.position[0] = Math.max(-bounds.halfW, Math.min(bounds.halfW, inv.position[0]))
          inv.position[1] = Math.max(-bounds.halfH, Math.min(bounds.halfH, inv.position[1]))
        }
      }

      const runtimeStage: Stage = { ...stage, invariants: activeInvariants }

      for (let x = 0; x < width; x += resolution) {
        for (let y = 0; y < height; y += resolution) {
          const nx = (x - bounds.cx) * bounds.scale
          const ny = (y - bounds.cy) * bounds.scale

          const density = computeDensity(runtimeStage, [nx, ny], t)
          const energy = computeEnergy(runtimeStage, [nx, ny], t)

          if (colorMode === "energy") {
            const brightness = Math.max(0, Math.min(70, density * 120))
            const hue = ((200 + energy * 120) % 360 + 360) % 360
            ctx.fillStyle = `hsl(${hue}, 80%, ${brightness}%)`
          } else {
            const value = Math.max(0, Math.min(255, Math.floor(density * 255)))
            ctx.fillStyle = `rgb(${value}, ${value}, ${value})`
          }
          ctx.fillRect(x, y, resolution, resolution)
        }
      }

      if (particles.length > 0) {
        const alpha = 0.3
        const step = 0.01
        const threshold = 25
        const persistFrames = 18
        const gradientThreshold = 0.5
        const maxInvariants = 50
        const clusterRadius = 0.12
        const persistenceMatchRadius = 0.14
        const livePoints: Particle[] = []

        ctx.fillStyle = "rgba(255, 255, 255, 0.85)"

        for (const p of particles) {
          const gradE = computeEnergyGradient(runtimeStage, [p.x, p.y], t)
          const gradD = computeDensityGradient(runtimeStage, [p.x, p.y], t)
          p.x += (-gradE[0] - alpha * gradD[0]) * step
          p.y += (-gradE[1] - alpha * gradD[1]) * step

          if (Math.abs(p.x) > bounds.halfW || Math.abs(p.y) > bounds.halfH) {
            const replacement = randomParticle(bounds)
            p.x = replacement.x
            p.y = replacement.y
            continue
          }

          livePoints.push({ x: p.x, y: p.y })

          const sx = p.x / bounds.scale + bounds.cx
          const sy = p.y / bounds.scale + bounds.cy
          ctx.fillRect(sx, sy, 2, 2)
        }

        const clusters = clusterParticles(livePoints, clusterRadius)
        const denseClusters = clusters.filter((cluster) => cluster.count >= 4)

        if (promoteDynamics) {
          for (const basin of persistentBasins) {
            basin.matched = false
          }

          for (const cluster of clusters) {
            if (cluster.count < threshold) continue

            let bestBasin: PersistentBasin | undefined
            let bestDistance = Number.POSITIVE_INFINITY

            for (const basin of persistentBasins) {
              const distance = Math.hypot(cluster.x - basin.x, cluster.y - basin.y)
              if (distance < persistenceMatchRadius && distance < bestDistance) {
                bestBasin = basin
                bestDistance = distance
              }
            }

            if (!bestBasin) {
              persistentBasins.push({
                x: cluster.x,
                y: cluster.y,
                frames: 1,
                count: cluster.count,
                promoted: false,
                matched: true
              })
            } else {
              bestBasin.x = bestBasin.x * 0.65 + cluster.x * 0.35
              bestBasin.y = bestBasin.y * 0.65 + cluster.y * 0.35
              bestBasin.frames += 1
              bestBasin.count = cluster.count
              bestBasin.matched = true
            }
          }

          persistentBasins = persistentBasins
            .map((basin) => {
              if (!basin.matched) {
                basin.frames -= 1
                basin.count = 0
              }
              return basin
            })
            .filter((basin) => basin.frames > 0)

          for (const basin of persistentBasins) {
            const exists = activeInvariants.some(
              (inv) => Math.hypot(inv.position[0] - basin.x, inv.position[1] - basin.y) < 0.1
            )
            basin.promoted = exists

            if (exists) continue
            if (basin.frames < persistFrames) continue
            if (basin.count < threshold) continue
            if (activeInvariants.length >= maxInvariants) break

            const gradE = computeEnergyGradient(runtimeStage, [basin.x, basin.y], t)
            const gradD = computeDensityGradient(runtimeStage, [basin.x, basin.y], t)
            const gradMag = Math.hypot(gradE[0] + alpha * gradD[0], gradE[1] + alpha * gradD[1])
            if (gradMag > gradientThreshold) continue

            dynamicCounter += 1
            activeInvariants.push({
              id: `dyn-${Date.now()}-${dynamicCounter}`,
              position: [basin.x, basin.y],
              strength: 0.5,
              energy: ecosystemMode ? 0.2 : undefined,
              dynamic: true,
              stability: 1
            })
            basin.promoted = true
          }

          if (ecosystemMode) {
            const dynamicInvariants = activeInvariants.filter((inv) => inv.dynamic)
            if (globalSelectionMode) {
              const GLOBAL_ENERGY_BUDGET = 0.3
              const MAX_STRENGTH = 1.5
              const intakeById: Record<string, number> = {}
              const anchors = activeInvariants.filter((inv) => !inv.dynamic)

              for (const inv of dynamicInvariants) {
                const intake = livePoints.filter(
                  (p) => Math.hypot(p.x - inv.position[0], p.y - inv.position[1]) < 0.2
                ).length
                intakeById[inv.id] = intake
              }

              for (let i = 0; i < dynamicInvariants.length; i += 1) {
                for (let j = i + 1; j < dynamicInvariants.length; j += 1) {
                  const invA = dynamicInvariants[i]
                  const invB = dynamicInvariants[j]
                  const dist = Math.hypot(
                    invA.position[0] - invB.position[0],
                    invA.position[1] - invB.position[1]
                  )
                  if (dist >= 0.3) continue

                  if ((invA.energy ?? 0) > (invB.energy ?? 0)) {
                    intakeById[invB.id] *= 0.5
                  } else if ((invB.energy ?? 0) > (invA.energy ?? 0)) {
                    intakeById[invA.id] *= 0.5
                  }
                }
              }

              const totalIntake = dynamicInvariants.reduce(
                (sum, inv) => sum + (intakeById[inv.id] ?? 0),
                0
              )

              for (const inv of dynamicInvariants) {
                const share = (intakeById[inv.id] ?? 0) / (totalIntake || 1)
                inv.energy = (inv.energy ?? 0) + share * GLOBAL_ENERGY_BUDGET
              }

              for (const inv of dynamicInvariants) {
                for (const anchor of anchors) {
                  const dist = Math.hypot(
                    inv.position[0] - anchor.position[0],
                    inv.position[1] - anchor.position[1]
                  )
                  if (dist < 0.25) {
                    inv.energy = (inv.energy ?? 0) - 0.01
                  }
                }
              }

              activeInvariants = activeInvariants.filter((inv) => {
                if (!inv.dynamic) return true
                inv.energy = (inv.energy ?? 0) - 0.005

                const safeEnergy = Math.max(0, inv.energy ?? 0)
                inv.strength = MAX_STRENGTH * (safeEnergy / (1 + safeEnergy))
                inv.stability = Math.max(0, Math.min(1, safeEnergy / 0.8))

                return (inv.energy ?? 0) >= 0
              })
            } else {
              for (const inv of dynamicInvariants) {
                const intake = livePoints.filter(
                  (p) => Math.hypot(p.x - inv.position[0], p.y - inv.position[1]) < 0.2
                ).length
                inv.energy = (inv.energy ?? 0) + intake * 0.001
              }

              for (let i = 0; i < dynamicInvariants.length; i += 1) {
                for (let j = i + 1; j < dynamicInvariants.length; j += 1) {
                  const invA = dynamicInvariants[i]
                  const invB = dynamicInvariants[j]
                  const dist = Math.hypot(
                    invA.position[0] - invB.position[0],
                    invA.position[1] - invB.position[1]
                  )

                  if (dist < 0.25) {
                    if ((invA.energy ?? 0) > (invB.energy ?? 0)) {
                      invB.energy = (invB.energy ?? 0) - 0.02
                    } else {
                      invA.energy = (invA.energy ?? 0) - 0.02
                    }
                  }
                }
              }

              activeInvariants = activeInvariants.filter((inv) => {
                if (!inv.dynamic) return true
                inv.energy = (inv.energy ?? 0) - 0.005
                inv.strength = 0.3 + (inv.energy ?? 0) * 2
                inv.stability = Math.max(0, Math.min(1, (inv.energy ?? 0) / 0.8))
                return (inv.energy ?? 0) >= 0
              })
            }
          } else {
            activeInvariants = activeInvariants.filter((inv) => {
              if (!inv.dynamic) return true

              const nearbyParticles = livePoints.filter(
                (p) => Math.hypot(p.x - inv.position[0], p.y - inv.position[1]) < 0.15
              ).length

              const previousStability = inv.stability ?? 1
              const stability =
                nearbyParticles < 5
                  ? previousStability - 0.02
                  : Math.min(1, previousStability + 0.01)

              inv.stability = stability
              inv.strength = 0.25 + stability * 0.45
              return stability > 0
            })
          }
        }

        if (showBasins) {
          const basinNodes = denseClusters.sort((a, b) => b.count - a.count).slice(0, 10)

          for (const basin of basinNodes) {
            const sx = basin.x / bounds.scale + bounds.cx
            const sy = basin.y / bounds.scale + bounds.cy
            const radius = Math.min(7, 2 + basin.count * 0.35)

            ctx.beginPath()
            ctx.arc(sx, sy, radius, 0, Math.PI * 2)
            ctx.fillStyle = "rgba(255, 255, 255, 0.18)"
            ctx.fill()
          }
        }

        if (promoteDynamics) {
          for (const inv of activeInvariants) {
            if (!inv.dynamic) continue
            const sx = inv.position[0] / bounds.scale + bounds.cx
            const sy = inv.position[1] / bounds.scale + bounds.cy
            const radius = 3 + (inv.stability ?? 0) * 4

            ctx.beginPath()
            ctx.arc(sx, sy, radius, 0, Math.PI * 2)
            ctx.strokeStyle = "rgba(255, 255, 255, 0.85)"
            ctx.lineWidth = 1
            ctx.stroke()
          }
        }
      }

      rafId = requestAnimationFrame(render)
    }

    resetInvariants()
    resizeCanvas()
    window.addEventListener("resize", resizeCanvas)
    render()

    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener("resize", resizeCanvas)
    }
  }, [
    stage,
    colorMode,
    ecosystemMode,
    globalSelectionMode,
    promoteDynamics,
    showBasins,
    showParticles
  ])

  return <canvas ref={ref} style={{ display: "block" }} />
}
