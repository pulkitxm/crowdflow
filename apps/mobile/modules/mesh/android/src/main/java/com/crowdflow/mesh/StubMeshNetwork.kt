package com.crowdflow.mesh

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * An in-memory [MeshNetwork] that talks to nobody.
 *
 * This transport is intentionally in-memory: writing a
 * real Wi-Fi Aware implementation before the routing logic has been measured
 * would be building the expensive half first. The protocol comparison in
 * `@crowdflow/core` — delivery ratio, hop count and copies-per-message for
 * each of the three traffic classes — runs today with no devices at all, and it
 * is what decides whether any of this deserves a radio. When it does, a real
 * implementation slots in behind the same interface and nothing above it changes.
 *
 * What it is genuinely useful for:
 *
 *  - wiring the app up end to end without a second handset in the room
 *  - proving that the layers above never learned which transport won: everything
 *    works against this, and this has no transport
 *  - enforcing the dedupe and TTL rules in a place where they are easy to test,
 *    so a real implementation has something to be checked against
 *
 * What it must never be mistaken for: it reports [MeshTransport.UNKNOWN] and an
 * empty peer list, and [isRunning] is false until [start] is called, so a caller
 * that assumed a working mesh finds out immediately rather than at a race.
 */
class StubMeshNetwork : MeshNetwork {

    private val peers = MutableStateFlow<List<MeshPeer>>(emptyList())
    private val received = MutableSharedFlow<MeshMessage>(extraBufferCapacity = 64)
    private val mutex = Mutex()

    /** (source, sequence) seen before. Enforced here so that the rule has a
     *  reference implementation the real transport can be tested against. */
    private val seen = LinkedHashMap<String, Long>()

    /** Everything this stub was asked to transmit, for assertions in tests. */
    val sent = mutableListOf<Pair<String, MeshMessage>>()

    private var running = false

    override val isRunning: Boolean get() = running
    override val isOnline: Boolean get() = false

    /** Stands in for the foreground service starting. */
    fun start() { running = true }

    fun stop() { running = false }

    /** Inject a peer, so a test can have a crowd without having a crowd. */
    fun addPeer(peer: MeshPeer) { peers.value = peers.value + peer }

    /** Deliver a message as if a peer had sent it. */
    suspend fun receive(message: MeshMessage) { received.emit(message) }

    override fun discoverPeers(): Flow<List<MeshPeer>> = peers.asStateFlow()

    override suspend fun getNearbyNodes(): List<MeshPeer> = peers.value

    override suspend fun connectPeer(nodeId: String) {
        requireRunning()
        requirePeer(nodeId)
    }

    override suspend fun disconnectPeer(nodeId: String) {
        // Idempotent by contract: disconnecting a peer that has already walked
        // away is the normal case, not an error.
    }

    override suspend fun sendMessage(nodeId: String, message: MeshMessage) {
        requireRunning()
        requirePeer(nodeId)
        mutex.withLock { sent += nodeId to message }
    }

    override suspend fun broadcast(message: MeshMessage) {
        requireRunning()
        val targets = peers.value.map { it.nodeId }
        mutex.withLock { targets.forEach { sent += it to message } }
    }

    override suspend fun relayMessage(nodeId: String, message: MeshMessage) {
        requireRunning()
        requirePeer(nodeId)
        mutex.withLock {
            // Dedupe first: a duplicate costs nothing further whatever its TTL,
            // and refusing it here is the point of checking at every hop.
            expireSeen(message.timestampMs)
            if (seen.putIfAbsent(message.key, message.timestampMs) != null) {
                throw MeshError.Duplicate(message.key)
            }
            // Then TTL, and the hop is spent before the bytes leave.
            if (message.expired) throw MeshError.Expired()
            sent += nodeId to message.hop()
        }
    }

    override fun incoming(): Flow<MeshMessage> = received.asSharedFlow()

    private fun expireSeen(nowMs: Long) {
        val retentionMs = DEDUPE_RETENTION_MS
        seen.entries.removeAll { (_, seenAt) -> nowMs - seenAt > retentionMs }
    }

    private fun requireRunning() {
        if (!running) throw MeshError.NotStarted()
    }

    private fun requirePeer(nodeId: String) {
        if (peers.value.none { it.nodeId == nodeId }) throw MeshError.PeerGone(nodeId)
    }

    companion object {
        /** MESH_TTL_MAX * ASSUMED_HOP_LATENCY_S from the shared standards.
         * Kept native because dedupe must survive while JS is suspended. */
        private const val DEDUPE_RETENTION_MS = 40_000L
    }
}
