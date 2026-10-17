# ai-cost-cli

以 Node.js / TypeScript 查詢 OpenAI 與 Vertex AI 每月費用，並以預算門檻發出警示。支援表格、JSON，以及 Slack / Discord webhook。

## 安裝與執行

需要 Node.js 20 以上與 npm。在本專案目錄執行：

```sh
npm install
npm run build
node dist/main.js --help
cp ai-cost.config.example.json ai-cost.config.json
node dist/main.js usage
node dist/main.js check --json
```

也可執行 `npm link`，之後以 `ai-cost-cli usage` 呼叫。`npm start -- usage` 可直接使用建置後的程式。

## 設定

讀取順序為 `--config <path>` 指定檔案，或自動搜尋目前目錄的 `ai-cost.config.json`，接著搜尋 `~/.ai-cost.json`。不合併設定；若找到的檔案格式錯誤，會直接失敗，不會退回其他檔案。實際設定檔已列入 `.gitignore`。

[範例設定](ai-cost.config.example.json) 同時啟用兩個供應商；只使用其中一個時，刪除另一個區塊即可。

```json
{
  "providers": {
    "openai": {
      "monthlyBudget": 100,
      "currency": "USD",
      "thresholds": [0.8, 1]
    },
    "vertex": {
      "monthlyBudget": 6000,
      "currency": "TWD",
      "thresholds": [0.8, 1],
      "table": "my-gcp-project.billing.gcp_billing_export_v1_XXXXXX_XXXXXX_XXXXXX",
      "projectId": "my-gcp-project",
      "location": "US",
      "maximumBytesBilled": "10000000000"
    }
  },
  "webhook": {
    "type": "slack",
    "urlEnv": "AI_COST_WEBHOOK_URL"
  }
}
```

- `monthlyBudget`：大於零的每月預算，單位為該供應商的 `currency`。
- `thresholds`：預算比例，`0.8` 表示 80%，`1` 表示 100%；必須為正數，也可設 `1.2`。預設 `[0.8, 1]`，重複門檻會去重。
- `currency`：三碼大寫幣別，預設 `USD`。OpenAI 僅接受 USD；Vertex 必須符合 billing export 的實際幣別。不同幣別不換算或相加，幣別不符會失敗。
- Vertex 的 `table` 必須為完整 `project.dataset.table`，支援 standard 或 detailed usage cost export，非 FOCUS export。`projectId` 為執行查詢的專案；`location` 必須符合 dataset 位置。`maximumBytesBilled` 為可選的正整數字串，可限制單次查詢掃描量；範例為 10 GB。BigQuery 查詢本身可能產生費用。
- 至少設定一個供應商；不認得的設定欄位會被拒絕。

## 憑證與資料來源

**OpenAI**：從環境變數 `OPENAI_ADMIN_KEY` 讀取組織管理員金鑰，並透過 `GET https://api.openai.com/v1/organization/costs` 讀取所有分頁。一般模型 API key 不適用。請在終端或 CI secret store 安全設定此變數，不要將金鑰放入設定檔。

**Vertex AI**：先啟用 Cloud Billing 的 BigQuery 費用匯出。透過 Application Default Credentials 驗證，例如本機執行 `gcloud auth application-default login`，或在執行環境使用服務帳號／Workload Identity。若使用金鑰檔，`GOOGLE_APPLICATION_CREDENTIALS` 應指向專案外的檔案。查詢身分需要執行專案的 `roles/bigquery.jobUser` 與匯出 dataset 的 `roles/bigquery.dataViewer`（或等效的最小權限）。

Vertex 查詢以 `service.description = 'Vertex AI'` 篩選，依 `usage_start_time` 選月份，計算 `SUM(cost + credits.amount)`，包含負數抵扣。這涵蓋匯出表內該服務的所有專案，並非只篩選 `projectId`。沒有符合資料時回報 0；這也可能代表匯出尚未完成，並非即時用量保證。

資料來源有延遲，數值可能因抵扣、調整或補入資料而變動；此工具是監控用途，不會停止用量或強制支出上限。UTC 使用月份可能與帳單月份或雲端主控台的時區不同。

## 指令

```sh
node dist/main.js usage --provider openai
node dist/main.js usage --month 2026-09 --format json
node dist/main.js check --config ./ai-cost.config.json
node dist/main.js check --provider vertex --json --no-webhook
```

`usage` 顯示費用、預算、使用比例及已達到的門檻，不發送 webhook。`check` 在費用**大於或等於**任一門檻時輸出警示，並視設定發送通知。JSON 輸出包含 `month`、`start`、`end`、`providers` 和 `alerts`，stdout 僅輸出 JSON，錯誤寫入 stderr。

