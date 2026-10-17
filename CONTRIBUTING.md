# 參與貢獻 / Contributing

請使用 Node.js 20 以上與 npm。

```sh
npm install
npm test
npm run build
```

程式碼位於 `src/`，Vitest 測試位於 `tests/`。新增供應商或修改費用計算時，請加入涵蓋成功、錯誤、幣別及日期邊界的測試。HTTP 與 BigQuery 必須使用 mock，測試不可依賴真實帳號或產生雲端費用。

請勿提交 API key、webhook URL、服務帳號金鑰或實際設定檔。新增設定項目時，請同步更新範例與 README。提交 PR 時，請說明問題、行為改變與執行過的驗證。

Use Node.js 20+ and npm. Run the commands above before submitting a pull request. Keep tests offline with mocked HTTP and BigQuery. Document configuration changes and never include credentials, real webhook URLs, or private billing data. Describe the change and validation in your PR.
