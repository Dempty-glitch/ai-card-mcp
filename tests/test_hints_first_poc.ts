/**
 * POC: Hints-First Web3 Detection
 * 
 * Mục tiêu: Chứng minh rằng nếu ta biết trước "bấm nút nào" (từ checkout_hints),
 * thì web3-detector có thể capture được eth_sendTransaction từ DePay và MoonPay.
 * 
 * KHÔNG thay đổi code production — chỉ test concept.
 */
import { chromium, Page } from 'playwright';

// ── Mock hints data (giả lập checkout_hints DB) ────────────────
const MOCK_HINTS: Record<string, {
    payment_type: string;
    web3_pay_selector: string;
    pre_steps: string[];
}> = {
    "link.depay.com": {
        payment_type: "web3",
        web3_pay_selector: "button.btn-primary",
        pre_steps: [
            "click button.btn-primary",              // Nút "Pay" chính
            "wait 2000",                              // Đợi wallet modal render
            "click button[title='Connect MetaMask']", // Chọn MetaMask trong modal
            "wait 3000",                              // Đợi wallet connect + "Connecting extension" spinner
        ],
    },
    "moonpay.hel.io": {
        payment_type: "web3",
        web3_pay_selector: "button:has-text('Connect Wallet')",
        pre_steps: [
            "click button:has-text('Connect Wallet')",  // Nút Connect Wallet
            "wait 2000",                                 // Đợi wallet list modal
            // MetaMask button trong modal (nếu detect được mock ethereum)
            "click button:has-text('MetaMask')",
            "wait 2000",
        ],
    },
};

// ── Inject mock window.ethereum (copy từ web3-detector.ts) ─────
async function injectMockEthereum(page: Page) {
    await page.addInitScript(() => {
        const mockEthereum = {
            isMetaMask: true,
            selectedAddress: "0x0000000000000000000000000000000000000001",
            chainId: "0x89",
            networkVersion: "137",
            request: async ({ method, params }: { method: string; params?: unknown[] }) => {
                console.log(`[MOCK ETH] method called: ${method}`);
                if (method === "eth_requestAccounts" || method === "eth_accounts") {
                    return ["0x0000000000000000000000000000000000000001"];
                }
                if (method === "eth_chainId") return "0x89";
                if (method === "net_version") return "137";
                if (method === "wallet_switchEthereumChain") return null;
                if (method === "eth_getBalance") return "0x2386F26FC10000"; // 0.01 ETH
                if (method === "personal_sign") return "0xmocksig";
                if (method === "eth_sendTransaction") {
                    const tx = params?.[0] as Record<string, string>;
                    console.log(`[MOCK ETH] 🎯 CAPTURED eth_sendTransaction!`, JSON.stringify(tx));
                    (window as any).__wdkCapturedTx = tx;
                    return "0xdeadbeef00000000000000000000000000000000000000000000000000000001";
                }
                console.log(`[MOCK ETH] Unknown method: ${method}`);
                return null;
            },
            on: (event: string, handler: (data: unknown) => void) => {
                if (event === "connect") setTimeout(() => handler({ chainId: "0x89" }), 100);
                if (event === "accountsChanged") setTimeout(() => handler(["0x0000000000000000000000000000000000000001"]), 200);
                if (event === "chainChanged") setTimeout(() => handler("0x89"), 150);
            },
            removeListener: () => {},
            removeAllListeners: () => {},
            isConnected: () => true,
            _metamask: { isUnlocked: async () => true },
        };

        Object.defineProperty(window, "ethereum", {
            value: mockEthereum,
            writable: false,
            configurable: true,
        });
        console.log("[MOCK ETH] ✅ window.ethereum injected");
    });
}

// ── Execute pre_steps from hints ───────────────────────────────
async function executePreSteps(page: Page, steps: string[]): Promise<void> {
    for (const step of steps) {
        if (step.startsWith("click ")) {
            const selector = step.slice(6);
            console.log(`  [PRE_STEP] Clicking: ${selector}`);
            try {
                await page.click(selector, { timeout: 5000 });
                console.log(`  [PRE_STEP] ✅ Clicked`);
            } catch (e: any) {
                console.log(`  [PRE_STEP] ❌ Click failed: ${e.message.slice(0, 80)}`);
            }
        } else if (step.startsWith("wait ")) {
            const ms = parseInt(step.slice(5));
            console.log(`  [PRE_STEP] Waiting ${ms}ms...`);
            await page.waitForTimeout(ms);
        }
    }
}

