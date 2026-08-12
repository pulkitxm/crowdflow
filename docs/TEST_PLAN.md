# Physical mesh test plan

1. Install the same development build on two phones and grant every requested permission.
2. Confirm each phone advertises and sees the other's rotating ID over BLE.
3. Confirm mDNS/UDP discovery on shared Wi-Fi and Wi-Fi Direct discovery on Android.
4. Send the same packet on BLE and Wi-Fi; verify receive count increments twice but handled/relay behavior occurs once and duplicate drops increments.
5. Add a third phone: A sends with TTL 4, B relays after jitter with TTL 3, C handles once.
6. Repeat an identical `(source, sequence)` and verify it is dropped.
7. Inject a 30% reroute across a large test ID set; then validate one or two selected phones manually.
8. Inject an emergency reroute and verify every phone obeys.
9. Let a reroute expire and verify normal route restoration.
10. Disable gateway internet only. Mesh/local routing remain active; telemetry buffers. Restore internet and verify replay/restored status.
11. Inspect uploaded JSON and packed packets for forbidden identifiers.
