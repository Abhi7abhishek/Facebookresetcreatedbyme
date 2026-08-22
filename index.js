process.on("uncaughtException", (err) => {
    console.error("CRITICAL UNCATCHED EXCEPTION:", err);
});

process.on("unhandledRejection", (reason) => {
    console.error("CRITICAL UNHANDLED REJECTION:", reason);
});

const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");

const CHROMIUM_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium";

// Files
const NUMBERS_FILE = path.join(__dirname, "number.txt");
const PROXY_FILE = path.join(__dirname, "proxy.txt");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// =====================================================
// READ NUMBERS
// =====================================================
function getNumbersList() {
    if (!fs.existsSync(NUMBERS_FILE)) {
        console.error("ERROR: number.txt file nahi mili!");
        process.exit(1);
    }
    const content = fs.readFileSync(NUMBERS_FILE, "utf-8");
    return content.split("\n").map(n => n.trim()).filter(n => n.length > 0);
}

// =====================================================
// READ & PARSE PROXY
// =====================================================
function getProxyDetails() {
    if (!fs.existsSync(PROXY_FILE)) {
        console.log("LOG: proxy.txt nahi mili, direct connection use hoga.");
        return null;
    }
    
    let content = fs.readFileSync(PROXY_FILE, "utf-8").trim();
    const lines = content.split("\n").map(l => l.trim()).filter(l => l.length > 0);

    if (lines.length === 0) return null;

    let rawProxy = lines[0];

    // Remove any protocol prefixes if present
    if (rawProxy.startsWith("socks5://")) rawProxy = rawProxy.replace("socks5://", "");
    if (rawProxy.startsWith("http://")) rawProxy = rawProxy.replace("http://", "");

    const parts = rawProxy.split(":");

    if (parts.length === 4) {
        // HOST:PORT:USER:PASS
        return {
            host: parts[0].trim(),
            port: parts[1].trim(),
            username: parts[2].trim(),
            password: parts[3].trim()
        };
    }

    console.error("ERROR: proxy.txt format sahi nahi hai! Expected: HOST:PORT:USER:PASS");
    return null;
}

// =====================================================
// MAIN PROCESS
// =====================================================
async function processNumber(page, phoneNumber) {
    console.log(`\n--------------------------------------`);
    console.log(`LOG: Processing Number -> ${phoneNumber}`);
    console.log(`--------------------------------------`);

    const IDENTIFY_URL = "https://www.facebook.com/login/identify/";

    // 1. Open identify page
    await page.goto(IDENTIFY_URL, { waitUntil: "networkidle2", timeout: 40000 });
    await sleep(2000);

    // 2. Find Search Input & Type Number
    console.log("LOG: Searching input box...");
    const inputSelector = '#identify_email, input[name="email"], input[type="text"]';
    await page.waitForSelector(inputSelector, { visible: true, timeout: 15000 });
    
    await page.click(inputSelector);
    await page.evaluate((sel) => { document.querySelector(sel).value = ""; }, inputSelector);
    await page.type(inputSelector, phoneNumber, { delay: 100 });

    console.log("LOG: Number entered. Submitting search via Enter key...");

    // 3. Submit Form
    await Promise.all([
        page.keyboard.press("Enter"),
        page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => {})
    ]);

    await sleep(3000);

    // 4. Check Result
    const pageText = await page.evaluate(() => document.body.innerText);

    if (
        pageText.includes("No search results") || 
        pageText.includes("No account found") || 
        pageText.includes("Your search did not return any results") ||
        pageText.includes("We couldn't find an account")
    ) {
        console.log(`❌ RESULT: [${phoneNumber}] -> No Account Found.`);
        return;
    }

    console.log(`✅ RESULT: [${phoneNumber}] -> Account Found!`);

    // 5. Select "Get code via SMS"
    try {
        console.log("LOG: Looking for SMS option...");
        await sleep(2000);

        await page.evaluate(() => {
            const inputs = Array.from(document.querySelectorAll('input[type="radio"]'));
            for (let input of inputs) {
                if (input.value.includes('sms') || input.id.includes('sms')) {
                    input.click();
                    break;
                }
            }
        });

        console.log("LOG: Submitting SMS selection...");
        await Promise.all([
            page.evaluate(() => {
                const btns = Array.from(document.querySelectorAll('button, input[type="submit"], div[role="button"]'));
                const cont = btns.find(b => (b.innerText || b.value || "").toLowerCase().includes("continue"));
                if (cont) cont.click();
            }),
            page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => {})
        ]);

        await sleep(5000);

        // 6. Click "Didn't get a code?" button
        console.log("LOG: Looking for 'Didn't get a code?' button...");

        const clicked = await page.evaluate(() => {
            const allNodes = Array.from(document.querySelectorAll('*'));
            const targetNode = allNodes.find(node => {
                const text = (node.innerText || node.textContent || "").trim();
                return (
                    text === "Didn't get a code?" || 
                    text === "Didn't get a code" ||
                    text === "Didn't receive a code?"
                ) && node.children.length === 0;
            });

            if (targetNode) {
                targetNode.click();
                if (targetNode.parentElement) targetNode.parentElement.click();
                return true;
            }
            return false;
        });

        if (clicked) {
            console.log("LOG: ✅ Successfully clicked 'Didn't get a code?' button!");
        } else {
            console.log("LOG: ⚠️ 'Didn't get a code' button not found on screen.");
        }

        await sleep(3000);

    } catch (err) {
        console.error("ERROR during recovery flow:", err.message);
    }
}

// =====================================================
// BOT RUNNER
// =====================================================
async function startBot() {
    const numbers = getNumbersList();
    const proxy = getProxyDetails();

    console.log(`LOG: Total ${numbers.length} numbers loaded.`);

    const launchArgs = [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-blink-features=AutomationControlled",
        "--window-size=1366,768",
        "--lang=en-US,en"
    ];

    if (proxy) {
        console.log(`LOG: Connecting SOCKS5 Proxy -> Host: ${proxy.host} | Port: ${proxy.port}`);
        // Valid Chromium proxy string format
        launchArgs.push(`--proxy-server=socks5://${proxy.host}:${proxy.port}`);
    }

    console.log("LOG: Launching Stealth Browser...");
    const browser = await puppeteer.launch({
        executablePath: CHROMIUM_PATH,
        headless: true,
        args: launchArgs
    });

    const page = await browser.newPage();

    // Authenticate credentials via Puppeteer
    if (proxy && proxy.username && proxy.password) {
        await page.authenticate({
            username: proxy.username,
            password: proxy.password
        });
        console.log("LOG: Proxy authentication applied successfully!");
    }

    // Stealth Overrides
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    });

    await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    );
    await page.setViewport({ width: 1366, height: 768 });

    // Loop through numbers
    for (let i = 0; i < numbers.length; i++) {
        try {
            await processNumber(page, numbers[i]);
        } catch (err) {
            console.error(`ERROR processing number ${numbers[i]}:`, err.message);
        }
        await sleep(3000);
    }

    console.log("\n======================================");
    console.log("LOG: Process complete! Closing browser.");
    console.log("======================================\n");

    await browser.close();
}

startBot();
