package com.crowdflow.mesh

import android.content.Intent
import androidx.core.content.ContextCompat
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import android.util.Base64
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

class MeshModule : Module() {

    private val network: MeshNetwork = StubMeshNetwork()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun definition() = ModuleDefinition {
        Name("Mesh")
        Events("onPeersChanged", "onMessage")

        OnCreate {
            scope.launch {
                network.discoverPeers().collectLatest { peers ->
                    sendEvent("onPeersChanged", mapOf("peers" to peers.map(::peerMap)))
                }
            }
            scope.launch {
                network.incoming().collect { message ->
                    sendEvent("onMessage", messageMap(message))
                }
            }
        }

        OnDestroy { scope.cancel() }

        AsyncFunction("start") {
            val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
            ContextCompat.startForegroundService(
                context,
                Intent(context, MeshForegroundService::class.java).setAction(
                    MeshForegroundService.ACTION_START
                ),
            )
            (network as? StubMeshNetwork)?.start()
        }

        AsyncFunction("stop") {
            val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
            context.startService(
                Intent(context, MeshForegroundService::class.java).setAction(
                    MeshForegroundService.ACTION_STOP
                ),
            )
            (network as? StubMeshNetwork)?.stop()
        }

        AsyncFunction("getStatus") {
            mapOf(
                "running" to network.isRunning,
                "peerCount" to network.getNearbyNodes().size,
                "online" to network.isOnline,
            )
        }

        AsyncFunction("getNearbyNodes") {
            network.getNearbyNodes().map(::peerMap)
        }

        AsyncFunction("connect") { nodeId: String ->
            network.connectPeer(nodeId)
        }

        AsyncFunction("disconnect") { nodeId: String ->
            network.disconnectPeer(nodeId)
        }

        AsyncFunction("send") { nodeId: String, raw: Map<String, Any?> ->
            network.sendMessage(nodeId, messageFrom(raw))
        }

        AsyncFunction("broadcast") { raw: Map<String, Any?> ->
            network.broadcast(messageFrom(raw))
        }
    }

    private fun peerMap(peer: MeshPeer): Map<String, Any?> = mapOf(
        "nodeId" to peer.nodeId,
        "epoch" to peer.epoch,
        "transport" to peer.transport.name.lowercase(),
        "rssiDbm" to peer.rssiDbm,
        "lastSeenMs" to peer.lastSeenMs,
    )

    private fun messageMap(message: MeshMessage): Map<String, Any?> = mapOf(
        "type" to message.type,
        "trafficClass" to message.trafficClass.name.lowercase(),
        "source" to message.source,
        "sequence" to message.sequence,
        "ttl" to message.ttl,
        "timestampMs" to message.timestampMs,
        "payload" to Base64.encodeToString(message.payload, Base64.NO_WRAP),
    )

    private fun messageFrom(raw: Map<String, Any?>): MeshMessage {
        fun required(name: String): Any = raw[name]
            ?: throw IllegalArgumentException("mesh message missing $name")
        val payload = when (val value = required("payload")) {
            is String -> Base64.decode(value, Base64.DEFAULT)
            is ByteArray -> value
            is List<*> -> value.map { (it as Number).toByte() }.toByteArray()
            else -> throw IllegalArgumentException("mesh payload must be bytes or base64")
        }
        return MeshMessage(
            type = required("type") as String,
            trafficClass = MeshTrafficClass.valueOf(
                (required("trafficClass") as String).uppercase()
            ),
            source = required("source") as String,
            sequence = (required("sequence") as Number).toLong(),
            ttl = (required("ttl") as Number).toInt(),
            timestampMs = (required("timestampMs") as Number).toLong(),
            payload = payload,
        )
    }
}
