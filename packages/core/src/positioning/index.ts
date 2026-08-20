/**
 * The positioning engine: signal strengths in, venue positions out.
 *
 * Exported as its own subpath (`@crowdflow/core/positioning`) rather than through
 * the package root, and that is a load-bearing detail. This code is the only part
 * of core that runs on a handset, so Metro resolves this directory and nothing
 * else — no `node:crypto` from the participation sketches, no simulation engine
 * pulling a thousand agents into a phone bundle. The package root stays the
 * server's entry point; this is the phone's.
 *
 * Nothing here touches a radio, a clock or a network. Every function takes its
 * time as an argument, which is what makes a walk across a circuit testable in
 * milliseconds and reproducible from a seed.
 */

export * from './geo.js';
export * from './pathloss.js';
export * from './solve.js';
export * from './anchors.js';
export * from './fuse.js';
export * from './track.js';
export * from './survey.js';
