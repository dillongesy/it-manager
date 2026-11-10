# Setup wizard served before the stack is installed. No dependencies.
FROM node:24-alpine
WORKDIR /app
COPY package.json server.js ./
COPY public ./public
USER node
EXPOSE 8443
CMD ["node", "server.js"]
