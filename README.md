# Southwest Airlines Auto Check-In Actor

This Apify actor automatically checks in passengers for Southwest Airlines flights.

## Features

- ✅ Automated form filling with confirmation number and passenger details
- ✅ Handles Southwest's check-in flow end-to-end
- ✅ Extracts boarding position from confirmation page
- ✅ Takes screenshots at each step for debugging
- ✅ Robust error handling and retries
- ✅ Full page HTML capture for analysis

## Input

```json
{
  "confirmationNumber": "ABC123",
  "firstName": "JOHN",
  "lastName": "DOE"
}
```

## Output

```json
{
  "success": true,
  "boardingPosition": "A24",
  "confirmationNumber": "ABC123",
  "timestamp": "2025-12-24T12:00:00Z",
  "error": null,
  "screenshots": [
    "screenshot-initial",
    "screenshot-form-filled",
    "screenshot-checkin-page",
    "screenshot-result"
  ]
}
```

## Setup Instructions

### 1. Deploy to Apify

**Option A: Via Apify Console (Easiest)**

1. Go to https://console.apify.com/actors
2. Click "Create new" → "Empty actor"
3. Name it "southwest-checkin-actor"
4. In the "Source" tab, select "Multiple source files"
5. Upload all files from this directory
6. Click "Build" to create the actor

**Option B: Via Apify CLI**

```bash
# Install Apify CLI
npm install -g apify-cli

# Login to Apify
apify login

# Create and deploy actor
cd southwest-checkin-actor
apify push
```

### 2. Test the Actor

**Manual Test via Apify Console:**

1. Go to your actor page in Apify console
2. Click "Try it"
3. Enter test input:
   ```json
   {
     "confirmationNumber": "YOUR_CONFIRMATION",
     "firstName": "YOUR_FIRST_NAME",
     "lastName": "YOUR_LAST_NAME"
   }
   ```
4. Click "Start"
5. Watch the run logs and check screenshots

**Test via API:**

```bash
curl -X POST \
  https://api.apify.com/v2/acts/YOUR_USERNAME~southwest-checkin-actor/runs \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "confirmationNumber": "ABC123",
    "firstName": "JOHN",
    "lastName": "DOE"
  }'
```

### 3. Check Results

After the run completes:

1. **Dataset**: View structured results in the Dataset tab
2. **Screenshots**: Check Key-Value Store for visual confirmation of each step
3. **Logs**: Review console output for detailed execution flow
4. **HTML**: Download final page HTML if boarding position parsing fails

## Important Notes

### Timing Considerations

- Southwest check-in opens exactly 24 hours before departure
- This actor takes ~5-15 seconds to complete (depending on Southwest's response time)
- For best boarding positions, trigger this actor as close to check-in opening as possible
- Consider triggering at T-5 seconds to account for actor startup time

### Selector Maintenance

Southwest may update their website. If the actor starts failing:

1. Check the screenshots in Key-Value Store to see where it got stuck
2. Inspect the HTML dump to find new selectors
3. Update the selectors in `src/main.js`:
   - `#confirmationNumber` - confirmation number input
   - `#firstName` - first name input
   - `#lastName` - last name input
   - Button selectors for "Check In" buttons

### Error Handling

The actor handles:
- Missing input fields
- Page load timeouts
- Element not found errors
- Network issues
- Captures screenshots at failure points

### Privacy & Compliance

- Only use this for your own flights
- Respect Southwest's Terms of Service
- Don't abuse or spam their systems
- This is for personal use only

## Debugging

If check-in fails:

1. Look at `screenshot-error` in Key-Value Store
2. Check `final-page-html` for the actual page content
3. Review logs for specific error messages
4. Common issues:
   - Wrong confirmation number format
   - Name mismatch with reservation
   - Check-in not yet open (too early)
   - Check-in already completed
   - Southwest website changes

## Integration with Scheduler

Once tested, you can trigger this actor programmatically:

```javascript
// Trigger via Apify API
const response = await fetch(
  `https://api.apify.com/v2/acts/${ACTOR_ID}/runs`,
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${APIFY_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      confirmationNumber: 'ABC123',
      firstName: 'JOHN',
      lastName: 'DOE',
    }),
  }
);

const run = await response.json();
console.log('Run started:', run.data.id);

// Poll for results
const resultUrl = `https://api.apify.com/v2/acts/${ACTOR_ID}/runs/${run.data.id}/dataset/items`;
```

## Cost Estimation

Apify free tier includes:
- $5 worth of platform credits monthly
- Each run costs approximately $0.02-0.05 depending on duration

For occasional personal use, this should stay within free tier limits.

## Support

If you encounter issues:
1. Check Apify actor logs
2. Review screenshots in Key-Value Store
3. Verify Southwest website hasn't changed
4. Test with a known-good reservation

## License

MIT - Personal use only
