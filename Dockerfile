FROM node:22-slim

# Install required system dependencies
RUN apt-get update && apt-get install -y \
    git \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Install app dependencies
COPY package*.json ./
RUN npm install

# Bundle app source
COPY . .

# Build TypeScript code
RUN npm run build

# Create temp directory for project generation
RUN mkdir -p temp

# Expose port
EXPOSE 3000

# Start the server using compiled JavaScript
CMD [ "node", "dist/index.js" ]