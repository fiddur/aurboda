package net.aurboda

/** A destination reachable from the "More" hub. */
sealed interface MoreDestination {
    /**
     * A web page rendered in an embedded WebView: a site path on the user's own
     * server (e.g. "/timeline"), or an absolute URL for a page hosted on another
     * Aurboda instance (a challenge widget deep link to a joined remote challenge).
     */
    data class Web(val path: String) : MoreDestination

    /** The native live-sensor (BLE) screen. */
    data object Live : MoreDestination

    /** The native account / server-URL screen. */
    data object Account : MoreDestination
}
