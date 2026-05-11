# HRAI / InnerAI HR 系統

HRAI 是一個招聘流程工作台，覆蓋職缺建立、職位字典維護、CV 上傳與 AI 解析、候選人投遞管理、Blacklist、內部人員名單與項目人員調動。

## 技術棧

- 前端：Vue 3、Vite
- 後端：Node.js 原生 HTTP server、ESM
- 資料庫：MySQL 8
- CV 儲存：本機檔案系統 `server/storage/cv`
- AI 相關：可配置 OpenAI-compatible Chat Completions API；PDF 文字抽取可使用 Python `pypdf` 作為輔助

## 主要功能

- 帳號註冊、登入、token session、個人資料與密碼修改
- 職位字典維護：以 `finance-job-positions.json` 作為職位能力模型來源
- 職缺管理：建立職缺快照、更新職缺狀態、查看職缺下候選人
- CV 上傳：單份或批量快取、解析、人工校正、確認匹配
- AI 分析檔：抽取姓名、聯絡方式、學歷、工作年限、語言、技能、證書、行業、項目經歷、目標職位、薪資與入職意願
- 候選人管理：跨職缺查看候選人、更新候選人狀態與備註、預覽/下載 CV、編輯 AI 分析欄位
- Blacklist：按電話或 Email 命中候選人風險，支援候選人清單快速加入
- 內部人員與項目管理：維護人員、項目、在組安排、調動記錄與 CSV 匯入

## 目錄結構

```text
src/                         Vue 前端
  views/                     主要頁面
  components/                共用元件與業務元件
  scripts/                   前端資料處理、狀態與 API helper
server/                      Node 後端
  index.js                   API 入口與主要業務流程
  scripts/database/          MySQL 建庫建表
  scripts/llm/               CV 抽取、LLM client、匹配邏輯
  scripts/jobs/              職位字典讀寫與校驗
  prompts/                   LLM prompt
finance-job-positions.json   職位字典資料
docker-compose.yml           MySQL + 後端 + 前端開發環境
```

## 環境變數

常用設定：

```env
PORT=3001
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=12345
MYSQL_DATABASE=hrai
HRAI_DATABASE=hrai
VITE_API_BASE_URL=http://localhost:3001
```

LLM 設定：

```env
LLM_API_URL=
LLM_CHAT_COMPLETIONS_URL=
LLM_API_KEY=
LLM_MODEL=
LLM_MAX_TOKENS=2500
LLM_DISABLE_THINKING=false
LLM_EXTRA_BODY_JSON={}
```

也可使用 `CV_LLM_*` 前綴覆蓋 CV 抽取專用設定，例如 `CV_LLM_API_KEY`、`CV_LLM_MODEL`。

登入 token 有效期可用以下設定調整：

```env
AUTH_AUTO_LOGIN_TTL_MS=
AUTH_AUTO_LOGIN_TTL_MINUTES=
```

## 本機開發

1. 安裝前端依賴：

```sh
npm install
```

2. 安裝後端依賴：

```sh
npm --prefix server install
```

3. 啟動 MySQL，並確認 `.env` 中的連線設定正確。後端啟動時會自動建立資料庫與資料表。

4. 啟動後端：

```sh
npm --prefix server run dev
```

5. 啟動前端：

```sh
npm run dev
```

前端預設連到 `VITE_API_BASE_URL`，未設定時為 `http://localhost:3001`。

## Docker 開發

建議在 `.env` 中設定 Docker 對外 API 位址：

```env
VITE_API_BASE_URL=http://localhost:7001
```

```sh
docker compose up --build
```

預設對外端口：

- MySQL：`localhost:7000`
- 後端 API：`http://localhost:7001`
- 前端：`http://localhost:7002`

Docker 後端容器會安裝 Python、`pypdf` 與 server 依賴，適合需要 PDF 文字抽取的環境。

## 常用命令

```sh
npm run dev       # 前端 Vite dev server
npm run build     # 前端 production build
npm run preview   # 預覽前端 build
npm --prefix server run dev  # 後端 API
```

## 重要資料與限制

- 職位字典保存於 `finance-job-positions.json`，更新後只影響之後新建職缺或重新觸發的匹配。
- 職缺建立時會將字典內容固化為 `job_posts.job_snapshot_json`，避免字典後續變更影響既有職缺。
- CV 原始檔保存於 `server/storage/cv`，資料庫只保存 storage key 與抽取結果。
- 註冊驗證碼目前輸出在後端 console log，未接入 Email 發送服務。
- 本專案目前沒有獨立自動化測試腳本；提交前建議至少執行 `npm run build` 與 `node --check server/index.js`。
