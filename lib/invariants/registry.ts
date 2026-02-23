import type { InvariantRegistry, SimInvariant } from "@/lib/state/types"

export function createRegistry(): InvariantRegistry {
  return { entries: {} }
}

export function registerBirth(
  registry: InvariantRegistry,
  inv: SimInvariant,
  tick: number,
  lineageParentIds: string[] = []
): void {
  if (registry.entries[inv.id]) return
  registry.entries[inv.id] = {
    id: inv.id,
    birthTick: tick,
    lineageParentIds,
    energyHistory: [inv.energy],
    positionHistory: [inv.position],
    peakStrength: inv.strength,
    kills: 0,
    territoryWins: 0
  }
}

export function registerDeath(registry: InvariantRegistry, id: string, tick: number): void {
  const entry = registry.entries[id]
  if (!entry || entry.deathTick !== undefined) return
  entry.deathTick = tick
}

export function sampleInvariant(registry: InvariantRegistry, inv: SimInvariant): void {
  const entry = registry.entries[inv.id]
  if (!entry) return

  if (entry.energyHistory.length > 1200) entry.energyHistory.shift()
  if (entry.positionHistory.length > 1200) entry.positionHistory.shift()

  entry.energyHistory.push(inv.energy)
  entry.positionHistory.push(inv.position)
  entry.peakStrength = Math.max(entry.peakStrength, inv.strength)
}

export function registerWin(registry: InvariantRegistry, winnerId: string): void {
  const entry = registry.entries[winnerId]
  if (!entry) return
  entry.kills += 1
  entry.territoryWins += 1
}

export function getRegistryEntries(registry: InvariantRegistry) {
  return Object.values(registry.entries)
}
