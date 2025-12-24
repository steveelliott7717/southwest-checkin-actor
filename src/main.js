import { Actor } from 'apify';
import { PlaywrightCrawler, ProxyConfiguration } from 'crawlee';

/**
 * Southwest Airlines Auto Check-In Actor (Pre-Load & Wait Version)
 * 
 * This actor:
 * 1. Loads the page and fills the form early (T-3 minutes)
 * 2. Syncs time with Southwest's servers
 * 3. Waits until exactly T-0
 * 4. Submits at the precise moment
 * 
 * Input:
 * {
 *   "confirmationNumber": "ABC123",
 *   "firstName": "JOHN",
 *   "lastName": "DOE",
 *   "checkinOpensAt": "2025-12-24T16:50:00.000Z"
 * }
 */

await Actor.init();

try {
    const input = await Actor.getInput();
    
    if (!input) {
        throw new Error('No input provided');
    }

    const { confirmationNumber, firstName, lastName, checkinOpensAt } = input;

    if (!confirmationNumber || !firstName || !lastName || !checkinOpensAt) {
        throw new Error('Missing required fields: confirmationNumber, firstName, lastName, checkinOpensAt');
    }

    const checkinOpensAtMs = new Date(checkinOpensAt).getTime();

    console.log('Starting Southwest check-in with pre-load strategy:', {
        confirmationNumber,
        firstName,
        lastName,
        checkinOpensAt,
    });

    const result = {
        success: false,
        boardingPosition: null,
        confirmationNumber,
        checkinOpensAt,
        actualSubmitTime: null,
        timingOffset: null,
        timestamp: new Date().toISOString(),
        error: null,
        screenshots: [],
    };

    // Function to get Southwest's server time
    async function getSouthwestTime() {
        try {
            const response = await fetch('https://www.southwest.com/', { method: 'HEAD' });
            const dateHeader = response.headers.get('date');
            if (dateHeader) {
                return new Date(dateHeader).getTime();
            }
        } catch (e) {
            console.log('Failed to get Southwest time, using local:', e.message);
        }
        return Date.now(); // Fallback to local time
    }

    const proxyConfiguration = await Actor.createProxyConfiguration({
        groups: ['RESIDENTIAL'],
        countryCode: 'US',
    });

    const crawler = new PlaywrightCrawler({
        proxyConfiguration,
        requestHandlerTimeoutSecs: 300, // 5 minutes to allow for wait time
        launchContext: {
            launchOptions: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                ],
            },
        },
        preNavigationHooks: [
            async ({ page }) => {
                await page.setViewportSize({ width: 1920, height: 1080 });
                await page.setExtraHTTPHeaders({
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept-Language': 'en-US,en;q=0.9',
                });
            },
        ],
        requestHandler: async ({ page }) => {
            try {
                // PHASE 1: Load page and fill form
                console.log('═══ PHASE 1: Loading and filling form ═══');
                await page.goto('https://www.southwest.com/air/check-in/index.html', {
                    waitUntil: 'domcontentloaded',
                    timeout: 30000,
                });

                await page.waitForTimeout(2000);

                const screenshotInitial = await page.screenshot({ fullPage: false });
                await Actor.setValue('screenshot-initial', screenshotInitial, { contentType: 'image/png' });
                result.screenshots.push('screenshot-initial');
                console.log('✓ Page loaded');

                await page.waitForSelector('form, input[name="confirmationNumber"]', { 
                    timeout: 10000,
                    state: 'visible'
                });

                await page.waitForTimeout(1000);

                // Fill confirmation number
                console.log('Filling form fields...');
                const allInputs = await page.$$('input[type="text"], input:not([type="hidden"]):not([type="submit"]):not([type="button"])');
                console.log(`Found ${allInputs.length} input fields`);

                if (allInputs.length < 3) {
                    throw new Error(`Expected 3 inputs, found ${allInputs.length}`);
                }

                await allInputs[0].scrollIntoViewIfNeeded();
                await allInputs[0].click();
                await allInputs[0].fill(confirmationNumber);
                console.log('✓ Filled confirmation number');

                await page.waitForTimeout(500);

                await allInputs[1].scrollIntoViewIfNeeded();
                await allInputs[1].click();
                await allInputs[1].fill(firstName);
                console.log('✓ Filled first name');

                await page.waitForTimeout(500);

                await allInputs[2].scrollIntoViewIfNeeded();
                await allInputs[2].click();
                await allInputs[2].fill(lastName);
                console.log('✓ Filled last name');

                await page.waitForTimeout(1000);

                const screenshotFilled = await page.screenshot({ fullPage: false });
                await Actor.setValue('screenshot-form-filled', screenshotFilled, { contentType: 'image/png' });
                result.screenshots.push('screenshot-form-filled');
                console.log('✓ Form filled completely');

                // PHASE 2: Wait for precise moment
                console.log('═══ PHASE 2: Waiting for check-in to open ═══');
                
                let lastSyncTime = await getSouthwestTime();
                console.log(`Check-in opens at: ${new Date(checkinOpensAtMs).toISOString()}`);
                console.log(`Southwest time now: ${new Date(lastSyncTime).toISOString()}`);

                while (true) {
                    const southwestNow = await getSouthwestTime();
                    const msUntilCheckin = checkinOpensAtMs - southwestNow;
                    
                    if (msUntilCheckin <= 0) {
                        console.log('🎯 Check-in time reached! Submitting NOW!');
                        break;
                    }

                    if (msUntilCheckin <= 5000) {
                        // Within 5 seconds - poll frequently
                        if (msUntilCheckin % 1000 < 200) { // Log every ~1 second
                            console.log(`⏱️  ${(msUntilCheckin / 1000).toFixed(1)}s until check-in...`);
                        }
                        await page.waitForTimeout(100); // Poll every 100ms
                    } else if (msUntilCheckin <= 60000) {
                        // Within 1 minute - poll every second
                        console.log(`⏱️  ${Math.floor(msUntilCheckin / 1000)}s until check-in...`);
                        await page.waitForTimeout(1000);
                    } else {
                        // More than 1 minute away - poll every 5 seconds
                        const secondsRemaining = Math.floor(msUntilCheckin / 1000);
                        console.log(`⏳ ${Math.floor(secondsRemaining / 60)}m ${secondsRemaining % 60}s until check-in...`);
                        await page.waitForTimeout(5000);
                    }
                }

                // PHASE 3: Submit at precise moment
                console.log('═══ PHASE 3: Submitting check-in ═══');
                const submitStartTime = Date.now();
                
                const submitButton = await page.$('button[type="submit"], button:has-text("Check in"), .button--yellow');
                if (!submitButton) {
                    throw new Error('Could not find submit button');
                }

                await submitButton.click();
                const actualSubmitTime = Date.now();
                result.actualSubmitTime = new Date(actualSubmitTime).toISOString();
                result.timingOffset = actualSubmitTime - checkinOpensAtMs;
                
                console.log(`✓ Submitted at: ${new Date(actualSubmitTime).toISOString()}`);
                console.log(`✓ Timing offset: ${result.timingOffset}ms ${result.timingOffset > 0 ? 'late' : 'early'}`);

                // Wait for result page
                await page.waitForTimeout(5000);

                const screenshotResult = await page.screenshot({ fullPage: true });
                await Actor.setValue('screenshot-result', screenshotResult, { contentType: 'image/png' });
                result.screenshots.push('screenshot-result');

                // PHASE 4: Extract boarding position
                console.log('═══ PHASE 4: Extracting boarding position ═══');
                
                const pageContent = await page.content();
                await Actor.setValue('final-page-html', pageContent, { contentType: 'text/html' });

                // Try multiple patterns to extract boarding position
                const patterns = [
                    /boarding\s+position[:\s]+([A-C]\d{1,2})/i,
                    /position[:\s]+([A-C]\d{1,2})/i,
                    /group[:\s]+([A-C])\s+position[:\s]+(\d{1,2})/i,
                    /([A-C]\d{1,2})/g
                ];

                let boardingPosition = null;
                for (const pattern of patterns) {
                    const match = pageContent.match(pattern);
                    if (match) {
                        if (match.length >= 3) {
                            boardingPosition = match[1] + match[2];
                        } else {
                            boardingPosition = match[1];
                        }
                        if (boardingPosition && /^[A-C]\d{1,2}$/.test(boardingPosition)) {
                            console.log(`✓ Found boarding position: ${boardingPosition}`);
                            break;
                        }
                    }
                }

                if (boardingPosition) {
                    result.success = true;
                    result.boardingPosition = boardingPosition;
                    console.log(`🎉 SUCCESS! Boarding position: ${boardingPosition}`);
                } else {
                    // Check if it's "too early" error
                    if (pageContent.includes('too early') || pageContent.includes('Come back')) {
                        result.success = false;
                        result.error = 'Check-in not yet open (too early)';
                        console.log('⚠️  Check-in window not yet open');
                    } else {
                        result.success = true;
                        result.boardingPosition = 'UNKNOWN';
                        result.error = 'Could not parse boarding position from page';
                        console.log('⚠️  Could not parse boarding position');
                    }
                }

            } catch (error) {
                console.error('❌ Error during check-in:', error);
                result.error = error.message;
                
                try {
                    const screenshotError = await page.screenshot({ fullPage: true });
                    await Actor.setValue('screenshot-error', screenshotError, { contentType: 'image/png' });
                    result.screenshots.push('screenshot-error');
                } catch (e) {
                    console.error('Could not capture error screenshot');
                }
            }
        },
        maxRequestsPerCrawl: 1,
        maxConcurrency: 1,
    });

    await crawler.run(['https://www.southwest.com/air/check-in/index.html']);

    await Actor.pushData(result);
    await Actor.setValue('OUTPUT', result);

    console.log('Actor finished. Final result:', result);

} catch (error) {
    console.error('Fatal error:', error);
    await Actor.pushData({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
    });
    throw error;
}

await Actor.exit();
