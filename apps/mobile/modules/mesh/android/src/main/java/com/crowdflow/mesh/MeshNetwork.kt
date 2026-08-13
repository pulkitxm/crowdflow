package com.crowdflow.mesh

import kotlinx.coroutines.flow.Flow

/**
 * The transport boundary, and the only thing above it that is allowed to know a
 * radio exists.
 *
 * Implementations hide Wi-Fi Aware, Wi-Fi Direct and BLE behind these seven
 * methods. Which one is in use depends on the handset, the OS version, the OEM's
 * power policy and what the radio is already doing — it differs between two
 * phones standing next to each other and changes mid-event. None of that may
 * leak upward, because every caller that learned about it would grow a special
 * case, and those special cases would be wrong on the handsets nobody tested.
 *
 * What this interface deliberately does NOT do:
 *
 *  - choose a route (there are no routes; there is a peer in front of you)
 *  - decide how many copies a message deserves
 *  - decide whether a peer is a good custodian
 *  - decide what to keep when the buffer is full
 *
 * All four are routing decisions, all four live in `crowdflow_core.mesh`, and
 * all four are measured there against a simulated crowd. Reimplementing any of
 * them here would put the logic in the one place it cannot be tested.
 *
 * ## Foreground service requirement
 *
 * Relaying requires [MeshForegroundService] to be running. The JS runtime
 * suspends when the app backgrounds, and at a race almost every phone is in a
 * pocket with the screen off — a node that stops relaying when the screen locks
 * is not a node. Implementations must throw [MeshError.NotStarted] rather than
 * silently degrading into a foreground-only relay, because a mesh that quietly
 * covers a third of the crowd looks exactly like one that covers all of it.
 *
 * ## Threading
 *
 * All methods are `suspend` or return a [Flow]. None of them may be called on the
 * main thread, and none of them block: peer discovery over BLE takes seconds, and
 * a blocking discovery call is an ANR waiting for a busy stadium.
 */
interface MeshNetwork {

    /** Whether the foreground service is running and a transport is available. */
    val isRunning: Boolean

    /**
     * Continuously discover peers in range.
     *
     * A [Flow] rather than a one-shot list because "who is nearby" is never a
     * question with an answer — it is a stream, and a crowd changes it every few
     * seconds. Collecting the flow starts discovery; cancelling it stops the
     * radio, which matters: continuous scanning is the most expensive thing this
     * module can do to a battery.
     *
     * Emits the full current peer set on every change, not deltas. Deltas would
     * be smaller and would require every caller to maintain state that the
     * transport already has, and to get it wrong when an emission is missed.
     */
    fun discoverPeers(): Flow<List<MeshPeer>>

    /**
     * Peers currently in range, as of the last discovery pass.
     *
     * A snapshot for callers that need one now (an uplink election, a
     * predictability update). It may be stale by up to one discovery interval,
     * which is why [MeshPeer.lastSeenMs] exists — a caller that ignores it will
     * eventually send to someone who has walked away.
     */
    suspend fun getNearbyNodes(): List<MeshPeer>

    /**
     * Establish a link to a peer, if the transport needs one.
     *
     * Some transports are connectionless and this is a no-op; others require
     * negotiation that takes seconds. The distinction is exactly what this
     * interface exists to hide, so callers must treat this as always necessary
     * and always slow.
     */
    suspend fun connectPeer(nodeId: String)

    /**
     * Tear down a link. Idempotent.
     *
     * Worth calling promptly. Held links keep radios awake, and the battery cost
     * of a forgotten connection is paid by a spectator who never agreed to be
     * infrastructure.
     */
    suspend fun disconnectPeer(nodeId: String)

    /**
     * Send to one specific peer.
     *
     * Used by the routing layer once it has already decided this peer should
     * have this message. The transport does not second-guess that decision; it
     * either delivers or throws.
     */
    suspend fun sendMessage(nodeId: String, message: MeshMessage)

    /**
     * Send to every peer currently in range.
     *
     * The expensive one, and the reason [MeshMessage.trafficClass] exists.
     * Broadcasting is correct only for URGENT traffic, which is rate-limited by
     * the routing layer precisely because this method is affordable only when it
     * is rare. It is exposed rather than hidden so that the cost is visible at
     * the call site.
     */
    suspend fun broadcast(message: MeshMessage)

    /**
     * Relay a message received from someone else.
     *
     * Separate from [sendMessage] because the rules differ, and because a single
     * method would let a caller relay something without spending a hop.
     * Implementations MUST, in this order:
     *
     *  1. reject a duplicate `(source, sequence)` with [MeshError.Duplicate] —
     *     checked here, at every hop, not at the destination, because the
     *     transmission is what costs battery and the destination cannot refund it;
     *  2. reject an exhausted TTL with [MeshError.Expired];
     *  3. decrement the TTL BEFORE transmitting, via [MeshMessage.hop].
     *
     * A message that arrives with TTL 0 has still arrived. If this node is the
     * destination it is delivered locally; it is simply never relayed onward.
     */
    suspend fun relayMessage(nodeId: String, message: MeshMessage)

    /** Messages received from peers, including ones this node must relay onward. */
    fun incoming(): Flow<MeshMessage>
}
