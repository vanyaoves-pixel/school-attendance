FROM node:22-slim
WORKDIR /app
COPY package.json server.mjs ./
COPY public ./public
ENV PORT=3000
EXPOSE 3000
CMD ["npm","start"]
