# 单词记忆助手

一个本地单词背诵网站，支持添加单词、复习、词库管理，以及通过有道智云 API 查询英文中文释义。

## 本地运行

1. 复制 `.env.example` 为 `.env`
2. 在 `.env` 中填写有道智云的应用 ID 和应用密钥
3. 启动服务

```bash
npm start
```

打开：

```txt
http://localhost:3000/word.html
```

## 环境变量

```env
YOUDAO_APP_KEY=你的有道应用ID
YOUDAO_APP_SECRET=你的有道应用密钥
PORT=3000
```

不要把 `.env` 上传到 GitHub。
