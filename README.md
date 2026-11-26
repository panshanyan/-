# 黑盒子分析（Android）

Betaflight 黑盒子 (.bbl / .bfl / .zip) 分析 App。每次推送到 main，GitHub Actions 會自動編譯 APK 並發佈到 Releases。

- 分析網頁：`app/src/main/assets/index.html`
- 簽章金鑰：`keystore/release.jks`（固定金鑰，之後更新版本可以直接覆蓋安裝；這個 repo 請保持私人）
