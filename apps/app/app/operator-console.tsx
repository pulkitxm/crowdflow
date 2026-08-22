"use client";

import { useEffect } from "react";

export function OperatorConsole() {
  useEffect(() => {
    void import("../src/main");
  }, []);

  return (
    <div id="console" className="console">
      <header id="command" className="strip strip--command">
        <div id="header" className="cmd" />
        <div id="command-actions" className="cmd__actions" />
      </header>

      <section id="map-panel" className="panel panel--map">
        <div className="panel__head">
          <h2>VENUE: <span id="map-circuit">...</span></h2>
          <div id="map-controls" className="panel__tools" />
        </div>
        <div className="map__stage">
          <canvas id="map-canvas" />
          <div id="map-attribution" className="map__attribution">Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community</div>
          <div id="scenario-alerts" className="scenario-alerts" />
          <div id="map-readout" className="map__readout">
            <div className="readout__hint">connecting to live venue feed...</div>
          </div>
        </div>
        <div id="map-legend" className="map__legend" />
      </section>

      <section id="ops-panel" className="panel panel--ops">
        <div className="panel__head"><h2>OPS AGENT</h2><div id="agent-status" className="panel__tools" /></div>
        <div className="ops">
          <div className="ops__analysis">
            <section className="ops__block">
              <div className="ops__blockhead"><h3>FORECAST</h3><div id="prediction-model" className="panel__tools" /></div>
              <div id="prediction-body" className="ops__body"><div className="empty">Waiting for the first live forecast...</div></div>
            </section>
            <section className="ops__block">
              <div className="ops__blockhead"><h3>INTERVENTION</h3><div id="intervention-status" className="panel__tools" /></div>
              <div id="intervention-body" className="ops__body"><div className="empty">Waiting for the first safety sweep...</div></div>
            </section>
          </div>
          <div id="agent-body" className="ops__agent panel__body--agent" />
        </div>
      </section>

      <section id="zones-panel" className="panel panel--zones">
        <div className="panel__head"><h2>SECTORS</h2><div id="zones-tools" className="panel__tools" /></div>
        <div id="zones-body" className="panel__body panel__body--table" />
      </section>

      <div className="console__aside">
        <section id="gates-panel" className="panel panel--gates">
          <div className="panel__head"><h2>GATES &amp; EXITS</h2><div id="gates-count" className="panel__tools" /></div>
          <div id="gates-body" className="panel__body panel__body--gates"><div className="empty">Waiting for venue geometry...</div></div>
        </section>

        <section id="live-panel" className="panel panel--live">
          <div className="panel__head"><h2>LIVE PHONES</h2><div id="live-status" className="panel__tools" /></div>
          <div id="live-body" className="panel__body"><div className="empty">No handset has reported yet.</div></div>
        </section>
      </div>

      <footer id="metrics" className="strip strip--metrics" />
    </div>
  );
}
