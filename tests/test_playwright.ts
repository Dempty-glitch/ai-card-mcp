import { fillCheckoutForm } from "../src/playwright_bridge.js";

async function runTest() {
    console.log("🚀 Starting Z-ZERO MCP Playwright Validation Test...");

    // Test data mimicking what we'd get from the secure /details endpoint
    const mockSecureCardData = {
        number: "4367970132760516",
        exp_month: "03",
        exp_year: "2029",
        cvv: "546",
        name: "Sandbox Business"
    };

    const targetUrl = "http://localhost:8080/dummy_checkout.html";
    console.log(`\n🎯 Target Checkout URL: ${targetUrl}`);
    console.log("🤖 Injecting secure card payload into headless browser...");

    try {
        const result = await fillCheckoutForm(targetUrl, mockSecureCardData);
        console.log("\n✅ Result from Playwright Bridge:");
        console.log(JSON.stringify(result, null, 2));

        if (result.success) {
            console.log("🎉 Test Passed: The checkout form was successfully auto-filled and submitted.");
        } else {
            console.error("❌ Test Failed: Playwright could not fill the form.");
        }
    } catch (error) {
        console.error("❌ Exception during test:", error);
    }

    // After test ends, check if card data was wiped from memory (Zero-Trust check)
    console.log("\n🔍 Security Audit: Checking if card data was wiped from RAM...");
    console.log("Memory Map => Number:", mockSecureCardData.number, "| CVV:", mockSecureCardData.cvv);
    if (mockSecureCardData.number === "0000000000000000") {
        console.log("✅ Zero-Trust verification passed: Memory wiped.");
    } else {
        console.error("❌ Security Warning: Card data remains in RAM!");
    }
}

runTest();
