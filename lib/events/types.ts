export type SimEventType =
  | "BIRTH"
  | "DEATH"
  | "DISTRESS"
  | "PROMOTION"
  | "RECOVERY"
  | "STARVATION"
  | "SUPPRESSED"
  | "MERGE"
  | "SPLIT"

export type SimEvent = {
  type: SimEventType
  tick: number
  invariantId?: string
  relatedIds?: string[]
  reason?: string
}
