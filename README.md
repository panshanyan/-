# RC 飛行模擬（RC Flight Sim）

第三人稱航空模型（RC 固定翼）飛機模擬器，Android App。

## 下載
到 [Releases](../../releases) 找 `RC 飛行模擬 vN`，下載 `RCFlightSim-vN.apk` 安裝。

## 功能
- 主畫面三種模式：自由模式、新手教學（油門／方向舵／升降舵／副翼／降落）、考照模式
- 考照模式依民航局「無人飛機專業操作證術科測驗基準」基本級程序模擬：飛行前檢查、地面滑行及轉彎、起飛航線、高度保持五邊飛行、水平 8 字、降落航線及落地、緊急程序處置（怠速迫降）、飛行後檢查
- 三種飛機：練習機（穩定、自動回正）、特技機（推重比 >1，可 3D 懸停）、滑翔機
- 物理模型：升力／阻力、失速、螺旋槳氣流、上反角穩定、風與陣風
- 三種視角：追尾、地面（真實 RC 飛手視角，自動變焦）、FPV
- 觸控雙搖桿（Mode 1／Mode 2）、舵量、Expo
- USB OTG 接遙控器（EdgeTX／OpenTX 搖桿模式）或手把，可一鍵偵測軸向
- 拉煙、墜機碎片、降落判定、引擎聲

## 開發
```
npm ci
node web/build.mjs      # 打包到 app/src/main/assets/index.html
```
推送到 `rc-sim` 分支後，GitHub Actions 會自動編譯 APK 並發佈到 Releases。
