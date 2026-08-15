import React from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  Sequence,
  interpolate,
  random,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export const FPS = 30;
export const DURATION_FRAMES = 2700;

const C = {
  bg: "#090c12",
  surface: "#151922",
  surface2: "#20252f",
  border: "#333946",
  text: "#f1f3f6",
  muted: "#98a0ad",
  red: "#ff1834",
  cyan: "#13d8f4",
  green: "#28dd8b",
  amber: "#ffb020",
};

const S = {
  sans: "Barlow, Arial, sans-serif",
  display: "Chakra Petch, Arial Narrow, sans-serif",
  mono: "IBM Plex Mono, monospace",
};

const FONT_FACES = `
@font-face { font-family: Barlow; src: url('${staticFile("video/fonts/Barlow-Regular.ttf")}'); font-weight: 400; }
@font-face { font-family: Barlow; src: url('${staticFile("video/fonts/Barlow-SemiBold.ttf")}'); font-weight: 600; }
@font-face { font-family: 'Chakra Petch'; src: url('${staticFile("video/fonts/ChakraPetch-SemiBold.ttf")}'); font-weight: 600; }
@font-face { font-family: 'Chakra Petch'; src: url('${staticFile("video/fonts/ChakraPetch-Bold.ttf")}'); font-weight: 700; }
@font-face { font-family: 'IBM Plex Mono'; src: url('${staticFile("video/fonts/IBMPlexMono-Regular.ttf")}'); font-weight: 400; }
`;

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

const fadeFor = (frame: number, duration: number, edge = 16) =>
  interpolate(frame, [0, edge, duration - edge, duration], [0, 1, 1, 0], clamp);

const localProgress = (frame: number, duration: number) =>
  interpolate(frame, [0, duration], [0, 1], clamp);

const GridBackground: React.FC<{ opacity?: number }> = ({ opacity = 1 }) => (
  <AbsoluteFill
    style={{
      backgroundColor: C.bg,
      backgroundImage:
        "linear-gradient(rgba(73,81,97,.20) 1px, transparent 1px), linear-gradient(90deg, rgba(73,81,97,.20) 1px, transparent 1px), radial-gradient(circle at 72% 26%, rgba(255,24,52,.08), transparent 37%), radial-gradient(circle at 18% 80%, rgba(19,216,244,.05), transparent 34%)",
      backgroundSize: "56px 56px, 56px 56px, 100% 100%, 100% 100%",
      opacity,
    }}
  />
);

const BrandMark: React.FC<{ compact?: boolean }> = ({ compact = false }) => (
  <div style={{ display: "flex", alignItems: "center", gap: compact ? 12 : 18 }}>
    <div
      style={{
        width: compact ? 8 : 11,
        height: compact ? 36 : 50,
        borderRadius: 2,
        background: C.red,
        transform: "skew(-38deg)",
        boxShadow: "0 0 28px rgba(255,24,52,.3)",
      }}
    />
    <div>
      <div
        style={{
          fontFamily: S.display,
          fontSize: compact ? 25 : 39,
          lineHeight: 1,
          fontWeight: 600,
          letterSpacing: 0.8,
        }}
      >
        CROWD FLOW OPTIMISER
      </div>
      {!compact && (
        <div
          style={{
            marginTop: 9,
            color: C.muted,
            fontFamily: S.mono,
            fontSize: 13,
            letterSpacing: 4.4,
          }}
        >
          SENSE · PREDICT · REROUTE
        </div>
      )}
    </div>
  </div>
);

const Chrome: React.FC<{ chapter: string }> = ({ chapter }) => (
  <>
    <div
      style={{
        position: "absolute",
        left: 62,
        top: 44,
        display: "flex",
        alignItems: "center",
        gap: 20,
        zIndex: 20,
      }}
    >
      <BrandMark compact />
      <div style={{ width: 1, height: 30, background: C.border }} />
      <div style={{ color: C.muted, fontFamily: S.mono, fontSize: 13, letterSpacing: 3.2 }}>
        {chapter.toUpperCase()}
      </div>
    </div>
    <div
      style={{
        position: "absolute",
        right: 62,
        top: 50,
        zIndex: 20,
        border: `1px solid ${C.border}`,
        borderRadius: 999,
        padding: "8px 15px",
        color: C.text,
        fontFamily: S.mono,
        fontSize: 12,
        letterSpacing: 1.8,
        background: "rgba(9,12,18,.78)",
      }}
    >
      <span style={{ color: C.green }}>●</span>&nbsp;&nbsp;LIVE MODEL
    </div>
  </>
);

