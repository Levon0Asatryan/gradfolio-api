FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Lifecycle scripts are not needed to build, and `prepare` installs git hooks
# that mean nothing inside an image.
RUN npm ci --ignore-scripts
COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
# --ignore-scripts is required, not tidy: `prepare` runs husky, a devDependency
# absent here. It also keeps install scripts out of the runtime image.
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/api/main.js"]
