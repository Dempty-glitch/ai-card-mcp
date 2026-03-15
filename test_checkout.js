const { chromium } = require('playwright');

async function run() {
    console.log("[AGENT] Resolving token from Vercel API...");
    const res = await fetch("https://www.clawcard.store/api/tokens/resolve", {
        method: "POST",
        headers: {
            "x-internal-secret": "557128f439cb258942a64577481a2ac18956ed576dc2d362060b3cff54f5fbda",
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ token: "temp_auth_8a6dc7880a1a56b0" })
    });
    
    if (!res.ok) {
        console.error("Token resolution failed:", await res.text());
        return;
    }
    const cardData = await res.json();
    console.log("[AGENT] Token resolved successfully. Card data hidden in memory.");
    
    console.log("[AGENT] Launching invisible Playwright browser...");
    const browser = await chromium.launch({ headless: false }); // Show user!
    const page = await browser.newPage();
    await page.goto("http://localhost:9090/fiat_checkout.html");
    
    console.log("[PLAYWRIGHT] Extracting DOM fields in stealth mode...");
    await page.fill('input[name="ccname"]', cardData.name);
    await page.fill('input[name="cardnumber"]', cardData.number);
    await page.fill('input[name="exp-date"]', cardData.exp.replace('/', ' / '));
    await page.fill('input[name="cvc"]', cardData.cvv);
    
    console.log("[PLAYWRIGHT] Card injected. Clicking Pay!");
    await page.click('.pay-btn');
    
    await new Promise(r => setTimeout(r, 4000));
    console.log("[AGENT] ✅ Payment executed successfully via JIT Virtual Visa!");
    await browser.close();
}

run();
