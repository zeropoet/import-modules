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
            Older worlds breathe, gain thicker rings, and develop arc halos
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
            Squares are fixed constitutional anchors (`B`, `Ci`); circles are dynamic worlds
          </p>
        </div>
        <div className="schema-item">
          <span className="schema-basin" />
          <p>
            <strong>Basin Density</strong>
            <br />
            Transparent circles expand as basin particle count increases
          </p>
        </div>
        <div className="schema-item">
          <span className="schema-probe">
            <span className="schema-probe-tail" />
            <span className="schema-probe-head" />
          </span>
          <p>
            <strong>Particle Motion</strong>
            <br />
            Motion-gradient trails persist for the session; particle heads show speed and age (larger + fainter)
          </p>
        </div>
        <div className="schema-item">
          <span className="schema-orbit">
            <span className="schema-orbit-core" />
            <span className="schema-orbit-dot" />
          </span>
          <p>
            <strong>Elder Orbit</strong>
            <br />
            A small orbiting dot appears on elder worlds to mark advanced age
          </p>
        </div>
        <div className="schema-item">
          <span className="schema-phase">elder</span>
          <p>
            <strong>Age Phase</strong>
            <br />
            Registry badges show lifecycle state: spark, bloom, mature, elder
          </p>
        </div>
      </div>
    </section>
  )
}
