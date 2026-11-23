# MC Server Panel als Container: Panel (Node.js) und Java für den Minecraft-Server in einem Image.
# Bauen:   docker build -t mc-server-panel .
# Starten: siehe docker-compose.yml
# Java 21 passt zu Minecraft ab 1.20.5. Für ältere Versionen: docker build --build-arg JAVA_IMAGE=eclipse-temurin:17-jre .
ARG JAVA_IMAGE=eclipse-temurin:21-jre
FROM ${JAVA_IMAGE} AS java

FROM node:22-bookworm-slim
# Programme, die das Panel aufruft: tar/unzip (Backups, Entpacken), rsync/ssh (Backup-Kopie), ps/du/df (Messwerte)
RUN apt-get update \
 && apt-get install -y --no-install-recommends tar unzip rsync openssh-client procps ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=java /opt/java/openjdk /opt/java/openjdk
ENV JAVA_HOME=/opt/java/openjdk PATH=/opt/java/openjdk/bin:$PATH

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js CHANGELOG.md CHANGELOG.de.md ./
COPY lib ./lib
COPY routes ./routes
COPY public ./public
COPY dev ./dev

# Alle Daten (config.json, Protokoll, Server-Ordner, Backups) liegen im Volume /data
ENV MCPANEL_DATA=/data MCPANEL_HOST=0.0.0.0 MCPANEL_PORT=8080 NODE_ENV=production
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 8080 25565
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.MCPANEL_PORT||8080)+'/login').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server.js"]
