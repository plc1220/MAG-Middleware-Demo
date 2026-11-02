FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js demo-control.js google-auth.js chat-engine.js chat-http.js ./
COPY public ./public
USER node
EXPOSE 8080
CMD ["npm", "start"]