預設查詢目前 UTC 月份，起點為月初，終點為目前時間（秒精度、不含終點）；歷史月份則查詢完整月份。`--month` 接受 `YYYY-MM`，不接受未來月份。表格顯示至小數兩位，門檻比較使用未四捨五入的金額。

| 結束碼 | 意義 |
| --- | --- |
| 0 | `usage` 成功，或 `check` 尚未達門檻 |
| 1 | `check` 至少一個門檻已達到；或指令參數無效 |
| 2 | 設定、憑證、供應商查詢或 webhook 失敗 |

任一供應商查詢失敗時，不會將缺少的費用當成零或輸出部分成功報告。通知失敗時，已輸出的警示會保留，結束碼為 2。

## Slack / Discord 通知

在設定中加入 `webhook`，將 `type` 設為 `slack` 或 `discord`，並透過 `urlEnv` 指向存放 HTTPS webhook URL 的環境變數。也支援 `url`，兩者只能擇一；建議使用環境變數，避免把 webhook token 寫入檔案。

僅 `check` 達到門檻時發送 POST。Slack 使用 `{"text":"..."}`，Discord 使用 `{"content":"...","allowed_mentions":{"parse":[]}}`。每次執行都會發送目前已達門檻的警示，沒有跨執行去重；可由 cron 或 CI 排程呼叫。`--no-webhook` 可停用此次通知，測試不會傳送真實通知。HTTP 請求有逾時且不跟隨重新導向，也不自動重試 webhook，以免重複送出。

## 開發與驗證

```sh
npm install
npm test
npm run build
```

Vitest mock HTTP 與 `@google-cloud/bigquery`，無需金鑰。GitHub Actions 使用 Node.js 20 執行安裝、測試與建置。參見 [CONTRIBUTING.md](CONTRIBUTING.md)。授權：[MIT](LICENSE)，Copyright 2026 neohsuan。

## English

`ai-cost-cli` is a Node.js 20+ TypeScript CLI for monthly OpenAI and Vertex AI cost monitoring.

1. Run `npm install` and `npm run build`.
2. Copy `ai-cost.config.example.json` to `ai-cost.config.json`. Remove providers you do not use and set budgets, currencies, and threshold ratios (`0.8` = 80%).
3. Set `OPENAI_ADMIN_KEY` to an OpenAI organization admin key. For Vertex, enable standard/detailed GCP billing export and configure its fully qualified BigQuery table. Authenticate with ADC; grant BigQuery Job User on the query project and Data Viewer on the export dataset.
4. Run `node dist/main.js usage` or `node dist/main.js check --json`.

Configuration precedence: explicit `--config`, otherwise local `./ai-cost.config.json`, then `~/.ai-cost.json`. Files are not merged. Options include `--provider openai|vertex`, `--month YYYY-MM`, `--format table|json`, `--json`, and `--no-webhook`.

Periods use UTC usage months, with an exclusive end capped at now for the current month. OpenAI Costs API pagination is followed. Vertex costs include credits and filter the exact service name `Vertex AI` across all projects in the export. Billing data may be delayed; no matching rows produce zero. Currency must match the configured budget; no conversion is performed. BigQuery queries can incur charges; set `maximumBytesBilled` to bound scanned bytes.

`check` alerts at or above each configured threshold. Exit codes: 0 for successful usage or no alerts, 1 for alerts (also invalid CLI arguments), 2 for configuration, provider, or notification failures. JSON stdout includes alerts; errors go to stderr. A failed provider prevents a partial success report.

Optional webhook config: `{"type":"slack","urlEnv":"AI_COST_WEBHOOK_URL"}` or use `"discord"`. Set that environment variable to your HTTPS webhook URL. Only `check` sends notifications, once on every invocation with alerts. There is no persistent deduplication. Webhook failure returns exit code 2 after printing alerts. Keep all credentials and real configuration files out of source control.

Run `npm test` for offline Vitest tests mocking HTTP and BigQuery, and `npm run build` to compile. Licensed under MIT, copyright 2026 neohsuan.

## 官方參考 / References

- [OpenAI Costs API](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/costs)
- [Cloud Billing export schema](https://docs.cloud.google.com/billing/docs/how-to/export-data-bigquery-tables/standard-usage)
- [BigQuery Node.js client](https://docs.cloud.google.com/nodejs/docs/reference/bigquery/latest/bigquery/bigquery)
