export default function HUDSchema() {
  return (
    <section className="hud-panel">
      <h3>Visual Schema</h3>
      <div className="schema-grid">
        <div className="schema-item">
          <span className="schema-dot energy-low" />
          <p>
            <strong>Energy</strong>
            <br />
            Blue (low) to amber (high)
          </p>
        </div>
        <div className="schema-item">
          <span className="schema-ring" />
          <p>
            <strong>Age</strong>
            <br />
            Older invariants draw thicker rings
          </p>
        </div>
        <div className="schema-item">
          <span className="schema-label">dyn-*</span>
          <p>
            <strong>Identity</strong>
            <br />
            Top energy nodes show id + age + energy label in-canvas
          </p>
        </div>
        <div className="schema-item">
          <span className="schema-anchor" />
          <p>
            <strong>Type</strong>
            <br />
            Squares are anchors (`B`, `Ci`), circles are dynamic invariants
          </p>
        </div>
      </div>
    </section>
  )
}