const Scene: React.FC<{
  duration: number;
  chapter: string;
  children: React.ReactNode;
  chrome?: boolean;
}> = ({ duration, chapter, children, chrome = true }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ opacity: fadeFor(frame, duration), overflow: "hidden", color: C.text }}>
      <GridBackground />
      {chrome && <Chrome chapter={chapter} />}
      {children}
    </AbsoluteFill>
  );
};

const Eyebrow: React.FC<{ children: React.ReactNode; color?: string }> = ({
  children,
  color = C.red,
}) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 12,
      color,
      fontFamily: S.mono,
      fontSize: 14,
      letterSpacing: 4.2,
      textTransform: "uppercase",
      fontWeight: 600,
    }}
  >
    <span style={{ width: 36, height: 3, background: color, display: "inline-block" }} />
    {children}
  </div>
);

const BigTitle: React.FC<{
  children: React.ReactNode;
  size?: number;
  width?: number | string;
}> = ({ children, size = 82, width = 1200 }) => (
  <div
    style={{
      marginTop: 20,
      maxWidth: width,
      fontFamily: S.display,
      fontWeight: 700,
      fontSize: size,
      lineHeight: 0.98,
      letterSpacing: -2.2,
      textTransform: "uppercase",
    }}
  >
    {children}
  </div>
);

const Panel: React.FC<{
  children: React.ReactNode;
  style?: React.CSSProperties;
  accent?: string;
}> = ({ children, style, accent }) => (
  <div
    style={{
      position: "relative",
      border: `1px solid ${C.border}`,
      borderRadius: 12,
      background: "rgba(21,25,34,.94)",
      boxShadow: "0 18px 60px rgba(0,0,0,.25)",
      overflow: "hidden",
      ...style,
    }}
  >
    {accent && (
      <div style={{ position: "absolute", inset: "0 auto 0 0", width: 4, background: accent }} />
    )}
    {children}
  </div>
);

const AnimatedCounter: React.FC<{
  to: number;
  suffix?: string;
  decimals?: number;
  color?: string;
}> = ({ to, suffix = "", decimals = 0, color = C.text }) => {
  const frame = useCurrentFrame();
  const value = interpolate(frame, [8, 64], [0, to], {
    ...clamp,
    easing: Easing.out(Easing.cubic),
  });
  return (
    <span style={{ color }}>
      {value.toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}
      {suffix}
    </span>
  );
};

const Caption: React.FC<{ text: string; accent?: string }> = ({ text, accent = C.red }) => {
  const frame = useCurrentFrame();
  const y = interpolate(frame, [8, 25], [16, 0], {
    ...clamp,
    easing: Easing.out(Easing.cubic),
  });
  const opacity = interpolate(frame, [6, 23], [0, 1], clamp);
  return (
    <div
      style={{
        position: "absolute",
        left: 70,
        bottom: 54,
        zIndex: 30,
        display: "flex",
        alignItems: "stretch",
        maxWidth: 1020,
        opacity,
        transform: `translateY(${y}px)`,
        border: `1px solid ${C.border}`,
        borderRadius: 9,
        background: "rgba(9,12,18,.92)",
        backdropFilter: "blur(12px)",
        boxShadow: "0 18px 50px rgba(0,0,0,.35)",
        overflow: "hidden",
      }}
    >
      <div style={{ width: 6, background: accent }} />
      <div
        style={{
          padding: "17px 25px 18px",
          fontFamily: S.display,
          textTransform: "uppercase",
          fontWeight: 600,
          fontSize: 28,
          letterSpacing: 0.5,
        }}
      >
        {text}
      </div>
    </div>
  );
};

const DemoFrame: React.FC<{
  src: string;
  duration: number;
  zoom?: number;
  panX?: number;
  panY?: number;
  darken?: number;
}> = ({ src, duration, zoom = 1.08, panX = 0, panY = 0, darken = 0 }) => {
  const frame = useCurrentFrame();
  const p = localProgress(frame, duration);
  const scale = interpolate(p, [0, 1], [1.025, zoom]);
  return (
    <AbsoluteFill style={{ overflow: "hidden", background: C.bg }}>
      <Img
        src={staticFile(`video/screens/${src}.png`)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `translate(${panX * p}px, ${panY * p}px) scale(${scale})`,
          transformOrigin: "center",
          filter: "saturate(1.04) contrast(1.02)",
        }}
      />
      {darken > 0 && <AbsoluteFill style={{ background: `rgba(9,12,18,${darken})` }} />}
      <div
        style={{
          position: "absolute",
          inset: 0,
          boxShadow: "inset 0 0 150px rgba(0,0,0,.42)",
          pointerEvents: "none",
        }}
      />
    </AbsoluteFill>
  );
};

