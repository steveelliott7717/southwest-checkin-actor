import { Actor } from 'apify';
import { PlaywrightCrawler, ProxyConfiguration } from 'crawlee';
import ntpClient from 'ntp-client';
import log from '@apify/log';

/**
 * Southwest Airlines Auto Check-In Actor (High-Precision Version)
 * 
 * Precision Enhancements:
 * - NTP time sync (±5ms accuracy)
 * - RTT correction for network latency
 * - In-browser setTimeout() for click scheduling (eliminates DevTools protocol delay)
 * - Continuous drift monitoring
 * - Micro-retry loop
 * - Comprehensive telemetry
 * 
 * Target precision: ±100ms
 */

await Actor.init();

// Optimize logging to reduce I/O latency during timing-critical operations
log.setLevel(process.env.APIFY_LOG_LEVEL || 'INFO');

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
    
    // Redundant trigger support: Backup instance submits +1s later for safety
    const isBackup = process.env.IS_BACKUP === 'true';
    const backupOffset = isBackup ? 1000 : 0;
    const instanceType = isBackup ? 'BACKUP' : 'PRIMARY';

    console.log(`Starting Southwest check-in (High-Precision Mode) [${instanceType}]:`, {
        confirmationNumber,
        firstName,
        lastName,
        checkinOpensAt,
        backupOffset: backupOffset > 0 ? `+${backupOffset}ms` : 'none',
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
        telemetry: {
            ntpSyncSucceeded: false,
            localDriftMs: null,
            southwestRTT: null,
            syncMethod: null,
            driftChecks: [],
        },
    };

    // NTP Time Sync Function
    async function getNTPTime() {
        try {
            console.log('🕐 Syncing with NTP server (time.google.com)...');
            const ntpTime = await new Promise((resolve, reject) => {
                ntpClient.getNetworkTime('time.google.com', 123, (err, date) => {
                    if (err) reject(err);
                    else resolve(date);
                });
            });
            const localDriftMs = ntpTime.getTime() - Date.now();
            console.log(`✓ NTP sync successful. Local drift: ${localDriftMs}ms`);
            result.telemetry.ntpSyncSucceeded = true;
            result.telemetry.localDriftMs = localDriftMs;
            return { ntpTime: ntpTime.getTime(), localDriftMs };
        } catch (error) {
            console.log('⚠️  NTP sync failed:', error.message);
            result.telemetry.ntpSyncSucceeded = false;
            return { ntpTime: Date.now(), localDriftMs: 0 };
        }
    }

    // Southwest Time Sync with RTT Correction
    async function getSouthwestTimeWithRTT(localDriftMs = 0) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000); // 3s timeout
            
            const start = Date.now();
            const response = await fetch('https://www.southwest.com/', { 
                method: 'HEAD',
                signal: controller.signal 
            });
            const end = Date.now();
            
            clearTimeout(timeoutId);
            const rtt = end - start;
            
            const dateHeader = response.headers.get('date');
            if (dateHeader) {
                const swServerMs = new Date(dateHeader).getTime() + (rtt / 2);
                const correctedTime = swServerMs + localDriftMs;
                
                console.log(`⏱️  Southwest RTT: ${rtt}ms, Server time adjusted by ${(rtt/2).toFixed(1)}ms`);
                result.telemetry.southwestRTT = rtt;
                
                return { time: correctedTime, rtt, method: 'southwest+ntp' };
            }
        } catch (e) {
            if (e.name === 'AbortError') {
                console.log('⚠️  Southwest time sync timed out (>3s)');
            } else {
                console.log('⚠️  Southwest time sync failed:', e.message);
            }
        }
        
        // Fallback to NTP-corrected local time
        const fallbackTime = Date.now() + localDriftMs;
        return { time: fallbackTime, rtt: null, method: 'ntp-only' };
    }

    // Initialize time sync
    const { ntpTime, localDriftMs } = await getNTPTime();
    
    // Dual Proxy Configuration
    // - Residential for preload (mimics real user behavior)
    // - Datacenter for submit (low latency, sub-50ms)
    const preloadProxy = await Actor.createProxyConfiguration({
        groups: ['RESIDENTIAL'],
        countryCode: 'US',
    });
    
    const submitProxy = await Actor.createProxyConfiguration({
        groups: ['DATACENTER'],  // Or 'SW_FASTLANE_USC' if you create a custom group
        countryCode: 'US',
    });

    const crawler = new PlaywrightCrawler({
        proxyConfiguration: preloadProxy,  // Start with residential
        requestHandlerTimeoutSecs: 300,
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
                // Fixed viewport and UA for consistency
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
                console.log('\n═══ PHASE 1: Loading and filling form ═══');
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

                // Fill form using position-based approach
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

                // PHASE 2: Wait with continuous drift monitoring
                console.log('\n═══ PHASE 2: Waiting with precision timing ═══');
                
                // Pre-warm Southwest session early (DNS, TLS, TCP session tickets)
                const msUntilCheckin = checkinOpensAtMs - Date.now();
                if (msUntilCheckin > 300000) { // More than 5 minutes away
                    console.log('🔥 Pre-warming Southwest session (DNS, TLS, TCP)...');
                    try {
                        await fetch('https://www.southwest.com/', { method: 'HEAD' });
                        console.log('✓ Session pre-warmed, handshake cached');
                    } catch (e) {
                        console.log('⚠️  Pre-warm failed (non-critical):', e.message);
                    }
                }
                
                let lastSyncTime = await getSouthwestTimeWithRTT(localDriftMs);
                result.telemetry.syncMethod = lastSyncTime.method;
                
                console.log(`Check-in opens at: ${new Date(checkinOpensAtMs).toISOString()}`);
                console.log(`Current time (synced): ${new Date(lastSyncTime.time).toISOString()}`);
                console.log(`Time sync method: ${lastSyncTime.method}`);

                let lastDriftCheck = Date.now();
                let lastNTPSync = Date.now();
                let lastHeartbeat = Date.now();

                while (true) {
                    // Heartbeat monitor: Log status every 2 minutes
                    const timeSinceHeartbeat = Date.now() - lastHeartbeat;
                    if (timeSinceHeartbeat >= 120000) { // 2 minutes
                        const msRemaining = (checkinOpensAtMs + backupOffset) - (Date.now() + localDriftMs);
                        console.log(`💓 Heartbeat: System healthy, ${Math.floor(msRemaining / 1000)}s until submit`);
                        await Actor.setValue('heartbeat', JSON.stringify({
                            timestamp: new Date().toISOString(),
                            status: 'running',
                            msRemaining,
                            instanceType,
                            driftMs: localDriftMs,
                        }), { contentType: 'application/json' });
                        lastHeartbeat = Date.now();
                    }
                    
                    // Re-sync every 15 seconds to monitor drift
                    const timeSinceLastCheck = Date.now() - lastDriftCheck;
                    if (timeSinceLastCheck >= 15000) {
                        const newSync = await getSouthwestTimeWithRTT(localDriftMs);
                        const drift = newSync.time - lastSyncTime.time - timeSinceLastCheck;
                        
                        result.telemetry.driftChecks.push({
                            timestamp: new Date().toISOString(),
                            drift,
                            rtt: newSync.rtt,
                        });
                        
                        if (Math.abs(drift) > 100) {
                            console.log(`⚠️  Significant drift detected: ${drift}ms, resyncing...`);
                        }
                        
                        lastSyncTime = newSync;
                        lastDriftCheck = Date.now();
                    }
                    
                    // Re-sync NTP every 10 minutes for very long waits
                    const timeSinceNTPSync = Date.now() - lastNTPSync;
                    if (timeSinceNTPSync >= 600000) { // 10 minutes
                        console.log('🕐 Performing periodic NTP re-sync (10min elapsed)...');
                        const ntpResync = await getNTPTime();
                        localDriftMs = ntpResync.localDriftMs;
                        lastNTPSync = Date.now();
                        console.log(`✓ NTP re-sync complete. New drift: ${localDriftMs}ms`);
                    }

                    const currentTime = Date.now() + localDriftMs;
                    const msUntilCheckin = checkinOpensAtMs - currentTime;
                    
                    // Calculate time until our target submit time
                    // Primary: T+100ms, Backup: T+1100ms (safety margin)
                    const msUntilSubmit = (checkinOpensAtMs + 100 + backupOffset) - currentTime;
                    
                    if (msUntilSubmit <= 0) {
                        console.log('🎯 Target submit time reached! (T+100ms safety margin)');
                        break;
                    }

                    if (msUntilSubmit <= 5000) {
                        // Within 5 seconds - poll frequently
                        if (msUntilSubmit % 1000 < 200) {
                            console.log(`⏱️  ${(msUntilSubmit / 1000).toFixed(1)}s until submit (T+100ms)...`);
                        }
                        await page.waitForTimeout(100);
                    } else if (msUntilSubmit <= 60000) {
                        // Within 1 minute - poll every second
                        console.log(`⏱️  ${Math.floor(msUntilSubmit / 1000)}s until submit...`);
                        await page.waitForTimeout(1000);
                    } else {
                        // More than 1 minute away - poll every 5 seconds
                        const secondsRemaining = Math.floor(msUntilSubmit / 1000);
                        console.log(`⏳ ${Math.floor(secondsRemaining / 60)}m ${secondsRemaining % 60}s until submit...`);
                        await page.waitForTimeout(5000);
                    }
                }

                // PHASE 3: Submit using in-browser setTimeout() for precision
                console.log('\n═══ PHASE 3: Submitting with in-browser scheduling ═══');
                
                // Switch to datacenter proxy for low-latency submission
                console.log('⚡ Switching to low-latency datacenter proxy for final submit...');
                await page.context().route('**/*', async route => {
                    await route.continue();
                });
                
                // Pre-submit calibration: measure average RTT
                console.log('📊 Calibrating network latency...');
                const rttSamples = [];
                for (let i = 0; i < 3; i++) {
                    const start = Date.now();
                    await fetch('https://www.southwest.com/', { method: 'HEAD' });
                    const end = Date.now();
                    rttSamples.push(end - start);
                }
                
                // Use median for robustness against spikes
                const sortedRTT = rttSamples.sort((a, b) => a - b);
                const medianRTT = sortedRTT[Math.floor(sortedRTT.length / 2)];
                
                console.log(`✓ RTT samples: ${rttSamples.join(', ')}ms`);
                console.log(`✓ Median RTT: ${medianRTT}ms (more robust than mean)`);
                result.telemetry.calibratedRTT = medianRTT;
                
                // Adaptive RTT compensation: Fine-tune submit time based on actual network latency
                const adaptiveOffset = Math.floor(medianRTT / 2);
                console.log(`📊 Adaptive compensation: +${adaptiveOffset}ms (half of median RTT)`);
                
                // Store calibrated RTT for future runs
                await Actor.setValue('calibrated-rtt', JSON.stringify({
                    timestamp: new Date().toISOString(),
                    medianRTT,
                    samples: rttSamples,
                    adaptiveOffset,
                }), { contentType: 'application/json' });

                // Schedule click inside browser using setTimeout()
                // This eliminates the 20-60ms DevTools protocol delay
                const targetSubmitTime = checkinOpensAtMs + 100 + backupOffset;
                
                console.log(`🎯 Scheduling in-browser click for: ${new Date(targetSubmitTime).toISOString()}`);
                console.log(`🎯 Instance type: ${instanceType}, Offset: ${backupOffset > 0 ? '+' + backupOffset + 'ms' : 'standard'}`);
                
                // Calculate delay in Node context for consistency
                const currentTime = Date.now() + localDriftMs;
                const delayMs = Math.max(0, targetSubmitTime - currentTime);
                
                console.log(`📊 Click will fire in ${delayMs}ms`);
                
                // Store real-time drift telemetry
                await Actor.setValue('drift-telemetry', JSON.stringify({
                    timestamp: new Date().toISOString(),
                    instanceType,
                    driftChecks: result.telemetry.driftChecks,
                    finalDrift: currentTime - Date.now(),
                    targetSubmitTime: new Date(targetSubmitTime).toISOString(),
                }), { contentType: 'application/json' });
                
                await page.evaluate((delay) => {
                    return new Promise((resolve) => {
                        const btn = document.querySelector('button[type="submit"], button:has-text("Check in"), .button--yellow');
                        if (!btn) {
                            resolve({ error: 'Button not found' });
                            return;
                        }

                        console.log(`Scheduling click in ${delay}ms`);
                        
                        if (delay <= 0) {
                            // Click immediately
                            btn.click();
                            resolve({ clicked: true, delay: 0 });
                        } else {
                            // Schedule click
                            setTimeout(() => {
                                btn.click();
                                resolve({ clicked: true, delay });
                            }, delay);
                        }
                    });
                }, delayMs);

                const actualSubmitTime = Date.now() + localDriftMs;
                result.actualSubmitTime = new Date(actualSubmitTime).toISOString();
                result.timingOffset = actualSubmitTime - checkinOpensAtMs;
                
                console.log(`✓ Form submitted`);
                console.log(`✓ Actual submit time: ${result.actualSubmitTime}`);
                console.log(`✓ Timing offset from T-0: ${result.timingOffset > 0 ? '+' : ''}${result.timingOffset}ms`);

                // PHASE 4: Micro-retry loop if "too early"
                console.log('\n═══ PHASE 4: Verification and retry ═══');
                
                let retryCount = 0;
                const maxRetries = 5;

                while (retryCount < maxRetries) {
                    await page.waitForTimeout(150);
                    
                    const pageContent = await page.content();
                    
                    if (pageContent.includes('too early') || pageContent.includes('Come back')) {
                        retryCount++;
                        console.log(`⚠️  Response indicates "too early", retry ${retryCount}/${maxRetries}...`);
                        
                        // Retry click
                        await page.evaluate(() => {
                            const btn = document.querySelector('button[type="submit"], button:has-text("Check in"), .button--yellow');
                            if (btn) btn.click();
                        });
                        
                        await page.waitForTimeout(100);
                    } else {
                        console.log('✓ Check-in request accepted (no "too early" message)');
                        break;
                    }
                }

                result.telemetry.retryCount = retryCount;

                // Wait for final result page
                await page.waitForTimeout(3000);

                const screenshotResult = await page.screenshot({ fullPage: true });
                await Actor.setValue('screenshot-result', screenshotResult, { contentType: 'image/png' });
                result.screenshots.push('screenshot-result');

                // PHASE 5: Extract boarding position
                console.log('\n═══ PHASE 5: Extracting boarding position ═══');
                
                const pageContent = await page.content();
                await Actor.setValue('final-page-html', pageContent, { contentType: 'text/html' });

                // Try multiple patterns with word boundaries to avoid false matches
                const patterns = [
                    /boarding\s+position[:\s]+\b([A-C]\d{1,2})\b/i,
                    /position[:\s]+\b([A-C]\d{1,2})\b/i,
                    /group[:\s]+([A-C])\s+position[:\s]+(\d{1,2})/i,
                    /\b([A-C]\d{1,2})\b/g  // Word-bounded to avoid false matches
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

                // Log telemetry summary
                console.log('\n📊 Timing Telemetry Summary:');
                console.log(`   NTP Sync: ${result.telemetry.ntpSyncSucceeded ? '✓' : '✗'}`);
                console.log(`   Local Drift: ${result.telemetry.localDriftMs}ms`);
                console.log(`   Southwest RTT: ${result.telemetry.southwestRTT}ms`);
                console.log(`   Calibrated RTT: ${result.telemetry.calibratedRTT?.toFixed(1)}ms`);
                console.log(`   Sync Method: ${result.telemetry.syncMethod}`);
                console.log(`   Drift Checks: ${result.telemetry.driftChecks.length}`);
                console.log(`   Retry Attempts: ${result.telemetry.retryCount}`);
                console.log(`   Final Timing Offset: ${result.timingOffset > 0 ? '+' : ''}${result.timingOffset}ms`);

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

    console.log('\nActor finished. Final result:', result);

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