// ── Poll for captured tx ───────────────────────────────────────
async function pollForCapturedTx(page: Page, timeoutMs = 15000): Promise<Record<string, string> | null> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const tx = await page.evaluate(() => (window as any).__wdkCapturedTx ?? null);
        if (tx) return tx as Record<string, string>;
        await page.waitForTimeout(500);
    }
    return null;
}

// ── Main test ─────────────────────────────────────────────────
async function testHintsFirst(url: string) {
    const hostname = new URL(url).hostname;
    const hints = MOCK_HINTS[hostname];

    console.log(`\n${"═".repeat(60)}`);
    console.log(`🧪 TEST: ${url}`);
    console.log(`   Hints: ${hints ? `payment_type=${hints.payment_type}, ${hints.pre_steps.length} steps` : "NONE"}`);
    console.log(`${"═".repeat(60)}`);

    if (!hints) {
        console.log("❌ No hints for this domain. Skipping.");
        return;
    }

    const browser = await chromium.launch({ headless: false }); // headless=false để thấy flow
    const context = await browser.newContext();
    const page = await context.newPage();

    // Listen to console logs from the page
    page.on('console', msg => {
        const text = msg.text();
        if (text.includes('[MOCK ETH]')) {
            console.log(`  📡 ${text}`);
        }
    });

    try {
        // Step 1: Inject mock ethereum TRƯỚC khi page load
        await injectMockEthereum(page);
        console.log("\n[1/4] Mock window.ethereum injected");

        // Step 2: Navigate
        console.log(`[2/4] Navigating to ${url}...`);
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForTimeout(2000); // Đợi JS render xong
        console.log("[2/4] ✅ Page loaded");

        // Step 3: Execute pre_steps from hints
        console.log(`[3/4] Executing ${hints.pre_steps.length} pre_steps from hints...`);
        await executePreSteps(page, hints.pre_steps);

        // Step 4: Poll for captured transaction
        console.log("[4/4] Polling for captured eth_sendTransaction (15s timeout)...");
        const capturedTx = await pollForCapturedTx(page, 15000);

        // ── RESULT ──
        console.log(`\n${"─".repeat(60)}`);
        if (capturedTx) {
            console.log("🎉 SUCCESS! eth_sendTransaction CAPTURED!");
            console.log("   to:", capturedTx.to);
            console.log("   value:", capturedTx.value || "(none — ERC-20 transfer)");
            console.log("   data:", capturedTx.data ? `${capturedTx.data.slice(0, 20)}...` : "(none)");
            console.log("\n   ✅ Hints-First approach WORKS for this platform!");
        } else {
            // Check what ethereum methods were called (even if no tx)
            const logs = await page.evaluate(() => {
                const methods: string[] = [];
                for (const key of Object.keys(window)) {
                    if (key.startsWith("__wdkUnknownMethod_")) {
                        methods.push(key.replace("__wdkUnknownMethod_", ""));
                    }
                }
                return methods;
            });
            
            console.log("⚠️  No eth_sendTransaction captured within timeout.");
            if (logs.length > 0) {
                console.log(`   But detected ${logs.length} other ethereum calls: ${logs.join(", ")}`);
                console.log("   → Platform IS Web3-aware, but needs more steps in pre_steps.");
            } else {
                console.log("   No ethereum methods called at all.");
                console.log("   → Platform may not auto-inject after wallet connect, or uses Solana.");
            }
        }
        console.log(`${"─".repeat(60)}\n`);

    } catch (e: any) {
        console.error(`❌ Error: ${e.message}`);
    } finally {
        await browser.close();
    }
}

// ── Run tests ──────────────────────────────────────────────────
async function main() {
    const testUrl = process.argv[2];
    if (testUrl) {
        await testHintsFirst(testUrl);
    } else {
        // Test DePay trước
        await testHintsFirst("https://link.depay.com/3lCkafKyiYgLSz7FlFVxJg");
    }
}

main().catch(console.error);
