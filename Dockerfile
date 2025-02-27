FROM node:18-slim

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --production

# Copy application code
COPY . .

# Create necessary directories
RUN mkdir -p data/images logs

# Make port 3000 available
EXPOSE 3000

# Run the application
CMD ["node", "src/index.js"] 