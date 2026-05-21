# CODE_REVIEW_REPORT

## 走查範圍與方法

- 走查範圍：`server/`、`src/` 主要業務代碼、前端元件、CV 結構化工具、資料庫初始化腳本與專案設定。
- 排除範圍：`node_modules/`、`dist/`、`logs/`、`server/storage/cv/`、示例 PDF、二進制檔與建置產物。
- 方法：以靜態閱讀為主，聚焦 CV 上傳/解析/匹配、候選人列表與篩選、狀態歷史、對接人、黑名單/重複投遞、簡繁搜尋與通用互動元件。
- 本次變更原則：不改功能、不重構、不格式化；只補充必要註釋並記錄工程風險。

## 主要風險與問題

### 高風險

1. `server/index.js:289` 會把登入/註冊驗證碼輸出到 console。
   - 風險：若生產環境收集 console log，驗證碼可能被日誌平台、終端記錄或第三方服務讀取。
   - 建議：移除該 log，或至少以 `NODE_ENV !== 'production'` 嚴格包住；生產環境只記錄請求事件，不記錄 code 本身。

### 中風險

2. `server/index.js:4694` 仍由單一 `http.createServer` 內的大量 if 分支承載路由。
   - 風險：`server/index.js` 已接近五千行，API 分支、資料轉換、DB 操作與回應組裝混在一起；新增相近路由時容易被前序條件吃掉，回歸測試也較難局部化。
   - 建議：拆出 `routes/`、`services/`、`repositories/`，先從 CV、候選人投遞、職位字典、認證四塊切分。

3. `src/components/CvUploadFlowPanel.vue:1021` 有 `startBatchProcessingLegacy` 舊流程；其中 `src/components/CvUploadFlowPanel.vue:1122`、`src/components/CvUploadFlowPanel.vue:1123` 使用目前檔案內未定義的 `batchSuccessCount` / `batchErrorCount`。
   - 風險：目前看起來是未掛載的死碼，所以 build 不會失敗；但未來若誤接回 UI，會在執行時直接報錯。
   - 建議：確認新版批量流程穩定後刪除 legacy 函式，或補測並修復依賴狀態。

4. `server/scripts/database/index.js:72` 的 `ensureCvTables` 在服務啟動時做多個 `CREATE TABLE` / `ALTER TABLE`，例如 `server/scripts/database/index.js:218`、`server/scripts/database/index.js:219`。
   - 風險：啟動即遷移方便開發，但正式環境缺少版本、回滾與部署前檢查；DDL 失敗時會把啟動問題與 schema 問題混在一起。
   - 建議：保留本地自動補欄能力，但生產改用可版本化 migration，並在部署前執行。

### 低到中風險

5. `server/index.js:1562` 每次列表需要 `listDuplicateApplicationIds` 時會掃出全部投遞再在 Node 端建桶。
   - 風險：目前邏輯清晰，但資料量變大後，候選人列表、職缺投遞列表等頁面會重複承擔全量查詢成本。
   - 建議：為 `candidates.full_name`、電話/email 正規化欄位建立索引，或用 SQL 聚合/快取預先計算重複投遞集合。

6. 前端 API 呼叫與授權 header 邏輯分散在多個元件，例如 `src/components/candidate/CandidateApplicationsTable.vue:286`、`src/components/CvUploadFlowPanel.vue:383`、`src/components/job/JobDictionaryPanel.vue:160`。
   - 風險：錯誤解析、登入過期、JSON parse fallback 與 toast 行為會逐漸分叉。
   - 建議：抽出共用 `apiClient`，統一 `withAuthHeaders`、`parseJsonResponse`、401 處理與錯誤訊息格式。

7. `server/index.js:3807` 編輯 AI 提取欄位後會同步候選人主資料並重算匹配。
   - 風險：這符合目前產品模型，但代表候選人主資料是「最新履歷版本」而非「投遞當時快照」；舊投遞列表可能隨後續 CV 編輯而變動。
   - 建議：若未來需要審計或歷史還原，應為投遞保留候選人快照欄位。

## 架構與可維護性觀察

