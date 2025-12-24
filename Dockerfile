# Use Apify's base image with Playwright
FROM apify/actor-node-playwright-chrome:20

# Copy all files
COPY package*.json ./

# Install dependencies
RUN npm install --include=dev

# Copy source code
COPY . ./

# Run the actor
CMD npm start
