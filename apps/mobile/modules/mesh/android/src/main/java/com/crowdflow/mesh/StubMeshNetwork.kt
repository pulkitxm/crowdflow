package com.crowdflow.mesh

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

class StubMeshNetwork : MeshNetwork {

    private val peers = MutableStateFlow<List<MeshPeer>>(emptyList())
    private val received = MutableSharedFlow<MeshMessage>(extraBufferCapacity = 64)
    private val mutex = Mutex()

    private val seen = LinkedHashMap<String, Long>()

    val sent = mutableListOf<Pair<String, MeshMessage>>()

    private var running = false

    override val isRunning: Boolean get() = running
    override val isOnline: Boolean get() = false

    fun start() { running = true }

    fun stop() { running = false }

    fun addPeer(peer: MeshPeer) { peers.value = peers.value + peer }

    suspend fun receive(message: MeshMessage) { received.emit(message) }

    override fun discoverPeers(): Flow<List<MeshPeer>> = peers.asStateFlow()

    override suspend fun getNearbyNodes(): List<MeshPeer> = peers.value

    override suspend fun connectPeer(nodeId: String) {
        requireRunning()
        requirePeer(nodeId)
    }

    override suspend fun disconnectPeer(nodeId: String) {
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
            expireSeen(message.timestampMs)
            if (seen.putIfAbsent(message.key, message.timestampMs) != null) {
                throw MeshError.Duplicate(message.key)
            }
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
        private const val DEDUPE_RETENTION_MS = 40_000L
    }
}
