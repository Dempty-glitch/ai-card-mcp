/**
 * lib/with-timeout.ts
 * Generic async timeout wrapper for MCP operations.
 *
 * Extensible usage:
 *   await withTimeout(fillCheckoutForm(url, card), 60_000, 'Checkout')
 *   await withTimeout(burnTokenRemote(token), 10_000, 'Burn')
 *   await withTimeout(resolveTokenRemote(token), 8_000, 'Resolve')
 *   await withTimeout(anyAsyncFn(), 5_000, 'MyOperation')
 */

export class TimeoutError extends Error {
    constructor(operationName: string, ms: number) {
        super(`[TIMEOUT] ${operationName} exceeded ${ms}ms hard cap`);
        this.name = 'TimeoutError';
    }
}

/**
 * Race an async operation against a hard deadline.
 * @param promise   The async operation to run
 * @param ms        Timeout in milliseconds
 * @param name      Human-readable name for error messages (default: 'Operation')
 * @param onTimeout Optional cleanup callback called on timeout
 */
export function withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    name: string = 'Operation',
    onTimeout?: () => void | Promise<void>
): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
        const timer = setTimeout(async () => {
            if (onTimeout) {
                try { await onTimeout(); } catch { /* ignore cleanup errors */ }
            }
            reject(new TimeoutError(name, ms));
        }, ms);

        // Allow Node.js to exit even if timer is pending
        if (timer.unref) timer.unref();
    });

    return Promise.race([promise, timeoutPromise]);
}
