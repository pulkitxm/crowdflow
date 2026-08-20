package com.crowdflow.mesh

import kotlinx.coroutines.flow.Flow

interface MeshNetwork {

    val isRunning: Boolean

    val isOnline: Boolean

    fun discoverPeers(): Flow<List<MeshPeer>>

    suspend fun getNearbyNodes(): List<MeshPeer>

    suspend fun connectPeer(nodeId: String)

    suspend fun disconnectPeer(nodeId: String)

    suspend fun sendMessage(nodeId: String, message: MeshMessage)

    suspend fun broadcast(message: MeshMessage)

    suspend fun relayMessage(nodeId: String, message: MeshMessage)

    fun incoming(): Flow<MeshMessage>
}