const IntroScene: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const titleY = interpolate(frame, [0, 36], [55, 0], {
    ...clamp,
    easing: Easing.out(Easing.cubic),
  });
  const titleOpacity = interpolate(frame, [0, 28], [0, 1], clamp);
  const lineW = interpolate(frame, [15, 80], [0, 420], {
    ...clamp,
    easing: Easing.out(Easing.cubic),
  });
  const drift = interpolate(frame, [0, duration], [0, 45]);

  return (
    <Scene duration={duration} chapter="Product film" chrome={false}>
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(circle at 76% 48%, rgba(255,24,52,.16), transparent 24%), radial-gradient(circle at 23% 76%, rgba(19,216,244,.09), transparent 28%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          right: 45 - drift,
          top: 25,
          width: 980,
          height: 980,
          opacity: 0.25,
          transform: "rotate(-8deg)",
        }}
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              inset: 110 + i * 60,
              border: `1px solid ${i === 0 ? C.red : C.border}`,
              borderRadius: "48% 38% 52% 35%",
              transform: `rotate(${i * 9}deg)`,
            }}
          />
        ))}
      </div>
      <div
        style={{
          position: "absolute",
          left: 138,
          top: 174,
          width: 1380,
          opacity: titleOpacity,
          transform: `translateY(${titleY}px)`,
        }}
      >
        <BrandMark />
        <div style={{ marginTop: 78 }}>
          <Eyebrow>Problem statement 03</Eyebrow>
          <BigTitle size={106} width={1320}>
            Safer movement,
            <br />
            <span style={{ color: C.red }}>before pressure peaks.</span>
          </BigTitle>
          <div style={{ marginTop: 34, width: lineW, height: 4, background: C.red }} />
          <div
            style={{
              marginTop: 27,
              color: C.muted,
              fontFamily: S.sans,
              fontSize: 27,
              lineHeight: 1.4,
              maxWidth: 910,
            }}
          >
            A live crowd intelligence platform for venues, events, and race-day operations.
          </div>
        </div>
      </div>
    </Scene>
  );
};

const ProblemScene: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const pulse = 1 + Math.sin(frame / 10) * 0.025;
  const cards = [
    { label: "ENTRY GATES", value: "28,437", note: "people queueing", color: C.red },
    { label: "CONCESSIONS", value: "14 MIN", note: "wait time rising", color: C.amber },
    { label: "EXITS", value: "11", note: "pressure points", color: C.red },
  ];
  return (
    <Scene duration={duration} chapter="The problem">
      <div style={{ position: "absolute", left: 110, top: 170, width: 890 }}>
        <Eyebrow>Pressure builds invisibly</Eyebrow>
        <BigTitle size={79} width={860}>
          Crowds bunch up
          <br />
          <span style={{ color: C.red }}>before teams can react.</span>
        </BigTitle>
        <p
          style={{
            width: 770,
            marginTop: 31,
            color: C.muted,
            fontFamily: S.sans,
            fontSize: 26,
            lineHeight: 1.48,
          }}
        >
          Disconnected signals make queues and density spikes hard to spot — especially during event
          surges.
        </p>
      </div>
      <div style={{ position: "absolute", right: 100, top: 165, width: 710 }}>
        {cards.map((card, i) => {
          const delay = 14 + i * 13;
          const x = interpolate(frame, [delay, delay + 25], [90, 0], {
            ...clamp,
            easing: Easing.out(Easing.cubic),
          });
          const opacity = interpolate(frame, [delay, delay + 20], [0, 1], clamp);
          return (
            <Panel
              key={card.label}
              accent={card.color}
              style={{
                height: 180,
                marginBottom: 22,
                padding: "27px 35px",
                opacity,
                transform: `translateX(${x}px)`,
              }}
            >
              <div style={{ color: C.muted, fontFamily: S.mono, fontSize: 13, letterSpacing: 3.3 }}>
                {card.label}
              </div>
              <div
                style={{
                  marginTop: 11,
                  color: card.color,
                  fontFamily: S.display,
                  fontSize: 54,
                  lineHeight: 1,
                  transform: i === 0 ? `scale(${pulse})` : undefined,
                  transformOrigin: "left center",
                }}
              >
                {card.value}
              </div>
              <div style={{ marginTop: 8, color: C.muted, fontFamily: S.sans, fontSize: 18 }}>
                {card.note}
              </div>
            </Panel>
          );
        })}
      </div>
    </Scene>
  );
};

