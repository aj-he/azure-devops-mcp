# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

# ---- Build stage ----
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files and install all dependencies (including devDependencies for build)
COPY package*.json ./
RUN npm ci --ignore-scripts

# Copy source and config files
COPY tsconfig.json ./
COPY src/ ./src/

# Build the project (prebuild generates src/version.ts automatically)
RUN npm run build

# ---- Production stage ----
FROM node:20-alpine AS production

WORKDIR /app

# Copy node_modules from builder (includes tsconfig-paths needed at runtime)
COPY --from=builder /app/node_modules ./node_modules

# Copy compiled output from builder stage
COPY --from=builder /app/dist ./dist

COPY package.json ./

EXPOSE 3000

CMD ["node", "-r", "tsconfig-paths/register", "dist/server-sse.js"]
