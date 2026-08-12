# CrowdFlow mesh protocol v1

All integers are big-endian. Maximum packet size is 255 bytes.

| Byte | Size | Field |
|---:|---:|---|
| 0 | 1 | protocol version (high nibble = 1) + type (low nibble) |
| 1 | 2 | rotating source ID |
| 3 | 2 | unsigned sequence |
| 5 | 1 | TTL, 1–8 (default 4) |
| 6 | 4 | Unix epoch seconds |
| 10 | variable | payload |

Types: `HELLO`, `PEER_DISCOVERY`, `STATE_UPDATE`, `ZONE_UPDATE`, `ROUTE_UPDATE`, `ALERT`, `REROUTE`, `ACK`, `HEARTBEAT`, `SYNC` map to codes 0–9.

## State update

Eight-byte payload (18 bytes including header):

- uint16 venue zone index
- uint8 density × 20
- uint8 velocity × 50
- uint8 direction / 2
- uint8 confidence × 255
- two reserved zero bytes

A source emits state at most every two seconds. Heartbeats are every ten seconds. Relays wait 0–200 ms, decrement TTL, and suppress repeats with `(source, sequence)` in a 512-entry LRU.

## Reroute

Variable packed payload: `expires_at`, fraction, priority, route ID, source/destination indices, avoid indices, preferred indices, and reason. `issued_at` is the envelope timestamp. Non-emergency compliance uses a stable hash of `node_id + route_id`; emergency commands bypass the fraction. Expired commands are ignored and active commands revert automatically at expiry.

## Radios

All available physical transports start concurrently:

- BLE rotating-ID beacon service `0000c0f1-0000-1000-8000-00805f9b34fb` (compact Bluetooth-base UUID)
- BLE mailbox service `c0f10001-7a6b-4a40-9c73-97d98db48a01`
- BLE mailbox characteristic `c0f10002-7a6b-4a40-9c73-97d98db48a01`
- mDNS service `_crowdflow._udp.local.` on UDP port 47317
- Android Wi-Fi Direct as a P2P fallback

Receiving one packet over Bluetooth and Wi-Fi is expected. Cross-radio repeats are processed once by the application-layer dedupe key.
