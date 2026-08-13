import React from "react";
import { Composition } from "remotion";
import { CrowdFlowProductVideo, DURATION_FRAMES, FPS } from "./CrowdFlowProductVideo";

export const VideoRoot: React.FC = () => (
  <Composition
    id="CrowdFlowProductVideo"
    component={CrowdFlowProductVideo}
    durationInFrames={DURATION_FRAMES}
    fps={FPS}
    width={1920}
    height={1080}
  />
);
