# Multi-stage build for the Angular app. Build context is `frontend/` (see
# docker-compose.yaml `web` service: `context: ./frontend`).
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
# `npm ci` (not `npm install`) so the image is built from the exact locked
# dependency tree — the same command the README tells a reviewer to run.
RUN npm ci

COPY . .
RUN npm run build

# Angular's application builder (@angular/build:application) nests the
# static output under dist/<project-name>/browser (confirmed against an
# actual local build; the project name here is "relay-dashboard" per
# angular.json), not directly under dist/<project-name>.
FROM nginx:alpine AS final
COPY --from=build /app/dist/relay-dashboard/browser /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
