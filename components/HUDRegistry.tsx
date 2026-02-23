import type { RegistryEntry } from "@/lib/state/types"

type Props = {
  entries: RegistryEntry[]
  tick: number
}

function latestEnergy(entry: RegistryEntry): number {
  return entry.energyHistory[entry.energyHistory.length - 1] ?? 0
}

function ageOf(entry: RegistryEntry, tick: number): number {
  return (entry.deathTick ?? tick) - entry.birthTick
}

function agePhase(age: number): string {
  if (age < 60) return "spark"
  if (age < 140) return "bloom"
  if (age < 260) return "mature"
  return "elder"
}

function energyStyle(energy: number) {
  const eNorm = Math.max(0, Math.min(1, energy / 25))
  const hue = 210 - eNorm * 165
  return {
    chip: `hsl(${hue}, 86%, 56%)`,
    bar: `${Math.max(4, Math.min(100, eNorm * 100))}%`
  }
}

export default function HUDRegistry({ entries, tick }: Props) {
  const top = [...entries]
    .sort((a, b) => latestEnergy(b) - latestEnergy(a))
    .slice(0, 8)

  return (
    <section className="hud-panel">
      <h3>Registry (Top Energy)</h3>
      <ul className="registry-list">
        {top.map((entry) => {
          const age = ageOf(entry, tick)
          const energy = latestEnergy(entry)
          const phase = agePhase(age)
          const { chip, bar } = energyStyle(energy)
          const ageWidth = `${Math.max(4, Math.min(100, (age / 250) * 100))}%`

          return (
            <li key={entry.id} className="registry-row">
              <div className="registry-head">
                <span className="registry-chip" style={{ backgroundColor: chip }} />
                <strong>{entry.id}</strong>
                <span>E {energy.toFixed(3)}</span>
                <span>age {age}</span>
              </div>
              <div className={`age-phase age-phase-${phase}`}>{phase}</div>
              <div className="registry-bars">
                <div className="bar-track">
                  <div className="bar-energy" style={{ width: bar, backgroundColor: chip }} />
                </div>
                <div className="bar-track">
                  <div className="bar-age" style={{ width: ageWidth }} />
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
