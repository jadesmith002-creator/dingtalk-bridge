FROM node:18-alpine
WORKDIR /app
COPY package.json .
RUN npm install --registry=https://registry.npmmirror.com
COPY bridge.js .
CMD ["node", "bridge.js"]
