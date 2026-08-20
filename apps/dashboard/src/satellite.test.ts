import { describe, expect, it } from "vitest";

import { isLocalSatelliteUrl, satelliteAsset } from "./satellite";

describe("satellite imagery", () => {
  it("serves Silverstone imagery from the local application", () => {
    const asset = satelliteAsset("silverstone");
    expect(asset).not.toBeNull();
    expect(isLocalSatelliteUrl(asset!.url)).toBe(true);
    expect(asset!.url).not.toMatch(/^https?:/);
  });

  it("maps the image across the complete venue", () => {
    const asset = satelliteAsset("silverstone")!;
    expect(asset.topRight.x).toBeGreaterThan(2822.3);
    expect(asset.topLeft.x).toBeLessThan(-2095.6);
    expect(asset.topLeft.y).toBeGreaterThan(2893.1);
    expect(asset.bottomLeft.y).toBeLessThan(-1590.8);
  });

  it("does not substitute imagery for an unknown circuit", () => {
    expect(satelliteAsset("unknown")).toBeNull();
  });
});