- `server/index.js` 承擔了路由、認證、資料查詢、CV 解析、候選人匹配、狀態歷史、黑名單、職位字典等多個責任，短期可運作，長期應按業務域拆分。
- `CvUploadFlowPanel.vue` 的單份與批量 CV 狀態機已經相對完整，但檔案較大，建議後續拆出 composable，例如 `useCvCacheIntake`、`useBatchCvProcessing`。
- `CandidateApplicationsTable.vue` 同時處理篩選、預覽、黑名單、狀態更新、備註更新與批量選擇，可優先抽出 API 操作與篩選模型。
- 簡繁搜尋已有共用 `normalizeSearchText`，候選人列表 haystack 已包含來源與對接人；後續新增列表時應直接使用該 helper，避免再次出現各頁 normalize 不一致。
- 前後端資料契約目前靠命名約定維持，建議把 `source`、`ownerUser`、`isDuplicateApplication`、狀態枚舉等核心契約集中在 shared schema 或至少集中常數檔。

## 已補註釋位置與意圖

- `server/index.js:1534`：說明重複投遞集合如何以「姓名+電話 / 姓名+郵件」建桶。
- `server/index.js:1947`：說明狀態歷史如何同步主表狀態與對接人。
- `server/index.js:3241`：說明 CV intake 入庫前重新使用快取、來源與編輯後結構化資料。
- `server/index.js:3806`：說明編輯提取欄位後同步候選人主資料並重算匹配。
- `server/index.js:4693`：說明目前路由依賴 if 分支順序。
- `src/components/CvUploadFlowPanel.vue:230`：說明單份 CV 來源在提交前攔截。
- `src/components/CvUploadFlowPanel.vue:620`：說明單份解析、編輯、intake 與快取過期重試流程。
- `src/components/CvUploadFlowPanel.vue:764`：說明批量解析階段只快取與解析，不建立投遞。
- `src/components/CvUploadFlowPanel.vue:865`：說明批量匹配只提交已補來源且可匹配的項目。
- `src/components/candidate/CandidateApplicationsTable.vue:392`：說明篩選條件是 AND 關係，搜尋使用簡繁 normalize。
- `src/components/candidate/CandidateApplicationsTable.vue:570`：說明原始 CV 與 AI 分析預覽的不同資料路徑。
- `src/components/candidate/CandidateApplicationsTable.vue:707`：說明狀態更新與後端歷史同步關係。
- `src/components/candidate/CandidateApplicationsTable.vue:1626`：說明黑名單列背景優先於重複投遞。
- `src/scripts/cvExtractedEditor.js:433`：說明專案/公司/實習時長由結構化群組推導。
- `src/scripts/cvExtractedEditor.js:556`：說明預覽資料同時承載可編輯欄位 metadata。
- `src/components/AppSelect.vue:67`、`src/components/AppSelect.vue:110`、`src/components/AppSelect.vue:160`：說明鍵盤焦點、循環高亮與外部點擊關閉邏輯。

## 建議後續任務

1. 移除或開發環境限定驗證碼 log。
2. 刪除 `startBatchProcessingLegacy` 死碼，或補齊其狀態依賴與測試。
3. 建立共用前端 API client，集中授權、錯誤解析與登入過期處理。
4. 將 `server/index.js` 按認證、CV、候選人、職位、字典拆分。
5. 將啟動時 DDL 遷移改為版本化 migration，至少讓正式環境可預先驗證與回滾。
6. 為重複投遞、黑名單匹配、簡繁搜尋、批量 CV 來源補充回歸測試。

## 驗證結果

- `npm run build`：通過。Vite build 成功，78 個 modules transformed。
- `node --check server/index.js`：通過，無語法錯誤輸出。
- 靜態差異檢查：本次代碼差異只新增註釋與此報告，未改動條件、return、事件處理或 API payload。

## Assumptions

- 本報告使用繁體中文。
- 來源、對接人、重複投遞與簡繁搜尋行為沿用現有實作，不在本次走查中修復或重構。
- 註釋只補在資料流或狀態機容易誤讀的位置；簡單賦值、模板渲染與自明樣式未額外加註釋。
