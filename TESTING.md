# Southwest Check-In Actor Testing Guide

## Pre-Testing Checklist

Before you start, you need:
- [ ] Active Southwest reservation (or use test data)
- [ ] Apify account (free tier is fine)
- [ ] Confirmation number, first name, last name

## Phase 1: Deploy the Actor

### Method 1: Apify Console (Recommended for First Test)

1. **Create Actor**
   - Go to https://console.apify.com/actors
   - Click "Create new" button (top right)
   - Select "Empty actor"
   - Name: `southwest-checkin-actor`

2. **Upload Code**
   - Click on "Source" tab
   - Change source type to "Multiple source files"
   - Upload these files:
     ```
     src/main.js
     package.json
     Dockerfile
     .actor/actor.json
     .actor/input_schema.json
     ```
   - Or use "Git repository" option and point to your repo

3. **Build Actor**
   - Click "Build" button (top right)
   - Wait for build to complete (~2-3 minutes)
   - Check build log for any errors

### Method 2: Apify CLI (For Developers)

```bash
# Install CLI
npm install -g apify-cli

# Login
apify login

# Navigate to actor directory
cd southwest-checkin-actor

# Push to Apify
apify push
```

## Phase 2: Manual Test (Dry Run)

**IMPORTANT**: Test with a reservation that has check-in currently OPEN (within 24 hours of departure).

### Test Run Steps

1. **Navigate to Actor**
   - Go to your actor page in Apify console
   - Click "Try it" tab

2. **Enter Test Input**
   ```json
   {
     "confirmationNumber": "YOUR_REAL_CONFIRMATION",
     "firstName": "YOUR_FIRST_NAME",
     "lastName": "YOUR_LAST_NAME"
   }
   ```
   - Use actual data from a real reservation
   - Names should match EXACTLY as they appear on reservation
   - Confirmation number is case-sensitive (usually all caps)

3. **Start the Run**
   - Click "Start" button
   - Watch the logs in real-time

4. **Monitor Progress**
   
   Look for these log messages:
   ```
   ✓ Starting Southwest check-in for: { confirmationNumber: 'ABC123', ... }
   ✓ Navigating to check-in page...
   ✓ Initial page loaded
   ✓ Filling confirmation number...
   ✓ Filling first name...
   ✓ Filling last name...
   ✓ Form filled
   ✓ Clicking retrieve reservation button...
   ✓ On check-in confirmation page
   ✓ Clicking final check-in button...
   ✓ Successfully checked in! Boarding position: A24
   ```

## Phase 3: Verify Results

### Check the Dataset

1. Go to "Storage" → "Dataset" tab
2. You should see an entry like:
   ```json
   {
     "success": true,
     "boardingPosition": "A24",
     "confirmationNumber": "ABC123",
     "timestamp": "2025-12-24T12:00:00Z",
     "error": null,
     "screenshots": ["screenshot-initial", ...]
   }
   ```

### Review Screenshots

1. Go to "Storage" → "Key-value store" tab
2. Download these images to see the flow:
   - `screenshot-initial` - Check-in form page
   - `screenshot-form-filled` - After entering details
   - `screenshot-checkin-page` - Final check-in button page
   - `screenshot-result` - Boarding pass confirmation

### Check HTML Dump

1. In Key-value store, find `final-page-html`
2. Download and open in browser
3. Verify it shows the confirmation page

## Phase 4: Test Error Cases

### Test 1: Invalid Confirmation Number

Input:
```json
{
  "confirmationNumber": "FAKE99",
  "firstName": "TEST",
  "lastName": "USER"
}
```

Expected: Error message in result, screenshot showing error page

### Test 2: Check-In Not Yet Open

Input: Use a flight more than 24 hours away

Expected: Southwest should show "check-in not available yet" message

### Test 3: Already Checked In

Input: Use the same confirmation you just checked in with

Expected: Southwest should show "already checked in" message

## Phase 5: API Test

Once manual tests pass, test via API:

```bash
# Get your API token from Apify console
# Settings → Integrations → API Token

# Trigger actor via API
curl -X POST \
  "https://api.apify.com/v2/acts/YOUR_USERNAME~southwest-checkin-actor/runs?token=YOUR_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "confirmationNumber": "ABC123",
    "firstName": "JOHN",
    "lastName": "DOE"
  }'

# You'll get a response with run ID:
{
  "data": {
    "id": "run_id_here",
    "actId": "...",
    "status": "RUNNING",
    ...
  }
}
```

### Poll for Results

```bash
# Wait a few seconds, then check the run status
curl "https://api.apify.com/v2/acts/YOUR_USERNAME~southwest-checkin-actor/runs/RUN_ID?token=YOUR_API_TOKEN"

# Get the dataset items (results)
curl "https://api.apify.com/v2/acts/YOUR_USERNAME~southwest-checkin-actor/runs/RUN_ID/dataset/items?token=YOUR_API_TOKEN"
```

## Phase 6: Performance Test

Test the timing:

1. **Start Time**: Note when you trigger the actor
2. **Check Logs**: Find "Successfully checked in!" timestamp
3. **Calculate**: End time - Start time = Total duration

Typical duration: 8-15 seconds
- 2-3s: Actor startup
- 3-5s: Page load and form fill
- 2-4s: Check-in submission
- 1-2s: Result parsing

## Troubleshooting

### Issue: "Could not find confirmation number input field"

**Solution**: Southwest changed their HTML. You need to:
1. Check `screenshot-initial` to see the actual page
2. Right-click on confirmation field → Inspect
3. Find the actual `id` or `name` attribute
4. Update the selector in `src/main.js` line ~63

### Issue: "Check-in button not found"

**Solution**: Same as above - inspect the button and update selector

### Issue: "Could not parse boarding position"

**Solution**: 
1. Download `final-page-html` from Key-value store
2. Open in browser and find where boarding position appears
3. Update the selectors in `src/main.js` around line ~140

### Issue: Actor times out

**Solution**:
- Increase timeouts in `src/main.js`
- Check if Southwest is experiencing issues
- Try running again

### Issue: "Unauthorized access" or blocked

**Solution**:
- Southwest may have detected automation
- Try enabling proxy in the actor (already configured)
- Wait a few minutes and try again
- Consider adjusting user agent

## Success Criteria

✅ Actor completes without errors
✅ Boarding position is extracted correctly
✅ Screenshots show successful flow
✅ API trigger works
✅ Total time < 20 seconds
✅ Can handle error cases gracefully

## Next Steps

Once all tests pass:
1. Note your Actor ID (found in Apify console URL)
2. Note your API token
3. Ready to integrate with Hetzner daemon
4. Daemon will trigger this actor at T-0 for each flight

## Cost Tracking

Check your Apify usage:
- Go to Settings → Usage and limits
- Each test run costs ~$0.02-0.05
- Free tier gives you ~100-250 runs/month
- Monitor your usage to stay within free tier

## Real-World Test

For the ultimate test:
1. Book a cheap Southwest flight (or use existing reservation)
2. Wait until exactly 24 hours before departure
3. Trigger the actor manually at T-0
4. Verify you get a good boarding position (A-group preferred)
5. Check Southwest website/app to confirm check-in succeeded

## Questions to Answer After Testing

- [ ] Did actor complete successfully?
- [ ] Was boarding position extracted correctly?
- [ ] How long did the full process take?
- [ ] Did screenshots capture all steps?
- [ ] Can you trigger via API successfully?
- [ ] What boarding position did you get?
- [ ] Are there any error cases that need handling?

Record your findings and we'll use them to optimize the daemon integration!
