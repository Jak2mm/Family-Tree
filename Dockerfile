# Stage 1: build the web pages (Node is only needed here, not in the running app).
FROM node:22-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: the app itself.
FROM python:3.13-slim
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HOME=/tmp \
    XDG_CACHE_HOME=/tmp/.cache \
    FAMILY_TREE_DATA_DIR=/data \
    FAMILY_TREE_PHOTOS_DIR=/photos \
    FAMILY_TREE_BACKUPS_DIR=/backups

# Time-zone names such as Australia/Sydney need the system time-zone list.
RUN apt-get update \
    && apt-get install -y --no-install-recommends tzdata \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv/backend
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

# /data is a Docker volume. It is open to any user so the "user:" setting in docker-compose.yml
# can be changed to match the NAS without the database folder becoming unwritable.
RUN mkdir /data && chmod 0777 /data

COPY backend/app ./app
COPY --from=web /web/dist /srv/frontend/dist
COPY docker-entrypoint.sh /usr/local/bin/ft-entrypoint
RUN chmod 0755 /usr/local/bin/ft-entrypoint

# Runs as a normal (non-root) user. docker-compose.yml may switch the number to match the NAS.
USER 1000:1000
EXPOSE 8000
VOLUME /data

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4).status == 200 else 1)"]

ENTRYPOINT ["ft-entrypoint"]
# Exactly one worker: the backup scheduler and the data-folder lock assume a single process.
CMD ["uvicorn", "app.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
