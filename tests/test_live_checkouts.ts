import { chromium } from "playwright";

async function runLiveTests() {
    console.log("🚀 Starting Z-ZERO MCP Playwright Validation on Live Tech Sites...\n");

    const browser = await chromium.launch({ headless: true });
    // We create a persistent context to mimic a real user session
    // Some sites block headless browsers without user-agent spoofing
    const context = await browser.newContext({
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    });

    const targets = [
        { name: "OpenAI Pricing (Stripe Base)", url: "https://openai.com/api/pricing/" }, // Note: actual API billing requires login
        { name: "Anthropic API Console", url: "https://console.anthropic.com/settings/billing" },
        { name: "Google Cloud Billing", url: "https://console.cloud.google.com/billing" },
        { name: "DigitalOcean (Stripe)", url: "https://cloud.digitalocean.com/registrations/new" }
    ];

    for (const target of targets) {
        console.log(`\n----------------------------------------`);
        console.log(`🎯 Target: ${target.name} | URL: ${target.url}`);

        const page = await context.newPage();
        try {
            console.log("   Loading page...");
            await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: 15000 });

            // Wait a moment for dynamic forms (like Stripe elements) to load
            await page.waitForTimeout(3000);

            // Search the DOM for credit card fields
            console.log("   Scanning for generic card fields...");
            const fields = await page.evaluate(() => {
                const results: string[] = [];
                // Look for inputs with common card-related names or attributes
                document.querySelectorAll('input').forEach(el => {
                    const name = (el.name || '').toLowerCase();
                    const autocomplete = (el.autocomplete || '').toLowerCase();
                    const placeholder = (el.placeholder || '').toLowerCase();
                    const aria = (el.getAttribute('aria-label') || '').toLowerCase();

                    if (name.includes('card') || name.includes('cc') || name.includes('cvv') || name.includes('exp') ||
                        autocomplete.includes('cc-') ||
                        placeholder.includes('card') || placeholder.includes('cv') || placeholder.includes('mm/yy') ||
                        aria.includes('card')) {
                        results.push(`Found: type=${el.type}, name=${el.name}, placeholder=${el.placeholder}, autocomplete=${el.autocomplete}`);
                    }
                });
                return results;
            });

            if (fields.length > 0) {
                console.log(`   ✅ SUCCESS: Found ${fields.length} readable credit card inputs directly in the DOM.`);
                fields.slice(0, 3).forEach(f => console.log(`      - ${f}`));
            } else {
                console.log(`   ⚠️ WARNING: No direct card fields found in main DOM.`);
                console.log(`      Checking for embedded Stripe/Braintree iframes...`);

                const frames = page.frames();
                let iframeFound = false;
                for (const frame of frames) {
                    const frameUrl = frame.url();
                    if (frameUrl.includes("stripe.com") || frameUrl.includes("braintree") || frameUrl.includes("recurly")) {
                        console.log(`   ✅ SUCCESS: Found external payment iframe (${frameUrl.split('?')[0]})`);
                        iframeFound = true;
                        console.log(`      Our Playwright bridge STRATEGY 2 (iframe injection) is built to handle this.`);
                        break;
                    }
                }

                if (!iframeFound) {
                    console.log(`   ❌ FAIL: No obvious checkout forms or payment iframes detected on this specific public URL.`);
                    console.log(`      Reason: Authentication/Login likely required to reach the actual billing section.`);
                }
            }

        } catch (error: unknown) {
            console.error(`   ❌ FAIL: Error loading or scanning page: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            await page.close();
        }
    }

    await browser.close();
    console.log(`\n========================================`);
    console.log(`🏁 Live Detection Scan Complete.`);
    console.log(`========================================`);
}

runLiveTests();
