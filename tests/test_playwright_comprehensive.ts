import { fillCheckoutForm } from "../src/playwright_bridge.js";

async function runTests() {
    console.log("🚀 Starting Comprehensive Z-ZERO MCP Playwright Validation...\n");

    const mockSecureCardData = {
        number: "4367970132760516",
        exp_month: "03",
        exp_year: "2029",
        cvv: "546",
        name: "Sandbox Business"
    };

    const targets = [
        { name: "Shopify", url: "http://localhost:8080/test_checkouts/shopify.html" },
        { name: "WooCommerce", url: "http://localhost:8080/test_checkouts/woocommerce.html" },
        { name: "Stripe Style", url: "http://localhost:8080/test_checkouts/stripe.html" },
        { name: "Amazon", url: "http://localhost:8080/test_checkouts/amazon.html" }
    ];

    let passed = 0;

    for (const target of targets) {
        console.log(`\n----------------------------------------`);
        console.log(`🎯 Testing Target: ${target.name}`);
        console.log(`URL: ${target.url}`);

        // Reset RAM data before each test as the bridge wipes it
        const cardData = { ...mockSecureCardData };

        try {
            const result = await fillCheckoutForm(target.url, cardData);

            if (result.success) {
                passed++;
                console.log(`✅ [PASS] ${result.message}`);

                // Zero-Trust Check
                if (cardData.number === "0000000000000000") {
                    console.log(`🔒 Zero-Trust: RAM cleared successfully.`);
                } else {
                    console.error(`🚨 SECURITY FATAL: RAM NOT CLEARED!`);
                }
            } else {
                console.error(`❌ [FAIL] ${result.message}`);
            }
        } catch (error) {
            console.error(`❌ [EXCEPTION]`, error);
        }
    }

    console.log(`\n========================================`);
    console.log(`🏁 Test Suite Finished. Passed: ${passed}/${targets.length}`);
    console.log(`========================================`);
}

runTests();
