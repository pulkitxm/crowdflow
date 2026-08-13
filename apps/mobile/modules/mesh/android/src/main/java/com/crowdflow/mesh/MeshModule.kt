package com.crowdflow.mesh

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The Expo bridge: the narrow window through which JS sees the mesh.
 *
 * It is deliberately thin, and the thinness is the design. Everything exposed
 * here is either a fact JS needs to render (are we running, how many peers, are
 * we online) or an action a user took (start, stop, send). Nothing about
 * transports crosses — no scan intervals, no connection states, no Wi-Fi Aware
 * session handles. A JS caller cannot tell which radio carried a byte, and that
 * is what keeps the app from growing per-handset special cases that nobody can
 * test.
 *
 * `network` is a [StubMeshNetwork] until a real transport exists. The swap is a
 * one-line change here and invisible everywhere else, which is the whole point
 * of having an interface rather than a class.
 *
 * Note what is NOT bridged: relayMessage. Relaying is driven by the foreground
 * service, not by JS, because the JS runtime is suspended for most of the event.
 * Exposing it would invite a caller to drive the mesh from a component's
 * useEffect, which works beautifully in a demo with the screen on and covers
 * almost nobody at a race.
 */
class MeshModule : Module() {

    private val network: MeshNetwork = StubMeshNetwork()

    override fun definition() = ModuleDefinition {
        Name("Mesh")

        Events("onPeersChanged", "onMessage")

        AsyncFunction("start") {
            // A real implementation starts MeshForegroundService here and waits
            // for it to reach the foreground, rather than reporting success and
            // letting the caller believe in a mesh that is not running.
            (network as? StubMeshNetwork)?.start()
        }

        AsyncFunction("stop") {
            (network as? StubMeshNetwork)?.stop()
        }

        AsyncFunction("getStatus") {
            mapOf(
                "running" to network.isRunning,
                "peerCount" to network.getNearbyNodes().size,
                // Whether this handset can currently reach the internet, i.e.
                // whether it is eligible to be elected uplink. An observation
                // that flips as the cell saturates, never a setting.
                "online" to false,
            )
        }

        AsyncFunction("getNearbyNodes") {
            network.getNearbyNodes().map { peer ->
                mapOf(
                    "nodeId" to peer.nodeId,
                    "epoch" to peer.epoch,
                    "transport" to peer.transport.name.lowercase(),
                    "rssiDbm" to peer.rssiDbm,
                    "lastSeenMs" to peer.lastSeenMs,
                )
            }
        }
    }
}
