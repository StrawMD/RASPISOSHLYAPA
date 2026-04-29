FROM node:20-slim AS base

RUN apt-get update && \
    apt-get install -y python3 python3-pip python3-venv cron sqlite3 curl && \
    rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip install ortools openpyxl

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .
RUN npx prisma generate
RUN npm run build

COPY scripts/backup.sh /usr/local/bin/backup.sh
RUN chmod +x /usr/local/bin/backup.sh
RUN echo "0 3 * * * /usr/local/bin/backup.sh >> /var/log/backup.log 2>&1" | crontab -

ENV NODE_ENV=production
ENV DATABASE_URL="file:./prisma/data.db"

EXPOSE 3000

CMD ["sh", "-c", "cron && npx prisma migrate deploy && npm start"]
