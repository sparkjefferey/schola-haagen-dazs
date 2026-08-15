# ---- 构建阶段 ----
# 用 Debian 系（slim）而不是 alpine，better-sqlite3 原生模块在 glibc 下预编译命中率最高，少踩坑
FROM node:22-slim AS build
WORKDIR /app
# 安装原生模块编译所需的编译工具（python3/make/g++），保险起见
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- 运行阶段 ----
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# 运行阶段也装编译工具：better-sqlite3 是生产依赖，npm ci 时若预编译缺失可本地编译
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
# 只拷贝构建产物与运行必需文件
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.mjs ./next.config.mjs
COPY --from=build /app/scripts ./scripts
# 数据库目录：务必挂到 volume（见 docker-compose.yml），否则容器重建数据丢失
RUN mkdir -p /app/data
VOLUME /app/data
# 安全加固：整体归属非 root 的 node 用户(uid 1000)，配合 docker-compose 的 user:"node"，
# 使运行期（含 schola-data 卷初始化）对 /app/data 可写，同时应用不以 root 运行。
RUN chown -R node:node /app
EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "-p", "3000"]
