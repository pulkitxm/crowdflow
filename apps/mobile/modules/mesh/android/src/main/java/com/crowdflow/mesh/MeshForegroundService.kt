package com.crowdflow.mesh

import android.app.Service
import android.content.Intent
import android.os.IBinder

/**
 * The relay loop's host process. Documented stub — the lifecycle and the reasons
 * are the deliverable here; the radio work lands when a real [MeshNetwork]
 * implementation does.
 *
 * ## Why a foreground service and not a JS timer
 *
 * The JS runtime suspends when the app backgrounds — on Android the JS thread is
 * paused within seconds of the screen locking. At a race, almost every phone is
 * in a pocket with the screen off. That is not an edge case, it is the steady
 * state of the entire mesh, and a node that stops relaying when the screen locks
 * is not a node: it is a handset that occasionally helps while someone happens to
 * be looking at it.
 *
 * A foreground service is the only thing Android will let do sustained radio work
 * without being killed, and the persistent notification it requires is not a tax
 * to be minimised away. Someone else's data is being carried on this battery. The
 * user is entitled to see that, and to stop it in one tap — which is why
 * [ACTION_STOP] exists and why the notification is not marked ongoing-and-silent.
 *
 * ## What it must NOT do
 *
 * Decide anything. Copy counts, custodian choice, buffer eviction and TTL policy
 * live in `crowdflow_core.mesh`, where a hundred and fifty imaginary phones can
 * falsify them. This service pumps the loop and owns the notification.
 *
 * ## Lifecycle sketch
 *
 * ```
 * onCreate           acquire transport, create the notification channel
 * onStartCommand     START_STICKY; startForeground within 5s or Android kills us
 * relay loop         discoverPeers -> for each peer: offer, respecting TTL+dedupe
 * onDestroy          release the transport; do NOT rely on this being called
 * ```
 *
 * Two things a real implementation has to get right and will not get for free:
 *
 *  - **Doze and app standby.** A foreground service survives Doze, but network
 *    access from one is still restricted on some OEM builds. Measure on the
 *    handsets that will actually be at the circuit, not on a Pixel.
 *  - **Battery honesty.** The relay duty cycle must be bounded by the routing
 *    layer's own rate limits, not by hoping the crowd is small. The copy bounds
 *    exist so this service's cost is knowable before the event rather than
 *    discovered during it.
 */
class MeshForegroundService : Service() {

    companion object {
        const val CHANNEL_ID = "crowdflow.mesh"
        const val NOTIFICATION_ID = 1
        const val ACTION_START = "com.crowdflow.mesh.START"

        /** The user stopping the mesh from the notification. Must work instantly
         *  and must not be quietly restarted; consent that cannot be withdrawn
         *  is not consent. */
        const val ACTION_STOP = "com.crowdflow.mesh.STOP"
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // A real implementation calls startForeground(NOTIFICATION_ID, ...)
        // here, within five seconds, or the process is killed.
        //
        // START_STICKY rather than START_NOT_STICKY: if the OS reclaims us under
        // memory pressure, the mesh should come back. A node that leaves and does
        // not return is worse than one that never joined, because the crowd it
        // was covering has already been counted as covered.
        return START_STICKY
    }
}
