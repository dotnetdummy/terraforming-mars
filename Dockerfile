# Define the version once at the top
ARG NODE_VERSION=22-alpine3.21

# Intermediate image - base for building and installing dependencies
FROM node:${NODE_VERSION} AS install

# Install required tools
RUN apk add --no-cache --virtual .gyp git python3 py3-setuptools make g++ \
  && ln -sf python3 /usr/bin/python

WORKDIR /usr/src/app

# Install dependencies first, to cache the image.
COPY ["package.json", "package-lock.json", "./"]

# Install dependencies
RUN npm ci


# Create image for application building
FROM install AS builder

# Copy sources
COPY . .

# Baked into the client build metadata by make:static.
ARG SOURCE_VERSION
ENV SOURCE_VERSION=$SOURCE_VERSION

# Run building
RUN npm run build


# Create image to prepare prod dependencies to be copied from
FROM install AS installprod

RUN npm ci --production --prefer-offline


# Target image
FROM node:${NODE_VERSION}

WORKDIR /usr/src/app

# Add user tfm
RUN adduser -S -D -h /usr/src/app tfm \
  && mkdir /usr/src/app/db \
  && chown -R tfm:nogroup .

USER tfm

# Copy required files.

COPY ["package.json", "package-lock.json", "./"]

# Copy dependencies from intermediate image
COPY --from=installprod /usr/src/app/node_modules ./node_modules

# Copy built app from intermediate image
COPY --from=builder /usr/src/app/build ./build

COPY --from=builder /usr/src/app/assets ./assets

# Run command.

EXPOSE 8080

# HEAD / answers 200 before routing, and the process only listens after the database connects.
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/',{method:'HEAD'}).then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["npm", "run", "start"]
