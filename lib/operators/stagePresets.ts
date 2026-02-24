import { event, type Operator, type StagePreset } from "@/lib/operators/types"
import { getConfiguredAnchors } from "@/lib/state/anchors"
import type { Basin, ProbeParticle, SimInvariant, SimState, Vec2 } from "@/lib/state/types"
import { clusterPoints, computeDensityGradient, computeEnergyGradient, dynamicInvariants } from "@/lib/sim/math"
import { computeMetrics } from "@/lib/metrics"
import { deriveAlignmentControl, evaluateAlignment } from "@/lib/alignment/controller"

const MAX_PROBE_TRAIL_POINTS = 20
const RESPAWN_RADIUS_PX = 100
const SANCTUARY_SUPPORT_RADIUS = 0.36
const SANCTUARY_BASE_PULL = 0.0008
const SANCTUARY_MAX_PULL = 0.007
const SANCTUARY_EDGE_SOFT_START = 0.7
const SANCTUARY_INV_BASE_PULL = 0.004
const SANCTUARY_INV_MAX_PULL = 0.042
const DISTRESS_GRACE_TICKS = 72
const DISTRESS_RECOVERY_THRESHOLD = 0.04
const ENABLE_CLUSTER_EXTRAS = false
const CLUSTER_LINK_RADIUS = 0.23
const CLUSTER_TARGET_RING = 0.065
const CLUSTER_COHESION_GAIN = 0.022
const CLUSTER_SWIRL_GAIN = 0.0012
const CLUSTER_REPULSION_RADIUS = 0.08
const CLUSTER_REPULSION_GAIN = 0.0018
const CLUSTER_B = CLUSTER_SWIRL_GAIN
const CLUSTER_CI = CLUSTER_COHESION_GAIN
const DYNAMIC_CLUSTER_SOFT_CAP = 12
const DYNAMIC_CLUSTER_SIZE_CEILING = 18
const DYNAMIC_CLUSTER_ENERGY_PER_NODE_CEILING = 0.85
const DYNAMIC_CLUSTER_SHEAR_GAIN = 0.0022
const DYNAMIC_CLUSTER_DRAIN_GAIN = 0.012
const DYNAMIC_CLUSTER_HARVEST_TO_BUDGET = 0.35
const DYNAMIC_CLUSTER_BUDGET_MAX = 1.4
const HELIOS_LATTICE_WORLD_CAP = 64
const TARGET_PARTICLES = 324
const ANCHOR_EXCLUSION_RADIUS = 0.13
const ANCHOR_EXCLUSION_PROBE_FORCE = 0.008
const ANCHOR_EXCLUSION_WORLD_FORCE = 0.022
const HELIOS_GEL_NEIGHBOR_RADIUS = 0.22
const HELIOS_GEL_REST_DISTANCE = 0.11
const HELIOS_GEL_RECOMBINE_GAIN = 0.006
const HELIOS_GEL_SNAP_GAIN = 0.003
const HELIOS_GEL_VISCOSITY = 0.01
const HELIOS_GEL_SURFACE_TENSION = 0.0012
const HELIOS_GEL_MAX_STEP = 0.035
const HELIOS_GEL_RESIST_RADIUS = 0.095
const HELIOS_GEL_RESIST_GAIN = 0.03
const HELIOS_POSTCAP_SPRING_DAMP = 0.22
const HELIOS_SINGULARITY_TARGET_RADIUS = 0.075
const HELIOS_CENTROID_DRIFT_GAIN = 0
const WORLD_MASS_MIN = 0.75
const WORLD_MASS_MAX = 1.7
const WORLD_INITIAL_SPEED_MIN = 0.003
const WORLD_INITIAL_SPEED_MAX = 0.012
const WORLD_GRAVITY_GAIN = 0.0075
const WORLD_MUTUAL_GRAVITY_GAIN = 0
const WORLD_REPEL_RADIUS = 0.16
const WORLD_REPEL_GAIN = 0.011
const WORLD_COLLISION_FRICTION = 0.14
const WORLD_SNAP_LOCK_RADIUS = 0.07
const WORLD_SNAP_LOCK_REST_DISTANCE = 0.068
const WORLD_SNAP_LOCK_GAIN = 0.02
const WORLD_SNAP_LOCK_DAMP = 0.2
const WORLD_SNAP_LOCK_TICKS = 8
const WORLD_SEPARATION_IMPULSE = 0.03
const WORLD_SEPARATION_SWERVE = 0.01
const WORLD_DRAG = 0.988
const WORLD_MIN_SPEED = 0.008
const WORLD_MIN_SPEED_KICK = 0.001
const WORLD_SPEED_CAP = 0.075
const ORIGIN_CLUSTER_TETHER_GAIN = 0.032
const ORIGIN_CLUSTER_TETHER_DAMP = 0.14
const ORIGIN_CLUSTER_TETHER_MAX_FORCE = 0.03
const ORIGIN_CLUSTER_RELEASE_TICKS = 720
const ORIGIN_CLUSTER_GROUP_PULL_GAIN = 0.012
const ORIGIN_CLUSTER_GROUP_PULL_MAX = 0.022
const PARTICLE_COLLAPSE_PULL_GAIN = 0.036
const PARTICLE_COLLAPSE_SPIRAL_GAIN = 0.012
const PARTICLE_COLLAPSE_DAMPING = 0.9
const PARTICLE_COLLAPSE_CORE_RADIUS = 0.06
const worldPairLocks = new Map<string, number>()

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

function seededUnit(seed: number, salt: number): number {
  const x = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453
  return x - Math.floor(x)
}

function idSalt(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) % 1000003
  }
  return hash
}

