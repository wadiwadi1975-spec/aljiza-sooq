FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p data public/uploads
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["sh", "-c", "node seed.js && node app.js"]
