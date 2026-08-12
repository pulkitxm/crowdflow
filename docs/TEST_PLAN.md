# Physical mesh test plan

1. Install the same development build on two phones. Start each node once and confirm the location, motion, Bluetooth, and nearby-Wi-Fi permission prompts occur serially; grant all requested permissions.
2. Confirm each phone advertises and sees the other's rotating ID over BLE, then stop/restart the app runtime and repeat discovery.
3. Confirm mDNS/UDP discovery on shared Wi-Fi and Wi-Fi Direct discovery, group formation, and bidirectional message exchange on Android.
4. Send the same packet on BLE and Wi-Fi; verify receive count increments twice but handled/relay behavior occurs once and duplicate drops increments.
5. Add a third phone: A sends with TTL 4, B relays after jitter with TTL 3, C handles once.
6. Repeat an identical `(source, sequence)` and verify it is dropped.
7. Inject a 30% reroute across a large test ID set; then validate one or two selected phones manually.
8. Inject an emergency reroute and verify every phone obeys.
9. Let a reroute expire and verify normal route restoration.
10. Disable gateway internet only. Mesh/local routing remain active; telemetry buffers. Restore internet and verify immediate replay and a visible two-second RESTORED state.
11. Enable gateway mode; verify `GET /health`, valid `POST /broadcast`, duplicate retry behavior, malformed-body 400, unknown-route 404, and unavailable-radio 503 responses.
12. Turn Bluetooth or Wi-Fi off and on. Verify diagnostics report the failure, the other radio continues, and the recovered transport restarts without duplicate listeners.
13. Inspect uploaded JSON, packed packets, and the merged Android manifest for forbidden identifiers and inaccurate `neverForLocation` declarations.