function randomProbe(state: SimState, salt: number): ProbeParticle {
  const viewportMin = Math.max(1, state.globals.viewportMinPx)
  const localDomainRadius =
    Math.min(state.globals.worldHalfW, state.globals.worldHalfH) + state.globals.worldOverflow
  const respawnRadiusWorld = Math.min(localDomainRadius, (RESPAWN_RADIUS_PX * 2) / viewportMin)
  const spawnedInvariants = dynamicInvariants(state)
  let spawnOriginX = 0
  let spawnOriginY = 0
  if (spawnedInvariants.length > 0) {
    const spawnIndex = Math.floor(
      seededUnit(state.globals.seed, state.globals.tick * 113 + salt * 17) * spawnedInvariants.length
    )
    const spawnInvariant = spawnedInvariants[Math.min(spawnedInvariants.length - 1, spawnIndex)]
    spawnOriginX = spawnInvariant.position[0]
    spawnOriginY = spawnInvariant.position[1]
  }
  const radius =
    Math.sqrt(seededUnit(state.globals.seed, state.globals.tick * 131 + salt * 29)) *
    respawnRadiusWorld
  const theta = seededUnit(state.globals.seed, state.globals.tick * 149 + salt * 31) * Math.PI * 2
  const px = spawnOriginX + Math.cos(theta) * radius
  const py = spawnOriginY + Math.sin(theta) * radius
  const mass = 0.6 + seededUnit(state.globals.seed, state.globals.tick * 173 + salt * 37) * 1.6
  return {
    x: px,
    y: py,
    prevX: px,
    prevY: py,
    vx: 0,
    vy: 0,
    mass,
    speed: 0,
    age: 0,
    trail: [[px, py]]
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function nearestSupportPoint(state: SimState, x: number, y: number): { point: Vec2; distance: number } {
  let bestPoint: Vec2 = [0, 0]
  let bestDistance = Number.POSITIVE_INFINITY

  for (const anchor of state.anchors) {
    const dx = anchor.position[0] - x
    const dy = anchor.position[1] - y
    const dist = Math.hypot(dx, dy)
    if (dist < bestDistance) {
      bestDistance = dist
      bestPoint = anchor.position
    }
  }

  if (!Number.isFinite(bestDistance)) {
    return { point: [0, 0], distance: Math.hypot(x, y) }
  }
  return { point: bestPoint, distance: bestDistance }
}

function dynamicClusters(state: SimState): SimInvariant[][] {
  const dynamics = dynamicInvariants(state)
  if (dynamics.length === 0) return []

  const visited = new Set<string>()
  const clusters: SimInvariant[][] = []

  for (let i = 0; i < dynamics.length; i += 1) {
    const root = dynamics[i]
    if (visited.has(root.id)) continue

    const queue = [root]
    const members: SimInvariant[] = []
    visited.add(root.id)

    while (queue.length > 0) {
      const current = queue.shift()
      if (!current) continue
      members.push(current)

      for (const candidate of dynamics) {
        if (visited.has(candidate.id)) continue
        const dist = Math.hypot(
          candidate.position[0] - current.position[0],
          candidate.position[1] - current.position[1]
        )
        if (dist <= CLUSTER_LINK_RADIUS) {
          visited.add(candidate.id)
          queue.push(candidate)
        }
      }
    }

    clusters.push(members)
  }

  return clusters
}

function dynamicWorldCount(state: SimState): number {
  return dynamicInvariants(state).length
}

function anchorExclusionForce(state: SimState, x: number, y: number, gain: number, dtNorm: number): Vec2 {
  let fx = 0
  let fy = 0

  for (const anchor of state.anchors) {
    const dx = x - anchor.position[0]
    const dy = y - anchor.position[1]
    const dist = Math.hypot(dx, dy) || 1
    if (dist >= ANCHOR_EXCLUSION_RADIUS) continue
    const push = ((ANCHOR_EXCLUSION_RADIUS - dist) / ANCHOR_EXCLUSION_RADIUS) * gain * dtNorm
    fx += (dx / dist) * push
    fy += (dy / dist) * push
  }

  return [fx, fy]
}

function probeSanctuaryForce(state: SimState, p: ProbeParticle, dt: number): Vec2 {
  const nearest = nearestSupportPoint(state, p.x, p.y)
  const radial = Math.hypot(p.x, p.y) / Math.max(0.001, state.globals.domainRadius)
  const supportLoss = clamp01((nearest.distance - SANCTUARY_SUPPORT_RADIUS) / 0.85)
  const edgeLoss = clamp01((radial - SANCTUARY_EDGE_SOFT_START) / (1 - SANCTUARY_EDGE_SOFT_START))
  const lostness = clamp01(Math.max(supportLoss, edgeLoss))
  if (lostness <= 1e-5) return [0, 0]

  const tx = nearest.point[0] - p.x
  const ty = nearest.point[1] - p.y
  const dist = Math.hypot(tx, ty) || 1
  const pull = (SANCTUARY_BASE_PULL + (SANCTUARY_MAX_PULL - SANCTUARY_BASE_PULL) * lostness) * dt * 60
  return [(tx / dist) * pull, (ty / dist) * pull]
}

function sanctuaryFieldOperator(state: SimState): void {
  const dynamics = dynamicInvariants(state)
  if (dynamics.length === 0) return

  for (const inv of dynamics) {
    const nearest = nearestSupportPoint(state, inv.position[0], inv.position[1])
    const intake = state.probes.filter(
      (p) => Math.hypot(p.x - inv.position[0], p.y - inv.position[1]) < 0.32
    ).length
    const radial = Math.hypot(inv.position[0], inv.position[1]) / Math.max(0.001, state.globals.domainRadius)
    const supportLoss = clamp01((nearest.distance - SANCTUARY_SUPPORT_RADIUS) / 0.9)
    const intakeLoss = clamp01(1 - intake / 10)
    const edgeLoss = clamp01((radial - SANCTUARY_EDGE_SOFT_START) / (1 - SANCTUARY_EDGE_SOFT_START))
    const lostness = clamp01(Math.max(supportLoss, intakeLoss * 0.75, edgeLoss))
    if (lostness <= 1e-5) continue

    const lerp = SANCTUARY_INV_BASE_PULL + (SANCTUARY_INV_MAX_PULL - SANCTUARY_INV_BASE_PULL) * lostness
    inv.position[0] = inv.position[0] * (1 - lerp) + nearest.point[0] * lerp
    inv.position[1] = inv.position[1] * (1 - lerp) + nearest.point[1] * lerp

    const exclusion = anchorExclusionForce(state, inv.position[0], inv.position[1], ANCHOR_EXCLUSION_WORLD_FORCE, 1)
    inv.position[0] += exclusion[0]
    inv.position[1] += exclusion[1]
  }
}

const distressLifecycleOperator: Operator = (state, _params, _dt, context) => {
  const deadIds = new Set<string>()

  for (const inv of dynamicInvariants(state)) {
    if (inv.energy >= DISTRESS_RECOVERY_THRESHOLD) {
      if (inv.distressUntilTick !== undefined) {
        inv.distressUntilTick = undefined
        context.emit(event("RECOVERY", { invariantId: inv.id, reason: "energy recovered above distress threshold" }))
      }
      continue
    }

    if (inv.energy < 0) {
      if (inv.distressUntilTick === undefined) {
        inv.distressUntilTick = state.globals.tick + DISTRESS_GRACE_TICKS
        context.emit(event("DISTRESS", { invariantId: inv.id, reason: "energy deficit; sanctuary grace window active" }))
      }

      if (state.globals.tick >= inv.distressUntilTick) {
        deadIds.add(inv.id)
        context.emit(event("STARVATION", { invariantId: inv.id }))
        context.emit(event("DEATH", { invariantId: inv.id, reason: "distress timeout" }))
      }
    }
  }

  if (deadIds.size > 0) {
    state.invariants = state.invariants.filter((inv) => !inv.dynamic || !deadIds.has(inv.id))
  }
}

const worldPhysicsOperator: Operator = (state, _params, dt) => {
  const worlds = dynamicInvariants(state)
  if (worlds.length === 0) return

  const dtNorm = dt * 60
  const accel = new Map<string, Vec2>()
  const tick = state.globals.tick
  for (const world of worlds) accel.set(world.id, [0, 0])

  for (const world of worlds) {
    const mass = Math.max(0.2, world.mass)
    const gx = -world.position[0]
    const gy = -world.position[1]
    const gDist = Math.hypot(gx, gy) || 1
    const gravity = WORLD_GRAVITY_GAIN * (0.55 + Math.min(1.35, gDist))
    const a = accel.get(world.id)
    if (!a) continue
    a[0] += (gx / gDist) * gravity / mass
    a[1] += (gy / gDist) * gravity / mass
  }

  for (let i = 0; i < worlds.length; i += 1) {
    const a = worlds[i]
    const aa = accel.get(a.id)
    if (!aa) continue

    for (let j = i + 1; j < worlds.length; j += 1) {
      const b = worlds[j]
      const ab = accel.get(b.id)
      if (!ab) continue
      const dx = b.position[0] - a.position[0]
      const dy = b.position[1] - a.position[1]
      const dist = Math.hypot(dx, dy) || 1
      const ux = dx / dist
      const uy = dy / dist
      const rvx = b.vx - a.vx
      const rvy = b.vy - a.vy
      const relVelAlong = rvx * ux + rvy * uy
      if (WORLD_MUTUAL_GRAVITY_GAIN > 0) {
        const gravForce =
          (WORLD_MUTUAL_GRAVITY_GAIN * Math.max(0.2, a.mass) * Math.max(0.2, b.mass)) /
          (dist * dist + 0.02)
        aa[0] += (ux * gravForce) / Math.max(0.2, a.mass)
        aa[1] += (uy * gravForce) / Math.max(0.2, a.mass)
        ab[0] -= (ux * gravForce) / Math.max(0.2, b.mass)
        ab[1] -= (uy * gravForce) / Math.max(0.2, b.mass)
      }

      const lockId = pairKey(a.id, b.id)
      const lockUntilTick = worldPairLocks.get(lockId)
      const isLocked = lockUntilTick !== undefined && tick <= lockUntilTick
      if (dist < WORLD_SNAP_LOCK_RADIUS && relVelAlong < 0 && !isLocked) {
        worldPairLocks.set(lockId, tick + WORLD_SNAP_LOCK_TICKS)
      }
      if (isLocked) {
        // Snap to a short shared orbit distance and damp relative slip so pair briefly "locks."
        const snapError = dist - WORLD_SNAP_LOCK_REST_DISTANCE
        const snapForce = snapError * WORLD_SNAP_LOCK_GAIN
        aa[0] += (ux * snapForce) / Math.max(0.2, a.mass)
        aa[1] += (uy * snapForce) / Math.max(0.2, a.mass)
        ab[0] -= (ux * snapForce) / Math.max(0.2, b.mass)
        ab[1] -= (uy * snapForce) / Math.max(0.2, b.mass)

        const lockDamp = relVelAlong * WORLD_SNAP_LOCK_DAMP
        aa[0] += (ux * lockDamp) / Math.max(0.2, a.mass)
        aa[1] += (uy * lockDamp) / Math.max(0.2, a.mass)
        ab[0] -= (ux * lockDamp) / Math.max(0.2, b.mass)
        ab[1] -= (uy * lockDamp) / Math.max(0.2, b.mass)
      } else if (lockUntilTick !== undefined && tick > lockUntilTick) {
        // Release with outward push and tangential swerve to change trajectories.
        const spinSign = seededUnit(state.globals.seed, idSalt(a.id) * 53 + idSalt(b.id) * 97) > 0.5 ? 1 : -1
        const swerveX = -uy * spinSign
        const swerveY = ux * spinSign
        const impulseX = ux * WORLD_SEPARATION_IMPULSE + swerveX * WORLD_SEPARATION_SWERVE
        const impulseY = uy * WORLD_SEPARATION_IMPULSE + swerveY * WORLD_SEPARATION_SWERVE
        aa[0] -= impulseX / Math.max(0.2, a.mass)
        aa[1] -= impulseY / Math.max(0.2, a.mass)
        ab[0] += impulseX / Math.max(0.2, b.mass)
        ab[1] += impulseY / Math.max(0.2, b.mass)
        worldPairLocks.delete(lockId)
      }

      if (dist >= WORLD_REPEL_RADIUS) continue
      const repelNorm = (WORLD_REPEL_RADIUS - dist) / WORLD_REPEL_RADIUS
      const force = repelNorm * repelNorm * WORLD_REPEL_GAIN
      aa[0] -= (ux * force) / Math.max(0.2, a.mass)
      aa[1] -= (uy * force) / Math.max(0.2, a.mass)
      ab[0] += (ux * force) / Math.max(0.2, b.mass)
      ab[1] += (uy * force) / Math.max(0.2, b.mass)

      // Tangential contact friction: reduce glide speed only while in collision radius.
      const tangentX = -uy
      const tangentY = ux
      const tangentialSpeed = rvx * tangentX + rvy * tangentY
      const frictionMag = tangentialSpeed * WORLD_COLLISION_FRICTION * repelNorm
      aa[0] += (tangentX * frictionMag) / Math.max(0.2, a.mass)
      aa[1] += (tangentY * frictionMag) / Math.max(0.2, a.mass)
      ab[0] -= (tangentX * frictionMag) / Math.max(0.2, b.mass)
      ab[1] -= (tangentY * frictionMag) / Math.max(0.2, b.mass)
    }
  }

  const drag = Math.pow(WORLD_DRAG, dtNorm)
  for (const world of worlds) {
    const a = accel.get(world.id)
    if (!a) continue
    world.vx = (world.vx + a[0] * dtNorm) * drag
    world.vy = (world.vy + a[1] * dtNorm) * drag

    const speed = Math.hypot(world.vx, world.vy)
    if (speed > WORLD_SPEED_CAP) {
      const s = WORLD_SPEED_CAP / speed
      world.vx *= s
      world.vy *= s
    }
    if (speed < WORLD_MIN_SPEED) {
      const salt = idSalt(world.id)
      const spinDir = seededUnit(state.globals.seed, salt * 43 + 3) > 0.5 ? 1 : -1
      const rx = world.position[0]
      const ry = world.position[1]
      const rDist = Math.hypot(rx, ry) || 1
      const tx = (-ry / rDist) * spinDir
      const ty = (rx / rDist) * spinDir
      world.vx += tx * WORLD_MIN_SPEED_KICK * dtNorm
      world.vy += ty * WORLD_MIN_SPEED_KICK * dtNorm
    }

    world.position[0] += world.vx * dtNorm
    world.position[1] += world.vy * dtNorm
  }
}

const originClusterTetherOperator: Operator = (state, _params, dt) => {
  const worlds = dynamicInvariants(state)
  if (worlds.length === 0) return

  const dtNorm = dt * 60
  const basinById = new Map(state.basins.map((b) => [b.id, b]))
  const worldCenterX = worlds.reduce((sum, world) => sum + world.position[0], 0) / worlds.length
  const worldCenterY = worlds.reduce((sum, world) => sum + world.position[1], 0) / worlds.length

  for (const world of worlds) {
    if (!world.originClusterId) continue
    const origin = basinById.get(world.originClusterId)
    if (!origin) {
      // Connection exists only while origin cluster is alive.
      world.originClusterId = undefined
      world.originClusterOffset = undefined
      continue
    }

    const birthTick = state.registry.entries[world.id]?.birthTick ?? state.globals.tick
    const ageNorm = clamp01((state.globals.tick - birthTick) / ORIGIN_CLUSTER_RELEASE_TICKS)
    const tetherGain = ORIGIN_CLUSTER_TETHER_GAIN * (1 - ageNorm * 0.75)
    const tetherDamp = ORIGIN_CLUSTER_TETHER_DAMP * (1 - ageNorm * 0.45)
    const offset = world.originClusterOffset ?? [0, 0]
    const targetX = origin.x + offset[0]
    const targetY = origin.y + offset[1]
    let fx = (targetX - world.position[0]) * tetherGain
    let fy = (targetY - world.position[1]) * tetherGain
    fx += -world.vx * tetherDamp
    fy += -world.vy * tetherDamp

    // Group drift gradually pulls tethered worlds away from origin cluster.
    const awayX = worldCenterX - origin.x
    const awayY = worldCenterY - origin.y
    const awayDist = Math.hypot(awayX, awayY) || 1
    const groupPull = Math.min(
      ORIGIN_CLUSTER_GROUP_PULL_MAX,
      ORIGIN_CLUSTER_GROUP_PULL_GAIN * ageNorm * Math.max(0.2, awayDist)
    )
    fx += (awayX / awayDist) * groupPull
    fy += (awayY / awayDist) * groupPull

    const fMag = Math.hypot(fx, fy)
    if (fMag > ORIGIN_CLUSTER_TETHER_MAX_FORCE) {
      const s = ORIGIN_CLUSTER_TETHER_MAX_FORCE / fMag
      fx *= s
      fy *= s
    }

    world.vx += fx * dtNorm
    world.vy += fy * dtNorm
  }
}

const clusteredSignatureOperator: Operator = (state, _params, dt) => {
  const clusters = dynamicClusters(state)
  if (clusters.length === 0) return
  const dtNorm = dt * 60

  for (const members of clusters) {
    if (members.length < 2) continue

    const centroidX = members.reduce((sum, inv) => sum + inv.position[0], 0) / members.length
    const centroidY = members.reduce((sum, inv) => sum + inv.position[1], 0) / members.length
    const ringBoost = ENABLE_CLUSTER_EXTRAS ? Math.min(0.08, (members.length - 2) * 0.014) : 0
    const ring = CLUSTER_TARGET_RING + ringBoost
    const spinSign = seededUnit(state.globals.seed, state.globals.tick * 17 + members.length * 31) > 0.5 ? 1 : -1

    for (const inv of members) {
      const dx = inv.position[0] - centroidX
      const dy = inv.position[1] - centroidY
      const dist = Math.hypot(dx, dy) || 1
      const ux = dx / dist
      const uy = dy / dist
      const tx = -uy
      const ty = ux

      const ringCorrection = (ring - dist) * CLUSTER_CI * dtNorm
      const swirlBoost = ENABLE_CLUSTER_EXTRAS ? members.length * 0.00025 : 0
      const swirl = (CLUSTER_B + swirlBoost) * dtNorm * spinSign
      let repulseX = 0
      let repulseY = 0

      if (ENABLE_CLUSTER_EXTRAS) {
        for (const other of members) {
          if (other.id === inv.id) continue
          const ox = inv.position[0] - other.position[0]
          const oy = inv.position[1] - other.position[1]
          const od = Math.hypot(ox, oy) || 1
          if (od >= CLUSTER_REPULSION_RADIUS) continue
          const push =
            ((CLUSTER_REPULSION_RADIUS - od) / CLUSTER_REPULSION_RADIUS) * CLUSTER_REPULSION_GAIN * dtNorm
          repulseX += (ox / od) * push
          repulseY += (oy / od) * push
        }
      }

      inv.position[0] += ux * ringCorrection + tx * swirl + repulseX
      inv.position[1] += uy * ringCorrection + ty * swirl + repulseY
    }
  }
}

const clusterCeilingOperator: Operator = (state, _params, dt, context) => {
  const clusters = dynamicClusters(state)
  if (clusters.length === 0) return

  const dtNorm = dt * 60
  let harvestedBudget = 0

  for (const members of clusters) {
    if (members.length < 2) continue

    const totalEnergy = members.reduce((sum, inv) => sum + Math.max(0, inv.energy), 0)
    const energyCeiling = members.length * DYNAMIC_CLUSTER_ENERGY_PER_NODE_CEILING
    const sizePressure = clamp01(
      (members.length - DYNAMIC_CLUSTER_SOFT_CAP) /
        Math.max(1, DYNAMIC_CLUSTER_SIZE_CEILING - DYNAMIC_CLUSTER_SOFT_CAP)
    )
    const energyPressure = clamp01((totalEnergy - energyCeiling) / Math.max(0.001, energyCeiling))
    const pressure = Math.max(sizePressure, energyPressure)
    if (pressure <= 1e-5) continue

    const centroidX = members.reduce((sum, inv) => sum + inv.position[0], 0) / members.length
    const centroidY = members.reduce((sum, inv) => sum + inv.position[1], 0) / members.length
    const shear = DYNAMIC_CLUSTER_SHEAR_GAIN * pressure * dtNorm

    for (const inv of members) {
      const dx = inv.position[0] - centroidX
      const dy = inv.position[1] - centroidY
      const dist = Math.hypot(dx, dy) || 1
      inv.position[0] += (dx / dist) * shear
      inv.position[1] += (dy / dist) * shear

      const drain = Math.max(0, inv.energy) * DYNAMIC_CLUSTER_DRAIN_GAIN * pressure * dtNorm
      inv.energy = Math.max(0, inv.energy - drain)
      harvestedBudget += drain * DYNAMIC_CLUSTER_HARVEST_TO_BUDGET
      inv.strength = 1.5 * (inv.energy / (1 + inv.energy))
      inv.stability = Math.max(0, Math.min(1, inv.energy / 0.8))
    }

    context.emit(
      event("SUPPRESSED", {
        reason: `cluster ceiling pressure size=${members.length} pressure=${pressure.toFixed(2)}`
      })
    )
  }

  if (harvestedBudget > 0) {
    state.globals.budget = Math.min(DYNAMIC_CLUSTER_BUDGET_MAX, state.globals.budget + harvestedBudget)
  }
}

const heliosGelMembraneOperator: Operator = (state, _params, dt) => {
  const worlds = dynamicInvariants(state)
  if (worlds.length < HELIOS_LATTICE_WORLD_CAP) return

  const dtNorm = dt * 60
  const snapshot = worlds.map((world) => ({ id: world.id, x: world.position[0], y: world.position[1] }))
  const byId = new Map(snapshot.map((entry) => [entry.id, entry]))
  const centerX = snapshot.reduce((sum, world) => sum + world.x, 0) / snapshot.length
  const centerY = snapshot.reduce((sum, world) => sum + world.y, 0) / snapshot.length
  const meanRadius =
    snapshot.reduce((sum, world) => sum + Math.hypot(world.x - centerX, world.y - centerY), 0) / snapshot.length
  const singularityProgress = clamp01(
    (meanRadius - HELIOS_SINGULARITY_TARGET_RADIUS) / Math.max(0.001, HELIOS_SINGULARITY_TARGET_RADIUS * 4)
  )
  const springDamp = HELIOS_POSTCAP_SPRING_DAMP
  const recombineGain = HELIOS_GEL_RECOMBINE_GAIN * springDamp
  const snapGain = HELIOS_GEL_SNAP_GAIN * springDamp

  for (const world of worlds) {
    const self = byId.get(world.id)
    if (!self) continue

    let fx = 0
    let fy = 0
    let neighborCount = 0
    let neighborCx = 0
    let neighborCy = 0

    for (const neighbor of snapshot) {
      if (neighbor.id === self.id) continue
      const dx = neighbor.x - self.x
      const dy = neighbor.y - self.y
      const dist = Math.hypot(dx, dy) || 1
      if (dist > HELIOS_GEL_NEIGHBOR_RADIUS) continue

      neighborCount += 1
      neighborCx += neighbor.x
      neighborCy += neighbor.y

      const springNorm = (dist - HELIOS_GEL_REST_DISTANCE) / HELIOS_GEL_NEIGHBOR_RADIUS
      const springPull =
        (springNorm * recombineGain + springNorm * Math.abs(springNorm) * snapGain) * dtNorm
      fx += (dx / dist) * springPull
      fy += (dy / dist) * springPull

      if (dist < HELIOS_GEL_RESIST_RADIUS) {
        const resist = ((HELIOS_GEL_RESIST_RADIUS - dist) / HELIOS_GEL_RESIST_RADIUS) * HELIOS_GEL_RESIST_GAIN * dtNorm
        fx -= (dx / dist) * resist
        fy -= (dy / dist) * resist
      }
    }

    if (neighborCount > 0) {
      const avgX = neighborCx / neighborCount
      const avgY = neighborCy / neighborCount
      fx += (avgX - self.x) * HELIOS_GEL_VISCOSITY * dtNorm
      fy += (avgY - self.y) * HELIOS_GEL_VISCOSITY * dtNorm
    }

    const rx = self.x - centerX
    const ry = self.y - centerY
    const rDist = Math.hypot(rx, ry) || 1
    const radialError = meanRadius - rDist
    const radialPull = radialError * HELIOS_GEL_SURFACE_TENSION * dtNorm
    fx += (rx / rDist) * radialPull
    fy += (ry / rDist) * radialPull

    // Helios membrane remains in motion: deterministic tangential drift around centroid.
    const driftDir = seededUnit(state.globals.seed, idSalt(self.id) * 61 + 19) > 0.5 ? 1 : -1
    const tx = (-ry / rDist) * driftDir
    const ty = (rx / rDist) * driftDir
    const drift = HELIOS_CENTROID_DRIFT_GAIN * (0.6 + singularityProgress * 0.8) * dtNorm
    fx += tx * drift
    fy += ty * drift

    const step = Math.hypot(fx, fy)
    if (step > HELIOS_GEL_MAX_STEP) {
      const s = HELIOS_GEL_MAX_STEP / step
      fx *= s
      fy *= s
    }

    world.position[0] += fx
    world.position[1] += fy
  }
}

function ensureAnchor(state: SimState, id: string, position: [number, number], strength: number): void {
  if (state.invariants.some((inv) => inv.id === id)) return
  state.invariants.push({
    id,
    position,
    vx: 0,
    vy: 0,
    mass: 1,
    strength,
    dynamic: false,
    energy: 0,
    stability: 1
  })
}

const closureOperator: Operator = (state) => {
  const configuredAnchors = getConfiguredAnchors()
  const configuredAnchorIds = new Set(configuredAnchors.map((anchor) => anchor.id))
  state.globals.energyEnabled = false
  for (const anchor of configuredAnchors) {
    ensureAnchor(state, anchor.id, anchor.position, anchor.strength)
  }
  state.invariants = state.invariants.filter((inv) => inv.dynamic || configuredAnchorIds.has(inv.id))
  state.anchors = state.invariants.filter((inv) => !inv.dynamic)
}

const oscillationOperator: Operator = (state) => {
  state.globals.energyEnabled = true
}

const basinDetectionOperator: Operator = (state, _params, dt) => {
  const worldCount = dynamicWorldCount(state)
  const particleRespawnEnabled = worldCount < HELIOS_LATTICE_WORLD_CAP
  const collapseParticles = worldCount >= HELIOS_LATTICE_WORLD_CAP
  const targetParticles = particleRespawnEnabled ? TARGET_PARTICLES : state.probes.length
  const step = Math.max(0.003, dt * 0.6)
  const alpha = 0.3

  while (state.probes.length < targetParticles) {
    state.probes.push(randomProbe(state, state.probes.length + 1))
  }

  if (state.probes.length > targetParticles) {
    state.probes.length = targetParticles
  }

  for (let i = 0; i < state.probes.length; i += 1) {
    const p = state.probes[i]
    p.prevX = p.x
    p.prevY = p.y
    const gradE = computeEnergyGradient(state, [p.x, p.y])
    const gradD = computeDensityGradient(state, [p.x, p.y])
    const massScale = 1 / Math.max(0.35, p.mass)
    const forceX = (-gradE[0] - alpha * gradD[0]) * step * massScale
    const forceY = (-gradE[1] - alpha * gradD[1]) * step * massScale
    const sanctuaryForce = probeSanctuaryForce(state, p, dt)
    const anchorExclusion = anchorExclusionForce(
      state,
      p.x,
      p.y,
      ANCHOR_EXCLUSION_PROBE_FORCE,
      dt * 60
    )
    const damping = 0.86 + Math.min(0.09, p.mass * 0.03)

    p.vx = (p.vx + forceX + sanctuaryForce[0] + anchorExclusion[0]) * damping
    p.vy = (p.vy + forceY + sanctuaryForce[1] + anchorExclusion[1]) * damping
    if (collapseParticles) {
      const cx = -p.x
      const cy = -p.y
      const cDist = Math.hypot(cx, cy) || 1
      const pull = PARTICLE_COLLAPSE_PULL_GAIN * dt * 60
      const spiralX = (-cy / cDist) * PARTICLE_COLLAPSE_SPIRAL_GAIN * dt * 60
      const spiralY = (cx / cDist) * PARTICLE_COLLAPSE_SPIRAL_GAIN * dt * 60
      p.vx = (p.vx + (cx / cDist) * pull + spiralX) * PARTICLE_COLLAPSE_DAMPING
      p.vy = (p.vy + (cy / cDist) * pull + spiralY) * PARTICLE_COLLAPSE_DAMPING
    }
    p.x += p.vx
    p.y += p.vy
    p.speed = Math.hypot(p.vx, p.vy)
    p.age += 1
    p.trail.push([p.x, p.y])
    if (p.trail.length > MAX_PROBE_TRAIL_POINTS) p.trail.shift()

    if (
      Math.abs(p.x) > state.globals.worldHalfW + state.globals.worldOverflow ||
      Math.abs(p.y) > state.globals.worldHalfH + state.globals.worldOverflow
    ) {
      if (particleRespawnEnabled) {
        state.probes[i] = randomProbe(state, i + 1)
      } else {
        state.probes.splice(i, 1)
        i -= 1
      }
      continue
    }

    if (collapseParticles) {
      const r = Math.hypot(p.x, p.y)
      if (r < PARTICLE_COLLAPSE_CORE_RADIUS) {
        state.probes.splice(i, 1)
        i -= 1
      }
    }
  }

  const clusters = clusterPoints(state.probes, 0.12)
  for (const basin of state.basins) basin.matched = false

  for (let i = 0; i < clusters.length; i += 1) {
    const cluster = clusters[i]
    if (cluster.count < 8) continue

    let best: Basin | undefined
    let bestDistance = Number.POSITIVE_INFINITY

    for (const basin of state.basins) {
      const distance = Math.hypot(cluster.x - basin.x, cluster.y - basin.y)
      if (distance < 0.14 && distance < bestDistance) {
        bestDistance = distance
        best = basin
      }
    }

    if (!best) {
      state.basins.push({
        id: `basin-${state.globals.tick}-${i}`,
        x: cluster.x,
        y: cluster.y,
        count: cluster.count,
        frames: 1,
        matched: true,
        promoted: false
      })
      continue
    }

    best.x = best.x * 0.65 + cluster.x * 0.35
    best.y = best.y * 0.65 + cluster.y * 0.35
    best.count = cluster.count
    best.frames += 1
    best.matched = true
  }

  state.basins = state.basins
    .map((basin) => {
      if (!basin.matched) {
        basin.frames -= 1
        basin.count = 0
      }
      return basin
    })
    .filter((basin) => basin.frames > 0)
}

const emergentPromotionOperator: Operator = (state, params, _dt, context) => {
  let worldCount = dynamicWorldCount(state)
  if (worldCount >= HELIOS_LATTICE_WORLD_CAP) return

  for (const basin of state.basins) {
    if (basin.frames < 10) continue
    if (basin.count < 10) continue

    const exists = state.invariants.some(
      (inv) => Math.hypot(inv.position[0] - basin.x, inv.position[1] - basin.y) < 0.1
    )
    if (exists || state.invariants.length >= params.maxInvariants) continue

    const tooCloseToAnchor = state.anchors.some(
      (anchor) => Math.hypot(anchor.position[0] - basin.x, anchor.position[1] - basin.y) < ANCHOR_EXCLUSION_RADIUS
    )
    if (tooCloseToAnchor) continue

    const localDynamicClusterSize = dynamicInvariants(state).filter(
      (inv) => Math.hypot(inv.position[0] - basin.x, inv.position[1] - basin.y) < CLUSTER_LINK_RADIUS
    ).length
    if (localDynamicClusterSize >= DYNAMIC_CLUSTER_SIZE_CEILING) {
      context.emit(
        event("SUPPRESSED", {
          reason: `promotion blocked at cluster ceiling (${localDynamicClusterSize})`
        })
      )
      continue
    }

    const gradE = computeEnergyGradient(state, [basin.x, basin.y])
    const gradD = computeDensityGradient(state, [basin.x, basin.y])
    const gradMag = Math.hypot(gradE[0] + 0.3 * gradD[0], gradE[1] + 0.3 * gradD[1])
    if (gradMag > 0.5) continue

    const id = `dyn-${state.globals.tick}-${state.invariants.length}`
    const spawnSalt = idSalt(id)
    const mass =
      WORLD_MASS_MIN +
      seededUnit(state.globals.seed, spawnSalt * 19 + state.globals.tick * 7) * (WORLD_MASS_MAX - WORLD_MASS_MIN)
    const speed =
      WORLD_INITIAL_SPEED_MIN +
      seededUnit(state.globals.seed, spawnSalt * 23 + state.globals.tick * 11) *
        (WORLD_INITIAL_SPEED_MAX - WORLD_INITIAL_SPEED_MIN)
    const theta = seededUnit(state.globals.seed, spawnSalt * 29 + state.globals.tick * 13) * Math.PI * 2
    const originOffsetRadius = 0.018 + seededUnit(state.globals.seed, spawnSalt * 31 + state.globals.tick * 17) * 0.05
    const originOffset: Vec2 = [Math.cos(theta) * originOffsetRadius, Math.sin(theta) * originOffsetRadius]
    const created: SimInvariant = {
      id,
      position: [basin.x, basin.y],
      vx: Math.cos(theta) * speed,
      vy: Math.sin(theta) * speed,
      mass,
      originClusterId: basin.id,
      originClusterOffset: originOffset,
      strength: 0.5,
      dynamic: true,
      energy: 0.35,
      stability: 1
    }

    state.invariants.push(created)
    worldCount += 1
    basin.promoted = true
    context.emit(event("PROMOTION", { invariantId: id, relatedIds: [basin.id] }))
    context.emit(event("BIRTH", { invariantId: id, reason: "promoted from persistent particle basin into world" }))
    if (worldCount >= HELIOS_LATTICE_WORLD_CAP) {
      context.emit(
        event("SUPPRESSED", {
          reason: "helios lattice threshold reached (4x4x4); particle respawn disabled"
        })
      )
      return
    }
  }
}

const competitiveEcosystemOperator: Operator = (state, _params, _dt, context) => {
  const dynamics = dynamicInvariants(state)
  const intakeById: Record<string, number> = {}

  for (const inv of dynamics) {
    intakeById[inv.id] = state.probes.filter(
      (p) => Math.hypot(p.x - inv.position[0], p.y - inv.position[1]) < 0.3
    ).length
  }

  for (let i = 0; i < dynamics.length; i += 1) {
    for (let j = i + 1; j < dynamics.length; j += 1) {
      const invA = dynamics[i]
      const invB = dynamics[j]
      const dist = Math.hypot(invA.position[0] - invB.position[0], invA.position[1] - invB.position[1])
      if (dist >= 0.25) continue

      if (invA.energy >= invB.energy) {
        invB.energy -= 0.008
        context.emit(event("SUPPRESSED", { invariantId: invB.id, relatedIds: [invA.id] }))
      } else {
        invA.energy -= 0.008
        context.emit(event("SUPPRESSED", { invariantId: invA.id, relatedIds: [invB.id] }))
      }
    }
  }

  for (const inv of dynamics) {
    inv.energy += (intakeById[inv.id] ?? 0) * 0.001
    inv.energy -= 0.002
    inv.strength = 0.3 + inv.energy * 2
    inv.stability = Math.max(0, Math.min(1, inv.energy / 0.8))

  }
}

const selectionPressureOperator: Operator = (state, _params, _dt) => {
  const dynamics = dynamicInvariants(state)
  const intakeById: Record<string, number> = {}
  const budget = Math.max(0.05, state.globals.budget)

  for (const inv of dynamics) {
    intakeById[inv.id] = state.probes.filter(
      (p) => Math.hypot(p.x - inv.position[0], p.y - inv.position[1]) < 0.3
    ).length
  }

  const totalIntake = dynamics.reduce((sum, inv) => sum + (intakeById[inv.id] ?? 0), 0)
  const equalShare = dynamics.length > 0 ? 1 / dynamics.length : 0

  for (const inv of dynamics) {
    const intakeShare = (intakeById[inv.id] ?? 0) / (totalIntake || 1)
    const share = 0.7 * intakeShare + 0.3 * equalShare
    inv.energy += share * budget
    inv.energy -= 0.002

    const safeEnergy = Math.max(0, inv.energy)
    inv.strength = 1.5 * (safeEnergy / (1 + safeEnergy))
    inv.stability = Math.max(0, Math.min(1, safeEnergy / 0.8))

  }

  const totalStrength = dynamics.reduce((sum, inv) => sum + Math.max(0, inv.strength), 0)
  for (const inv of dynamics) {
    const dominanceShare = totalStrength > 1e-6 ? Math.max(0, inv.strength) / totalStrength : 0
    if (dominanceShare > 0.45) {
      inv.energy = Math.max(0, inv.energy - (dominanceShare - 0.45) * 0.08)
    }
  }

}

const budgetRegulatorOperator: Operator = (state, _params, dt) => {
  const dynamics = dynamicInvariants(state)
  if (dynamics.length === 0) return

  const totalEnergy = dynamics.reduce((sum, inv) => sum + Math.max(0, inv.energy), 0)
  const metrics = computeMetrics(state)
  const alignment = evaluateAlignment(metrics)
  const controlProfile = deriveAlignmentControl(alignment)

  const error = totalEnergy - state.globals.budget
  const EPSILON = 0.02 * controlProfile.deadbandScale
  const KP = 0.2 * controlProfile.budgetGainScale
  const KI = 0.03 * controlProfile.budgetGainScale

  if (Math.abs(error) < EPSILON) {
    state.globals.regulatorIntegral *= 0.96
    return
  }

  state.globals.regulatorIntegral += error * dt
  state.globals.regulatorIntegral = Math.max(-50, Math.min(50, state.globals.regulatorIntegral))
  const control = KP * error + KI * state.globals.regulatorIntegral
  const fallbackShare = 1 / dynamics.length

  const inverseTotal = dynamics.reduce(
    (sum, candidate) => sum + 1 / (Math.max(0.01, candidate.energy) + 0.05),
    0
  )

  for (const inv of dynamics) {
    const removalShare = totalEnergy > 1e-6 ? Math.max(0, inv.energy) / totalEnergy : fallbackShare
    const inverseWeight = 1 / (Math.max(0.01, inv.energy) + 0.05)
    const inverseShare = inverseTotal > 1e-6 ? inverseWeight / inverseTotal : fallbackShare
    const additionShare = inverseShare * controlProfile.equityBoost + fallbackShare * (1 - controlProfile.equityBoost)

    if (control >= 0) {
      inv.energy = Math.max(0, inv.energy - control * removalShare)
    } else {
      inv.energy = Math.max(0, inv.energy - control * additionShare)
    }
    inv.strength = 1.5 * (inv.energy / (1 + inv.energy))
    inv.stability = Math.max(0, Math.min(1, inv.energy / 0.8))
  }

  const totalStrength = dynamics.reduce((sum, inv) => sum + Math.max(0, inv.strength), 0)
  for (const inv of dynamics) {
    const dominanceShare = totalStrength > 1e-6 ? Math.max(0, inv.strength) / totalStrength : 0
    if (dominanceShare <= controlProfile.dominanceTarget) continue
    inv.energy = Math.max(
      0,
      inv.energy - (dominanceShare - controlProfile.dominanceTarget) * controlProfile.dominancePenalty
    )
  }
}

export const Stage1: StagePreset = {
  id: "stage-1-closure",
  label: "Stage 1 - Closure",
  description: "Base closure law with fixed anchors.",
  colorMode: "grayscale",
  showProbes: false,
  showBasins: false,
  operators: [closureOperator]
}

export const Stage2: StagePreset = {
  id: "stage-2-oscillation",
  label: "Stage 2 - Oscillation",
  description: "Adds oscillating energy field.",
  colorMode: "energy",
  showProbes: false,
  showBasins: false,
  operators: [closureOperator, oscillationOperator]
}

export const Stage3: StagePreset = {
  id: "stage-3-basin-detection",
  label: "Stage 3 - Basin Detection",
  description: "Adds particles and basin detection over oscillation.",
  colorMode: "energy",
  showProbes: true,
  showBasins: true,
  operators: [closureOperator, oscillationOperator, basinDetectionOperator]
}

export const Stage4: StagePreset = {
  id: "stage-4-promotion-ecosystem",
  label: "Stage 4 - World Emergence + Ecosystem",
  description: "Promotes persistent particle basins into worlds and introduces local competition.",
  colorMode: "energy",
  showProbes: true,
  showBasins: true,
  operators: [
    closureOperator,
    oscillationOperator,
    basinDetectionOperator,
    sanctuaryFieldOperator,
    clusteredSignatureOperator,
    emergentPromotionOperator,
    competitiveEcosystemOperator,
    worldPhysicsOperator,
    originClusterTetherOperator,
    heliosGelMembraneOperator,
    clusterCeilingOperator,
    distressLifecycleOperator
  ]
}

export const Stage5: StagePreset = {
  id: "stage-5-selection-pressure",
  label: "Stage 5 - Helios Lattice Pressure",
  description: "Adds global budget selection, cluster ceilings, and Helios (4x4x4) transition pressure.",
  colorMode: "energy",
  showProbes: true,
  showBasins: true,
  operators: [
    closureOperator,
    oscillationOperator,
    basinDetectionOperator,
    sanctuaryFieldOperator,
    clusteredSignatureOperator,
    emergentPromotionOperator,
    competitiveEcosystemOperator,
    selectionPressureOperator,
    worldPhysicsOperator,
    originClusterTetherOperator,
    heliosGelMembraneOperator,
    clusterCeilingOperator,
    budgetRegulatorOperator,
    distressLifecycleOperator
  ]
}

export const stagePresets: StagePreset[] = [Stage1, Stage2, Stage3, Stage4, Stage5]

export function getStagePreset(id: string): StagePreset {
  return stagePresets.find((preset) => preset.id === id) ?? Stage5
}
