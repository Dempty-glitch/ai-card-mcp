/**
 * POC: MoonPay "Transfer Manually" — Scrape wallet address
 * 
 * Flow: Click "Transfer Manually" → Select USDT + Ethereum → Read wallet address
 * Không gửi tiền thật — chỉ log address ra.
 */
import { chromium } from 'playwright';

async function testMoonPayManual() {
    const url = "https://moonpay.hel.io/deposit/0897d7b8-c781-46c2-a949-e09ca26b560e";
    console.log(`\n🔬 MoonPay Manual Transfer Test: ${url}\n`);

    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        // Step 1: Navigate
        console.log("[1] Navigate...");
        await page.goto(url, { waitUntil: "networkidle", timeout: 20000 });
        await page.waitForTimeout(3000);
        console.log("[1] ✅ Loaded");

        // Step 2: Click "Transfer Manually"
        console.log("\n[2] Click 'Transfer Manually'...");
        const transferBtn = await page.$("button:has-text('Transfer Manually')");
        if (!transferBtn) {
            // Fallback: look for text-based selectors
            const allBtns = await page.$$("button");
            for (const btn of allBtns) {
                const text = await btn.textContent();
                if (text && text.includes("Transfer")) {
                    console.log(`   Found fallback: "${text.trim().slice(0, 50)}"`);
                    await btn.click();
                    break;
                }
            }
        } else {
            await transferBtn.click();
        }
        console.log("[2] ✅ Clicked");
        await page.waitForTimeout(2000);

        // Step 3: Select currency → USDT (if not default)
        console.log("\n[3] Selecting currency...");
        // Check what currency is shown
        const pageText = await page.textContent("body");
        if (pageText && pageText.includes("USDC")) {
            console.log("   Default is USDC, trying to switch to USDT...");
            // Click currency dropdown
            const currencyBtn = await page.$("button:has-text('Currency')");
            if (currencyBtn) {
                await currencyBtn.click();
                await page.waitForTimeout(1000);
                const usdtOption = await page.$("button:has-text('USDT')");
                if (usdtOption) {
                    await usdtOption.click();
                    await page.waitForTimeout(1000);
                    console.log("   ✅ Switched to USDT");
                } else {
                    console.log("   ⚠️ USDT not found, staying with USDC");
                }
            }
        }

        // Step 4: Select network → Ethereum
        console.log("\n[4] Selecting network...");
        const networkBtn = await page.$("button:has-text('Network')");
        if (networkBtn) {
            await networkBtn.click();
            await page.waitForTimeout(1000);
        }
        // Try clicking Ethereum
        const ethOption = await page.$("button:has-text('Ethereum')");
        if (ethOption) {
            await ethOption.click();
            await page.waitForTimeout(2000);
            console.log("[4] ✅ Ethereum selected");
        } else {
            console.log("[4] ⚠️ Ethereum option not found, checking what's available...");
        }

        // Step 5: Scrape wallet address from the page
        console.log("\n[5] Scraping wallet address...");
        await page.waitForTimeout(2000);

        // Strategy 1: Look for 0x... pattern in page text
        const bodyText = await page.textContent("body") || "";
        const ethAddrMatch = bodyText.match(/0x[0-9a-fA-F]{40}/g);
        
        // Strategy 2: Look for copy buttons near addresses
        const addressElements = await page.evaluate(() => {
            const results: { text: string; tag: string; class: string }[] = [];
            // Look for elements containing 0x addresses
            const walker = document.createTreeWalker(
                document.body,
                NodeFilter.SHOW_TEXT,
                null
            );
            let node;
            while (node = walker.nextNode()) {
                const text = node.textContent || "";
                if (/0x[0-9a-fA-F]{10,}/.test(text)) {
                    const parent = node.parentElement;
                    results.push({
                        text: text.trim().slice(0, 60),
                        tag: parent?.tagName || "?",
                        class: parent?.className?.slice(0, 40) || "",
                    });
                }
            }
            return results;
        });

        // Strategy 3: Look for QR code image
        const qrImages = await page.evaluate(() => {
            const imgs = Array.from(document.querySelectorAll('img, canvas, svg'));
            return imgs
                .filter(el => {
                    const src = (el as HTMLImageElement).src || '';
                    const alt = (el as HTMLImageElement).alt || '';
                    const cls = el.className || '';
                    return src.includes('qr') || alt.includes('QR') || cls.includes('qr');
                })
                .map(el => ({
                    tag: el.tagName,
                    src: (el as HTMLImageElement).src?.slice(0, 60) || '',
                    alt: (el as HTMLImageElement).alt || '',
                }));
        });

        console.log("\n═══════════════════════════════════════════");
        console.log("📊 RESULTS:");
        console.log("═══════════════════════════════════════════");

        if (ethAddrMatch && ethAddrMatch.length > 0) {
            console.log(`\n✅ Found ${ethAddrMatch.length} Ethereum address(es):`);
            ethAddrMatch.forEach((addr, i) => console.log(`   [${i}] ${addr}`));
            console.log(`\n🎯 Agent would send USDT to: ${ethAddrMatch[0]}`);
            console.log(`   Via: POST /api/wdk/transfer { to: "${ethAddrMatch[0]}", amount: <price> }`);
        } else {
            console.log("❌ No 0x addresses found in page text");
        }

        if (addressElements.length > 0) {
            console.log(`\n📍 Address elements in DOM:`);
            addressElements.forEach(el => console.log(`   <${el.tag} class="${el.class}"> ${el.text}`));
        }

        if (qrImages.length > 0) {
            console.log(`\n📱 QR code elements: ${qrImages.length}`);
            qrImages.forEach(qr => console.log(`   <${qr.tag}> src=${qr.src} alt=${qr.alt}`));
        }

        console.log("\n═══════════════════════════════════════════");
        if (ethAddrMatch && ethAddrMatch.length > 0) {
            console.log("🎉 POC SUCCESS: Agent CAN scrape wallet address and pay via WDK!");
        } else {
            console.log("⚠️ Address not found — may need different page interaction");
        }
        console.log("═══════════════════════════════════════════\n");

    } catch (e: any) {
        console.error(`❌ Error: ${e.message}`);
    } finally {
        await browser.close();
    }
}

testMoonPayManual().catch(console.error);
