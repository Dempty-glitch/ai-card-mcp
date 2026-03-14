// web3-detector.ts
// Phase 2: Smart Routing — Web3 Payment Detector
// Injects a mock window.ethereum into a checkout page, waits for Web3 tx request.
// If the page calls eth_sendTransaction → capture params and return them.
// If page is not Web3-aware → return null (caller falls back to Fiat JIT card).

import { chromium } from "playwright";

export interface Web3TxParams {
    to: string;          // recipient address (merchant wallet)
    value?: string;      // ETH value in hex (usually 0 for USDT)
    data?: string;       // encoded calldata (ERC-20 transfer)
    chainId?: number;    // detected chain ID (137 = Polygon)
    eip681_amount?: number;  // USDT amount parsed from EIP-681 URL (if detected)
}

export interface Web3DetectionResult {
    detected: boolean;
    method: "eth_sendTransaction" | "EIP-681" | null;
    params: Web3TxParams | null;
    message: string;
}

const WEB3_DETECT_TIMEOUT_MS = 12_000; // 12s max to detect Web3 button click

/**
 * Opens the checkout URL in a headless browser.
 * Injects a mock window.ethereum (MetaMask emulation).
 * Scans for EIP-681 links.
 * Returns the tx params if Web3 payment is detected, else null.
 */
