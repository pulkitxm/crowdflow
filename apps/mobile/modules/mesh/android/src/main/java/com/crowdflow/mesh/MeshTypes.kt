package com.crowdflow.mesh


enum class MeshTransport { WIFI_AWARE, WIFI_DIRECT, BLE, UNKNOWN }

enum class MeshTrafficClass { STATE, UPLINK, URGENT }

data class MeshPeer(
    val nodeId: String,
    val epoch: Int,
    val transport: MeshTransport,
    val rssiDbm: Int?,
    val lastSeenMs: Long,
)

data class MeshMessage(
    val type: String,
    val trafficClass: MeshTrafficClass,
    val source: String,
    val sequence: Long,
    val ttl: Int,
    val timestampMs: Long,
    val payload: ByteArray,
) {
    val key: String get() = "$source:$sequence"

    val expired: Boolean get() = ttl <= 0

    fun hop(): MeshMessage = copy(ttl = maxOf(0, ttl - 1))

    override fun equals(other: Any?): Boolean = this === other
    override fun hashCode(): Int = System.identityHashCode(this)
}

sealed class MeshError(message: String) : Exception(message) {
    class NotStarted : MeshError("mesh service is not running; relaying requires the foreground service")
    class PeerGone(nodeId: String) : MeshError("peer $nodeId is no longer in range")
    class Expired : MeshError("message TTL is exhausted; it may be delivered locally but never relayed")
    class Duplicate(key: String) : MeshError("message $key has been seen before")
    class PermissionDenied(permission: String) : MeshError("missing permission: $permission")
    class TransportUnavailable : MeshError("no usable peer-to-peer transport on this handset")
}
