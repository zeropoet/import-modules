"use client"

import { useEffect, useRef, useState } from "react"
import type { SimMetrics } from "@/lib/state/types"

type TelemetryAudio = {
  tick: number
  metrics: SimMetrics
  eventCount: number
}

type AudioRig = {
  context: AudioContext
  master: GainNode
  droneOsc: OscillatorNode
  droneGain: GainNode
  pulseOsc: OscillatorNode
  pulseGain: GainNode
  filter: BiquadFilterNode
  pan: StereoPannerNode
}

type Props = {
  telemetry: TelemetryAudio
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function createRig(): AudioRig {
  const context = new AudioContext()
  const master = context.createGain()
  const filter = context.createBiquadFilter()
  const droneOsc = context.createOscillator()
  const droneGain = context.createGain()
  const pulseOsc = context.createOscillator()
  const pulseGain = context.createGain()
  const pan = context.createStereoPanner()

  filter.type = "lowpass"
  filter.frequency.value = 1200
  filter.Q.value = 0.8

  droneOsc.type = "triangle"
  droneOsc.frequency.value = 140
  droneGain.gain.value = 0.02

  pulseOsc.type = "square"
  pulseOsc.frequency.value = 2.2
  pulseGain.gain.value = 0.0001

  master.gain.value = 0.08

  droneOsc.connect(filter)
  filter.connect(droneGain)
  droneGain.connect(pan)

  pulseOsc.connect(pulseGain)
  pulseGain.connect(pan)

  pan.connect(master)
  master.connect(context.destination)

  droneOsc.start()
  pulseOsc.start()

  return { context, master, droneOsc, droneGain, pulseOsc, pulseGain, filter, pan }
}

export default function HUDAudio({ telemetry }: Props) {
  const [enabled, setEnabled] = useState(false)
  const rigRef = useRef<AudioRig | null>(null)

  useEffect(() => {
    return () => {
      if (!rigRef.current) return
      void rigRef.current.context.close()
      rigRef.current = null
    }
  }, [])

  useEffect(() => {
    const rig = rigRef.current
    if (!rig || !enabled) return

    const now = rig.context.currentTime
    const metrics = telemetry.metrics
    const dominance = clamp(metrics.dominanceIndex, 0, 1)
    const entropy = clamp(metrics.entropySpread, 0, 1)
    const alignment = clamp(metrics.alignmentScore, 0, 1)
    const livingNorm = clamp(metrics.livingInvariants / 300, 0, 1)
    const pan = clamp(metrics.conservedDelta / 2, -1, 1)

    const droneFreq = 120 + dominance * 420
    const filterFreq = 320 + entropy * 4200
    const droneLevel = 0.014 + livingNorm * 0.05
    const masterLevel = 0.06 + alignment * 0.12
    const pulseRate = 1.5 + clamp(telemetry.eventCount / 24, 0, 1) * 8 + alignment * 2

    rig.droneOsc.frequency.setTargetAtTime(droneFreq, now, 0.12)
    rig.filter.frequency.setTargetAtTime(filterFreq, now, 0.12)
    rig.droneGain.gain.setTargetAtTime(droneLevel, now, 0.15)
    rig.master.gain.setTargetAtTime(masterLevel, now, 0.2)
    rig.pulseOsc.frequency.setTargetAtTime(pulseRate, now, 0.06)
    rig.pan.pan.setTargetAtTime(pan, now, 0.12)

    if (telemetry.eventCount > 0) {
      const eventAmp = 0.02 + clamp(telemetry.eventCount / 28, 0, 1) * 0.12
      rig.pulseGain.gain.cancelScheduledValues(now)
      rig.pulseGain.gain.setValueAtTime(Math.max(0.0001, rig.pulseGain.gain.value), now)
      rig.pulseGain.gain.linearRampToValueAtTime(eventAmp, now + 0.015)
      rig.pulseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22)
    }
  }, [enabled, telemetry])

  async function toggleAudio() {
    if (!rigRef.current) rigRef.current = createRig()
    const rig = rigRef.current
    if (!rig) return

    if (enabled) {
      await rig.context.suspend()
      setEnabled(false)
      return
    }

    await rig.context.resume()
    setEnabled(true)
  }

  return (
    <>
      <div className="button-row">
        <button type="button" onClick={toggleAudio}>
          {enabled ? "Disable Audio" : "Enable Audio"}
        </button>
      </div>
      <p className="active-seed">
        Audio Signature: {enabled ? "active" : "muted"} | tick {telemetry.tick} | events {telemetry.eventCount}
      </p>
    </>
  )
}
