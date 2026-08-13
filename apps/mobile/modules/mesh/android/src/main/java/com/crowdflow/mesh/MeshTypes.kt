package com.crowdflow.mesh

/**
 * The wire types. These mirror the Pydantic contracts in
 * `packages/contracts/src/crowdflow_contracts/telemetry.py`, which are the single
 * source of truth — if the two disagree, this file is wrong.
 *
 * Deliberately dumb data classes. Nothing here decides anything; the routing
 * decisions live in `crowdflow_core.mesh` where they can be tested against a
 * simulated crowd rather than against whatever handsets happen to be in the room.
 */

/** Which transport actually carried a message. Diagnostic only. */
enum class MeshTransport { WIFI_AWARE, WIFI_DIRECT, BLE, UNKNOWN }

/**
 * Traffic class, which selects the routing policy upstream.
 *
 * The native layer treats these as opaque labels it must preserve — it does NOT
 * implement the policies. It is repeated here only so the label survives the
 * round trip; a transport that dropped it would force the receiving node to
 * guess, and a zone update flooded as if it were an alert costs a hundred times
 * the battery for no benefit.
 */
enum class MeshTrafficClass { STATE, UPLINK, URGENT }

/**
 * A peer currently in radio range.
 *
 * [nodeId] is a rotating pseudonym, not an identity. It is valid only within its
 * epoch and must never be joined across epochs — that rule is what makes the
 * mesh anonymous, and it is trivially broken by anything that caches peers by id
 * across a rotation.
 */
data class MeshPeer(
    val nodeId: String,
    val epoch: Int,
    val transport: MeshTransport,
    /** Signal strength in dBm, or null when the transport does not report it.
     *  Null rather than a sentinel: "unknown" and "very weak" are different
     *  facts and must not be averaged together. */
    val rssiDbm: Int?,
    /** Milliseconds since this peer was last heard from. Freshness, not presence
     *  — a peer object that outlives the peer is how a mesh sends into the void. */
    val lastSeenMs: Long,
)

/**
 * An envelope crossing the mesh. See `MeshMessage` in the contracts package.
 *
 * [ttl] and [sequence] are enforced at every hop and not only at the
 * destination, because the cost being avoided is the transmission, and a
 * transmission has already happened by the time a destination could object.
 */
data class MeshMessage(
    val type: String,
    val trafficClass: MeshTrafficClass,
    /** Rotating pseudonym of the originator. */
    val source: String,
    /** Per-source monotonic; the dedupe key, with [source]. */
    val sequence: Long,
    /** Hops remaining. Decremented by the relayer before transmission. */
    val ttl: Int,
    val timestampMs: Long,
    val payload: ByteArray,
) {
    /** Identity of the message, independent of which copy this is. */
    val key: String get() = "$source:$sequence"

    val expired: Boolean get() = ttl <= 0

    /** A new envelope with one hop spent. Originals are never mutated: two peers
     *  may be offered the same message in the same pass. */
    fun hop(): MeshMessage = copy(ttl = maxOf(0, ttl - 1))

    // ByteArray in a data class breaks structural equality; messages are
    // compared by [key] everywhere it matters, so the generated versions would
    // be a trap rather than a convenience.
    override fun equals(other: Any?): Boolean = this === other
    override fun hashCode(): Int = System.identityHashCode(this)
}

/** Why a send did not happen. Callers get a reason, never a bare false. */
sealed class MeshError(message: String) : Exception(message) {
    class NotStarted : MeshError("mesh service is not running; relaying requires the foreground service")
    class PeerGone(nodeId: String) : MeshError("peer $nodeId is no longer in range")
    class Expired : MeshError("message TTL is exhausted; it may be delivered locally but never relayed")
    class Duplicate(key: String) : MeshError("message $key has been seen before")
    class PermissionDenied(permission: String) : MeshError("missing permission: $permission")
    class TransportUnavailable : MeshError("no usable peer-to-peer transport on this handset")
}
