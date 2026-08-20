/**
 * The stand-in for a native module that does not exist on this platform.
 *
 * `react-native-wifi-reborn` and `react-native-ble-plx` have no web
 * implementation, and Metro resolves `require` statically — so the lazy require
 * in `wifi.ts` and `ble.ts`, which is what lets a native build omit them, does
 * not keep them out of a web bundle. Both resolve here on web instead.
 *
 * Exporting nothing is the whole implementation. The adapters check for the
 * function they need, do not find it, and report the rung unavailable in the
 * same words they use on a device that lacks the module — which is the correct
 * description of a browser.
 */
module.exports = {};