export async function detectWeb3Payment(
    checkoutUrl: string,
): Promise<Web3DetectionResult> {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        // ─── Inject mock window.ethereum BEFORE page loads ───────────────────
        // This ensures the page's `if (typeof window.ethereum !== 'undefined')` check passes.
        await page.addInitScript(() => {
            const mockEthereum = {
                isMetaMask: true,
                selectedAddress: "0x0000000000000000000000000000000000000001",
                chainId: "0x89",
                networkVersion: "137",

                request: async ({ method, params }: { method: string; params?: unknown[] }) => {
                    if (method === "eth_requestAccounts" || method === "eth_accounts") {
                        return ["0x0000000000000000000000000000000000000001"];
                    }
                    if (method === "eth_chainId") return "0x89";
                    if (method === "net_version") return "137";
                    if (method === "eth_sendTransaction") {
                        const tx = params?.[0] as Record<string, string>;
                        (window as unknown as Record<string, unknown>)["__wdkCapturedTx"] = tx;
                        return "0xdeadbeef00000000000000000000000000000000000000000000000000000001";
                    }
                    if (method === "wallet_switchEthereumChain") return null;
                    if (method === "eth_getBalance") return "0x0";
                    // C3 FIX: Log unrecognized methods for debugging DApp compatibility
                    (window as unknown as Record<string, unknown>)["__wdkUnknownMethod_" + method] = true;
                    return null;
                },

                on: (event: string, handler: (data: unknown) => void) => {
                    if (event === "connect") setTimeout(() => handler({ chainId: "0x89" }), 100);
                    if (event === "accountsChanged") setTimeout(() => handler(["0x0000000000000000000000000000000000000001"]), 200);
                },

                removeListener: () => {},
                removeAllListeners: () => {},
                isConnected: () => true,
            };

            Object.defineProperty(window, "ethereum", {
                value: mockEthereum,
                writable: false,
                configurable: true,
            });
        });


        // ─── Navigate to page ─────────────────────────────────────────────────
        await page.goto(checkoutUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });

        // ─── Strategy A: Scan for EIP-681 links ──────────────────────────────
        // Look for links like: ethereum:0xabc...@137/transfer?address=0xabc&uint256=10000000
        const eip681Result = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll("a[href]"))
                .map(a => (a as HTMLAnchorElement).href)
                .filter(href => href.startsWith("ethereum:"));

            const texts = [document.body.innerText ?? ""];
            const allText = texts.join(" ");
            const inlineMatch = allText.match(/ethereum:0x[0-9a-fA-F]{40}[^\s]*/);

            const href = links[0] ?? inlineMatch?.[0] ?? null;
            if (!href) return null;

            // Parse: ethereum:0xCONTRACT@137/transfer?address=0xRECIPIENT&uint256=10000000
            const contractMatch = href.match(/ethereum:(0x[0-9a-fA-F]{40})/);
            const chainMatch = href.match(/@(\d+)/);
            const uint256Match = href.match(/uint256=(\d+)/);
            // ✅ BUG 6 FIX: Parse recipient from 'address=' query param (not the contract address)
            const recipientMatch = href.match(/[?&]address=(0x[0-9a-fA-F]{40})/);

            return {
                // Prefer recipient address from query param; fall back to contract only as last resort
                to: recipientMatch?.[1] ?? contractMatch?.[1] ?? null,
                contract: contractMatch?.[1] ?? null,   // USDT contract (kept for logging)
                chainId: chainMatch ? parseInt(chainMatch[1]) : 137,
                uint256: uint256Match?.[1] ?? null,
                raw: href,
            };
        });

        if (eip681Result?.to) {
            const usdtAmount = eip681Result.uint256
                ? parseInt(eip681Result.uint256) / 1_000_000  // USDT has 6 decimals
                : null;
            console.error(`[WEB3] ✅ EIP-681 detected: recipient=${eip681Result.to}, contract=${eip681Result.contract}, amount=${usdtAmount} USDT`);
            return {
                detected: true,
                method: "EIP-681",
                params: {
                    to: eip681Result.to,
                    chainId: eip681Result.chainId,
                    eip681_amount: usdtAmount ?? undefined,
                },
                message: `EIP-681 payment link found. Merchant: ${eip681Result.to}, amount: ${usdtAmount} USDT.`,
            };
        }

        // ─── Strategy B: Wait for eth_sendTransaction after clicking "Pay" ────
        // ✅ BUG 5 FIX: Auto-click common Web3 pay buttons so DApp triggers eth_sendTransaction
        const web3ButtonSelectors = [
            'button:has-text("MetaMask")', 'button:has-text("Pay with Crypto")',
            'button:has-text("Connect Wallet")', 'button:has-text("Pay with Web3")',
            'button:has-text("Pay with Wallet")', '#pay-metamask-btn',
            '[class*="web3"] button', '[class*="metamask"] button',
        ];
        for (const sel of web3ButtonSelectors) {
            try {
                const btn = await page.$(sel);
                if (btn && await btn.isVisible()) {
                    console.error(`[WEB3] Clicking Web3 pay button: ${sel}`);
                    await btn.click();
                    break;
                }
            } catch { /* selector may not exist — continue */ }
        }

        // Poll for captured tx (window.ethereum.request intercepted by mock)
        const capturedTx = await Promise.race([
            // Poll for captured tx
            (async () => {
                const start = Date.now();
                while (Date.now() - start < WEB3_DETECT_TIMEOUT_MS) {
                    const tx = await page.evaluate(() => {
                        return (window as unknown as Record<string, unknown>)["__wdkCapturedTx"] ?? null;
                    });
                    if (tx) return tx as Record<string, string>;
                    await page.waitForTimeout(500);
                }
                return null;
            })(),
        ]);

        if (capturedTx) {
            console.error(`[WEB3] ✅ eth_sendTransaction captured: to=${capturedTx["to"]}`);
            return {
                detected: true,
                method: "eth_sendTransaction",
                params: {
                    to: capturedTx["to"] as string,
                    value: capturedTx["value"] as string | undefined,
                    data: capturedTx["data"] as string | undefined,
                    chainId: 137,
                },
                message: `Web3 payment detected via eth_sendTransaction. Recipient: ${capturedTx["to"]}`,
            };
        }

        console.error("[WEB3] ❌ No Web3 payment detected on this page. Fallback to Fiat.");
        return {
            detected: false,
            method: null,
            params: null,
            message: "No Web3 payment gateway detected. Will proceed with JIT Visa Card (Fiat) route.",
        };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[WEB3] Error during detection: ${msg}`);
        return {
            detected: false,
            method: null,
            params: null,
            message: `Detection failed: ${msg}. Defaulting to Fiat route.`,
        };
    } finally {
        await browser.close().catch(() => {});
    }
}
