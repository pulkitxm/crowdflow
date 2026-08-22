"use client";

import { useEffect } from "react";

export function SimulatorConsole() {
  useEffect(() => {
    void import("../../../src/simulator");
  }, []);

  return (
    <div id="sim" className="sim">
      <header className="strip strip--command sim__command">
        <div className="cmd">
          <div className="cmd__primary">
            <div className="brand">
              <span className="brand__mark">RACE DAY</span>
              <span className="brand__sub">SIMULATOR: NOT THE OPERATOR CONSOLE</span>
            </div>
            <div className="hstat" title="simulated clock, venue local time">
              <span className="hstat__label">DAY CLOCK</span>
              <span className="hstat__value" id="sim-clock">--:--:--</span>
            </div>
            <div className="hstat" title="the phase of the race day this clock falls in">
              <span className="hstat__label">PHASE</span>
              <span className="hstat__value" id="sim-phase">...</span>
            </div>
            <div className="controls" id="sim-controls" />
          </div>
          <div className="cmd__params" id="sim-params" />
        </div>
        <div className="cmd__actions" id="sim-actions" />
      </header>

      <section className="panel sim__timeline">
        <div className="panel__head"><h2>RACE DAY CHECKLIST</h2><div className="panel__tools" id="sim-timeline-tools" /></div>
        <div className="sim__race" id="sim-race" />
        <div className="panel__body panel__body--table" id="sim-timeline"><div className="empty">No race day is running. Start one to populate the checklist.</div></div>
      </section>

      <section className="panel sim__crowd">
        <div className="panel__head"><h2>CROWD</h2><div className="panel__tools" id="sim-crowd-tools" /></div>
        <div className="panel__body" id="sim-crowd"><div className="empty">Waiting for the first simulated tick...</div></div>
      </section>

      <section className="panel sim__anomalies">
        <div className="panel__head"><h2>ANOMALIES</h2><div className="panel__tools" id="sim-anomaly-tools" /></div>
        <div className="panel__body" id="sim-anomalies"><div className="empty">Start a race day to arm anomaly injection.</div></div>
      </section>
    </div>
  );
}
