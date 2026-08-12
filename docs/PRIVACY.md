# Privacy boundary

A CrowdFlow node represents local crowd state, not a person identity.

Collected and transmitted: rotating random node ID, venue-relative position/accuracy, speed, direction, current venue zone, nearby anonymous density, and confidence.

Never collected or transmitted: name, phone, email, accounts, contacts, IMEI, Android ID, advertising ID, or stable Bluetooth/Wi-Fi identifiers.

Geographic coordinates exist only in the Expo location driver long enough to transform them into venue metres. Transport-native peer addresses are held only inside the relevant driver and mapped to random session handles before entering the mesh core. Telemetry history is not retained; the outage queue is bounded to 60 batches and 15 minutes in app-private cache storage.