const SolutionScene: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const items = [
    { num: "01", title: "MODEL", text: "Venue layout, attendance, and schedule", color: C.cyan },
    { num: "02", title: "DETECT", text: "Live density, queues, and bottlenecks", color: C.red },
    {
      num: "03",
      title: "REROUTE",
      text: "Safer paths sent to teams and spectators",
      color: C.green,
    },
  ];
  return (
    <Scene duration={duration} chapter="The solution">
      <div style={{ position: "absolute", left: 112, top: 155 }}>
        <Eyebrow color={C.cyan}>One operational picture</Eyebrow>
        <BigTitle size={73} width={1450}>
          From venue inputs to
          <br />
          <span style={{ color: C.cyan }}>actionable crowd guidance.</span>
        </BigTitle>
      </div>
      <div
        style={{
          position: "absolute",
          left: 112,
          right: 112,
          top: 500,
          display: "grid",
          gridTemplateColumns: "1fr 90px 1fr 90px 1fr",
          alignItems: "center",
        }}
      >
        {items.map((item, i) => {
          const start = 18 + i * 18;
          const y = interpolate(frame, [start, start + 27], [45, 0], {
            ...clamp,
            easing: Easing.out(Easing.cubic),
          });
          const opacity = interpolate(frame, [start, start + 23], [0, 1], clamp);
          return (
            <React.Fragment key={item.num}>
              <Panel
                accent={item.color}
                style={{
                  height: 300,
                  padding: "35px 38px",
                  opacity,
                  transform: `translateY(${y}px)`,
                }}
              >
                <div
                  style={{ color: item.color, fontFamily: S.mono, fontSize: 17, letterSpacing: 3 }}
                >
                  {item.num} / {item.title}
                </div>
                <div
                  style={{
                    marginTop: 42,
                    fontFamily: S.display,
                    fontSize: 34,
                    lineHeight: 1.18,
                    textTransform: "uppercase",
                  }}
                >
                  {item.text}
                </div>
                <div
                  style={{
                    position: "absolute",
                    right: 26,
                    bottom: 18,
                    color: `${item.color}20`,
                    fontFamily: S.display,
                    fontWeight: 700,
                    fontSize: 118,
                    lineHeight: 1,
                  }}
                >
                  {item.num}
                </div>
              </Panel>
              {i < items.length - 1 && (
                <div
                  style={{
                    height: 2,
                    background: `linear-gradient(90deg, ${item.color}, ${items[i + 1]!.color})`,
                    transformOrigin: "left",
                    transform: `scaleX(${interpolate(frame, [start + 24, start + 55], [0, 1], clamp)})`,
                  }}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </Scene>
  );
};

const InputsScene: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const feeds = [
    ["CAMERAS", "21", C.cyan],
    ["WI-FI / BLE", "13", C.green],
    ["TURNSTILES", "8", C.amber],
    ["WALKWAY LIDAR", "14", C.red],
    ["APP PINGS", "6", C.cyan],
  ] as const;
  return (
    <Scene duration={duration} chapter="Sense">
      <div style={{ position: "absolute", inset: 0 }}>
        <DemoFrame src="feeds" duration={duration} zoom={1.1} panY={-32} darken={0.38} />
      </div>
      <div style={{ position: "absolute", left: 105, top: 180, width: 720 }}>
        <Eyebrow color={C.green}>Multi-source inputs</Eyebrow>
        <BigTitle size={72} width={750}>
          Fuse every signal.
          <br />
          <span style={{ color: C.green }}>Trust the combined view.</span>
        </BigTitle>
        <p
          style={{
            marginTop: 28,
            color: C.muted,
            fontFamily: S.sans,
            fontSize: 25,
            lineHeight: 1.45,
          }}
        >
          Confidence and latency stay visible, so operators know what the model can see.
        </p>
      </div>
      <Panel
        style={{
          position: "absolute",
          right: 90,
          top: 190,
          width: 690,
          padding: "26px 30px",
          background: "rgba(9,12,18,.91)",
        }}
      >
        <div style={{ color: C.muted, fontFamily: S.mono, fontSize: 13, letterSpacing: 3.5 }}>
          LIVE SENSOR FUSION
        </div>
        <div style={{ marginTop: 16 }}>
          {feeds.map(([label, value, color], i) => {
            const width = interpolate(frame, [15 + i * 8, 70 + i * 8], [0, 100], clamp);
            return (
              <div key={label} style={{ marginBottom: 18 }}>
                <div style={{ display: "flex", alignItems: "baseline" }}>
                  <span style={{ fontFamily: S.display, fontSize: 22 }}>{label}</span>
                  <span style={{ marginLeft: "auto", color, fontFamily: S.mono, fontSize: 22 }}>
                    {value}
                  </span>
                </div>
                <div style={{ height: 5, marginTop: 8, borderRadius: 99, background: C.surface2 }}>
                  <div
                    style={{
                      height: "100%",
                      width: `${width}%`,
                      borderRadius: 99,
                      background: color,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
        <div
          style={{
            marginTop: 7,
            paddingTop: 18,
            borderTop: `1px solid ${C.border}`,
            display: "flex",
            color: C.muted,
            fontFamily: S.mono,
            fontSize: 13,
          }}
        >
          <span>62 DEVICES</span>
          <span style={{ marginLeft: "auto", color: C.green }}>94% COVERAGE</span>
        </div>
      </Panel>
    </Scene>
  );
};

const LiveMapScene: React.FC<{ duration: number }> = ({ duration }) => (
  <Scene duration={duration} chapter="Detect" chrome={false}>
    <DemoFrame src="live-map" duration={duration} zoom={1.095} panY={-18} />
    <Caption text="Density becomes a live heat layer" accent={C.red} />
    <Panel
      accent={C.red}
      style={{
        position: "absolute",
        right: 70,
        bottom: 54,
        width: 380,
        padding: "16px 22px",
        background: "rgba(9,12,18,.92)",
      }}
    >
      <div style={{ color: C.muted, fontFamily: S.mono, fontSize: 12, letterSpacing: 2.5 }}>
        ACTIVE BOTTLENECKS
      </div>
      <div style={{ marginTop: 4, fontFamily: S.display, fontSize: 34, color: C.red }}>
        <AnimatedCounter to={10} />
      </div>
    </Panel>
  </Scene>
);

const AlertsScene: React.FC<{ duration: number }> = ({ duration }) => (
  <Scene duration={duration} chapter="Predict" chrome={false}>
    <DemoFrame src="alerts" duration={duration} zoom={1.085} panX={-20} />
    <Caption text="Rank risk. Forecast 45 minutes ahead. Recommend action." accent={C.amber} />
  </Scene>
);

const ApproachScene: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const stages = [
    { title: "EVENT SCHEDULE", subtitle: "arrival curves + crowd magnets", color: C.amber },
    { title: "CAPACITY MODEL", subtitle: "zones + walkway throughput", color: C.red },
    { title: "LIVE STATE", subtitle: "occupancy + queue confidence", color: C.cyan },
    { title: "PATHFINDING", subtitle: "congestion-weighted graph", color: C.green },
  ];
  return (
    <Scene duration={duration} chapter="Approach">
      <div style={{ position: "absolute", left: 112, top: 160 }}>
        <Eyebrow color={C.cyan}>How the optimiser works</Eyebrow>
        <BigTitle size={69} width={1510}>
          A capacity-aware model,
          <br />
          <span style={{ color: C.cyan }}>grounded in the venue graph.</span>
        </BigTitle>
      </div>
      <div
        style={{
          position: "absolute",
          left: 116,
          right: 116,
          top: 515,
          display: "flex",
          alignItems: "center",
        }}
      >
        {stages.map((stage, i) => {
          const start = 15 + i * 14;
          const opacity = interpolate(frame, [start, start + 18], [0, 1], clamp);
          const scale = interpolate(frame, [start, start + 25], [0.9, 1], {
            ...clamp,
            easing: Easing.out(Easing.cubic),
          });
          return (
            <React.Fragment key={stage.title}>
              <Panel
                accent={stage.color}
                style={{
                  width: 344,
                  height: 238,
                  padding: "32px 30px",
                  opacity,
                  transform: `scale(${scale})`,
                }}
              >
                <div
                  style={{
                    color: stage.color,
                    fontFamily: S.mono,
                    fontSize: 13,
                    letterSpacing: 2.6,
                  }}
                >
                  STEP 0{i + 1}
                </div>
                <div
                  style={{ marginTop: 30, fontFamily: S.display, fontSize: 29, lineHeight: 1.1 }}
                >
                  {stage.title}
                </div>
                <div
                  style={{
                    marginTop: 14,
                    color: C.muted,
                    fontFamily: S.sans,
                    fontSize: 18,
                    lineHeight: 1.35,
                  }}
                >
                  {stage.subtitle}
                </div>
              </Panel>
              {i < stages.length - 1 && (
                <div
                  style={{
                    width: 62,
                    height: 2,
                    margin: "0 12px",
                    background: `linear-gradient(90deg, ${stage.color}, ${stages[i + 1]!.color})`,
                    position: "relative",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      right: -3,
                      top: -4,
                      width: 10,
                      height: 10,
                      borderTop: `2px solid ${stages[i + 1]!.color}`,
                      borderRight: `2px solid ${stages[i + 1]!.color}`,
                      transform: "rotate(45deg)",
                    }}
                  />
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </Scene>
  );
};

const RoutingScene: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const saved = interpolate(frame, [15, 65], [0, 2], {
    ...clamp,
    easing: Easing.out(Easing.cubic),
  });
  return (
    <Scene duration={duration} chapter="Reroute" chrome={false}>
      <DemoFrame src="routing" duration={duration} zoom={1.085} panX={-18} />
      <Caption text="Compare shortest with congestion-aware routing" accent={C.cyan} />
      <Panel
        accent={C.green}
        style={{
          position: "absolute",
          right: 75,
          bottom: 54,
          width: 360,
          padding: "16px 24px",
          background: "rgba(9,12,18,.93)",
        }}
      >
        <div style={{ color: C.muted, fontFamily: S.mono, fontSize: 12, letterSpacing: 2.5 }}>
          TIME SAVED
        </div>
        <div style={{ marginTop: 4, color: C.green, fontFamily: S.display, fontSize: 34 }}>
          −{saved.toFixed(1)} MIN
        </div>
      </Panel>
    </Scene>
  );
};

const ScenarioScene: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const split = duration / 2;
  const circuitOpacity =
    frame <= split ? 1 : interpolate(frame, [split, split + 18], [1, 0], clamp);
  const evacOpacity = interpolate(frame, [split - 18, split], [0, 1], clamp);
  return (
    <Scene duration={duration} chapter="Test scenarios" chrome={false}>
      <AbsoluteFill style={{ opacity: circuitOpacity }}>
        <DemoFrame src="circuits" duration={Math.ceil(split)} zoom={1.075} />
        <Caption text="Validate across different venue layouts" accent={C.cyan} />
      </AbsoluteFill>
      <AbsoluteFill style={{ opacity: evacOpacity }}>
        <DemoFrame src="evacuation" duration={Math.ceil(split)} zoom={1.07} />
        <Caption text="Stress-test closures and emergency clearance" accent={C.red} />
      </AbsoluteFill>
    </Scene>
  );
};

const SpectatorScene: React.FC<{ duration: number }> = ({ duration }) => (
  <Scene duration={duration} chapter="Guide" chrome={false}>
    <DemoFrame src="spectator" duration={duration} zoom={1.075} panX={-10} />
    <Caption text="Turn control-room decisions into quiet routes and nudges" accent={C.cyan} />
  </Scene>
);

const MeshScene: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const phones = [
    { x: 120, y: 175, label: "A7F2" },
    { x: 420, y: 70, label: "19BC" },
    { x: 680, y: 230, label: "D403" },
    { x: 325, y: 390, label: "6E21" },
    { x: 650, y: 500, label: "B8A5" },
  ];
  const links: [number, number][] = [
    [0, 1],
    [1, 2],
    [0, 3],
    [3, 4],
    [2, 4],
    [1, 3],
  ];
  const cycle = (frame % 54) / 54;
  return (
    <Scene duration={duration} chapter="Offline resilience">
      <div style={{ position: "absolute", left: 105, top: 165, width: 795 }}>
        <Eyebrow color={C.green}>Companion mesh</Eyebrow>
        <BigTitle size={74} width={790}>
          Guidance keeps moving
          <br />
          <span style={{ color: C.green }}>when the internet does not.</span>
        </BigTitle>
        <p
          style={{
            marginTop: 30,
            color: C.muted,
            fontFamily: S.sans,
            fontSize: 25,
            lineHeight: 1.48,
          }}
        >
          Nearby phones relay compact reroutes over Bluetooth and Wi-Fi — with rotating IDs and no
          personal identity on the wire.
        </p>
        <div style={{ display: "flex", gap: 14, marginTop: 32 }}>
          {["BLUETOOTH LE", "WI-FI", "ANONYMOUS"].map((label, i) => (
            <div
              key={label}
              style={{
                border: `1px solid ${i === 2 ? C.green : C.border}`,
                borderRadius: 999,
                padding: "10px 15px",
                color: i === 2 ? C.green : C.text,
                background: C.surface,
                fontFamily: S.mono,
                fontSize: 12,
                letterSpacing: 1.8,
              }}
            >
              {label}
            </div>
          ))}
        </div>
      </div>
      <Panel
        style={{
          position: "absolute",
          right: 92,
          top: 160,
          width: 790,
          height: 730,
          background: "rgba(15,19,27,.93)",
        }}
      >
        <svg width="790" height="730" viewBox="0 0 790 730">
          <defs>
            <filter id="glow">
              <feGaussianBlur stdDeviation="5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {links.map(([a, b], i) => {
            const p1 = phones[a]!;
            const p2 = phones[b]!;
            const length = Math.hypot(p2.x - p1.x, p2.y - p1.y);
            const dash = Math.max(
              0,
              interpolate(frame, [10 + i * 6, 60 + i * 6], [length, 0], clamp),
            );
            return (
              <line
                key={`${a}-${b}`}
                x1={p1.x + 20}
                y1={p1.y + 40}
                x2={p2.x + 20}
                y2={p2.y + 40}
                stroke={C.cyan}
                strokeWidth="2"
                strokeOpacity=".48"
                strokeDasharray={length}
                strokeDashoffset={dash}
              />
            );
          })}
          {links.map(([a, b], i) => {
            const p1 = phones[a]!;
            const p2 = phones[b]!;
            const t = (cycle + i * 0.19) % 1;
            return (
              <circle
                key={`packet-${a}-${b}`}
                cx={p1.x + 20 + (p2.x - p1.x) * t}
                cy={p1.y + 40 + (p2.y - p1.y) * t}
                r="5"
                fill={C.green}
                filter="url(#glow)"
              />
            );
          })}
          {phones.map((phone, i) => {
            const appear = interpolate(frame, [8 + i * 8, 30 + i * 8], [0, 1], clamp);
            return (
              <g key={phone.label} opacity={appear} transform={`translate(${phone.x} ${phone.y})`}>
                <rect
                  width="82"
                  height="132"
                  rx="14"
                  fill={C.surface2}
                  stroke={C.border}
                  strokeWidth="3"
                />
                <rect x="9" y="16" width="64" height="93" rx="6" fill={C.bg} />
                <path
                  d="M17 83 L31 68 L44 75 L64 48"
                  fill="none"
                  stroke={C.green}
                  strokeWidth="3"
                />
                <circle cx="41" cy="119" r="4" fill={C.muted} />
                <text
                  x="41"
                  y="43"
                  fill={C.text}
                  textAnchor="middle"
                  fontFamily={S.mono}
                  fontSize="11"
                >
                  {phone.label}
                </text>
                <text
                  x="41"
                  y="61"
                  fill={C.green}
                  textAnchor="middle"
                  fontFamily={S.mono}
                  fontSize="8"
                >
                  ROUTE RX
                </text>
              </g>
            );
          })}
        </svg>
        <div
          style={{
            position: "absolute",
            left: 26,
            right: 26,
            bottom: 24,
            display: "flex",
            paddingTop: 18,
            borderTop: `1px solid ${C.border}`,
            color: C.muted,
            fontFamily: S.mono,
            fontSize: 12,
            letterSpacing: 1.4,
          }}
        >
          <span>TTL MULTI-HOP RELAY</span>
          <span style={{ marginLeft: "auto", color: C.green }}>NO INTERNET REQUIRED</span>
        </div>
      </Panel>
    </Scene>
  );
};

const CopilotScene: React.FC<{ duration: number }> = ({ duration }) => (
  <Scene duration={duration} chapter="Explain" chrome={false}>
    <DemoFrame src="copilot" duration={duration} zoom={1.06} />
    <Caption text="Plain-language answers remain grounded in live state" accent={C.green} />
  </Scene>
);

const LoopScene: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const steps = [
    ["01", "SENSE", C.cyan],
    ["02", "PREDICT", C.amber],
    ["03", "REROUTE", C.red],
    ["04", "VERIFY", C.green],
  ] as const;
  return (
    <Scene duration={duration} chapter="Closed loop">
      <div style={{ position: "absolute", left: 112, top: 160 }}>
        <Eyebrow color={C.green}>Operational outcome</Eyebrow>
        <BigTitle size={76} width={1350}>
          Act before a crowd
          <br />
          <span style={{ color: C.green }}>becomes a crisis.</span>
        </BigTitle>
      </div>
      <div
        style={{
          position: "absolute",
          left: 155,
          right: 155,
          top: 560,
          display: "flex",
          alignItems: "center",
        }}
      >
        {steps.map(([num, label, color], i) => {
          const start = 12 + i * 15;
          const opacity = interpolate(frame, [start, start + 18], [0, 1], clamp);
          return (
            <React.Fragment key={label}>
              <div style={{ width: 300, textAlign: "center", opacity }}>
                <div
                  style={{
                    width: 128,
                    height: 128,
                    margin: "0 auto",
                    display: "grid",
                    placeItems: "center",
                    borderRadius: "50%",
                    border: `2px solid ${color}`,
                    boxShadow: `0 0 45px ${color}25`,
                    color,
                    background: C.surface,
                    fontFamily: S.display,
                    fontSize: 38,
                  }}
                >
                  {num}
                </div>
                <div
                  style={{ marginTop: 20, fontFamily: S.display, fontSize: 28, letterSpacing: 1.2 }}
                >
                  {label}
                </div>
              </div>
              {i < steps.length - 1 && (
                <div
                  style={{
                    flex: 1,
                    height: 2,
                    background: `linear-gradient(90deg, ${color}, ${steps[i + 1]![2]})`,
                  }}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </Scene>
  );
};

const EndScene: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 30], [0, 1], clamp);
  const scale = interpolate(frame, [0, 45], [0.96, 1], {
    ...clamp,
    easing: Easing.out(Easing.cubic),
  });
  return (
    <Scene duration={duration} chapter="CrowdFlow" chrome={false}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          textAlign: "center",
          opacity,
          transform: `scale(${scale})`,
        }}
      >
        <BrandMark />
        <div
          style={{
            marginTop: 70,
            fontFamily: S.display,
            fontSize: 88,
            lineHeight: 1,
            textTransform: "uppercase",
            fontWeight: 700,
          }}
        >
          Safer movement.
          <br />
          <span style={{ color: C.red }}>In real time.</span>
        </div>
        <div
          style={{
            marginTop: 52,
            padding: "13px 22px",
            border: `1px solid ${C.border}`,
            borderRadius: 999,
            background: C.surface,
            color: C.muted,
            fontFamily: S.mono,
            fontSize: 14,
            letterSpacing: 2.2,
          }}
        >
          vmax-grandprix.lovable.app
        </div>
      </div>
    </Scene>
  );
};

const DotField: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity: 0.3 }}>
      {Array.from({ length: 26 }).map((_, i) => {
        const left = random(`dot-x-${i}`) * 1920;
        const top =
          (random(`dot-y-${i}`) * 1080 + frame * (0.08 + random(`dot-s-${i}`) * 0.12)) % 1080;
        const size = 1 + random(`dot-z-${i}`) * 2;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left,
              top,
              width: size,
              height: size,
              borderRadius: "50%",
              background: i % 5 === 0 ? C.red : C.muted,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

export const CrowdFlowProductVideo: React.FC = () => {
  const { durationInFrames } = useVideoConfig();
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg, color: C.text, fontFamily: S.sans }}>
      <style>{FONT_FACES}</style>
      <Audio src={staticFile("video/audio/ambient-bed.mp3")} volume={0.12} />
      <Sequence from={30} durationInFrames={2525}>
        <Audio src={staticFile("video/audio/narration.mp3")} volume={1} />
      </Sequence>

      <Sequence from={0} durationInFrames={210}>
        <IntroScene duration={210} />
      </Sequence>
      <Sequence from={190} durationInFrames={240}>
        <ProblemScene duration={240} />
      </Sequence>
      <Sequence from={410} durationInFrames={230}>
        <SolutionScene duration={230} />
      </Sequence>
      <Sequence from={620} durationInFrames={255}>
        <InputsScene duration={255} />
      </Sequence>
      <Sequence from={855} durationInFrames={250}>
        <LiveMapScene duration={250} />
      </Sequence>
      <Sequence from={1085} durationInFrames={235}>
        <AlertsScene duration={235} />
      </Sequence>
      <Sequence from={1300} durationInFrames={240}>
        <ApproachScene duration={240} />
      </Sequence>
      <Sequence from={1520} durationInFrames={245}>
        <RoutingScene duration={245} />
      </Sequence>
      <Sequence from={1745} durationInFrames={240}>
        <ScenarioScene duration={240} />
      </Sequence>
      <Sequence from={1965} durationInFrames={225}>
        <SpectatorScene duration={225} />
      </Sequence>
      <Sequence from={2170} durationInFrames={260}>
        <MeshScene duration={260} />
      </Sequence>
      <Sequence from={2410} durationInFrames={120}>
        <CopilotScene duration={120} />
      </Sequence>
      <Sequence from={2510} durationInFrames={115}>
        <LoopScene duration={115} />
      </Sequence>
      <Sequence from={2605} durationInFrames={95}>
        <EndScene duration={95} />
      </Sequence>

      <DotField />
      <div
        style={{
          position: "absolute",
          left: 0,
          bottom: 0,
          width: `${interpolate(useCurrentFrame(), [0, durationInFrames], [0, 100], clamp)}%`,
          height: 3,
          background: C.red,
          boxShadow: "0 0 14px rgba(255,24,52,.5)",
          zIndex: 100,
        }}
      />
    </AbsoluteFill>
  );
};
