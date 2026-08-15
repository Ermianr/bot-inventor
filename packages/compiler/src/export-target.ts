/**
 * The Node.js an Export is compiled down to.
 *
 * It is the floor we support rather than the version the sidecar pins (ADR
 * 0002), because an Export runs on the user's own host, which we do not
 * control. Both the bot's own code and the Runtime vendored into it are built
 * against it, which is why it lives on its own rather than inside either.
 */
export const SINGLE_FILE_TARGET = "node20"
