# 黑盒子分析（Android）

Betaflight 黑盒子 (.bbl / .bfl / .zip) 分析 App。每次推送到 main，GitHub Actions 會自動編譯 APK 並發佈到 Releases。

- 分析網頁：`app/src/main/assets/index.html`
- 簽章金鑰：`keystore/release.jks`（固定金鑰，之後更新版本可以直接覆蓋安裝；這個 repo 請保持私人）

## 功能（參考 PIDtoolbox）
- 首頁：白話分析、評分、建議 CLI 指令、A/B 比較
- 曲線：陀螺/指令、馬達、轉速、電壓電流、PID 各項
- 頻譜：油門 × 頻率熱圖（未濾波陀螺、濾波陀螺、D 項、PID 誤差、指令、馬達），濾波延遲
- 步階響應：Wiener 反卷積
- PID 誤差 vs 油門
- 飛行統計、設定比較
- 支援 .bbl / .bfl / .txt / .zip / Blackbox Explorer CSV

原始碼在 `src/`，執行 `cd src && python3 build.py` 會重新產生 `app/src/main/assets/index.html`。
