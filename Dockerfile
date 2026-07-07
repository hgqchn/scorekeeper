FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY client/package*.json client/
RUN npm --prefix client install

COPY . .
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY package*.json ./
RUN npm install --omit=dev
COPY --from=build /app/server server
COPY --from=build /app/client/dist client/dist
COPY --from=build /app/data data

EXPOSE 3000
CMD ["npm", "start"]
