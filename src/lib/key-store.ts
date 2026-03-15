// key-store.ts
// Shared, mutable in-memory store for the Passport Key (Z_ZERO_API_KEY).
// All API backends (custodial + WDK) import getPassportKey() from here
// so a single set_api_key MCP tool updates the key for ALL backends at once.
//
// Thread-safety: Node.js is single-threaded. Module-level `let` is safe.

let _passportKey: string = process.env.Z_ZERO_API_KEY || "";

/** Read the current active Passport Key. */
export function getPassportKey(): string {
    return _passportKey;
}

/**
 * Replace the active Passport Key in memory (no restart needed).
 * @param newKey - must start with "zk_live_" or "zk_test_"
 * @returns true if the key looks valid, false if rejected
 */
export function setPassportKey(newKey: string): { ok: boolean; message: string } {
    const trimmed = newKey.trim();
    if (!trimmed) {
        return { ok: false, message: "Key cannot be empty." };
    }
    if (!trimmed.startsWith("zk_live_") && !trimmed.startsWith("zk_test_")) {
        return { ok: false, message: `Invalid key format — must start with "zk_live_" or "zk_test_". Got: "${trimmed.slice(0, 12)}..."` };
    }
    _passportKey = trimmed;
    // ✅ FIX 11: Don't log partial key — even 10 chars helps brute-force
    console.error(`[KEY-STORE] ✅ Passport Key updated successfully.`);
    return { ok: true, message: `Passport Key updated successfully. Active key prefix: ${trimmed.slice(0, 10)}...` };
}

/** Check if a key is currently configured. */
export function hasPassportKey(): boolean {
    return _passportKey.length > 0;
}
