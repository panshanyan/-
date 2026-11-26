# RC 飛行模擬（RC Flight Sim）

第三人稱航空模型（RC 固定翼）飛機模擬器，Android App。

## 下載
到 [Releases](../../releases) 找 `RC 飛行模擬 vN`，下載 `RCFlightSim-vN.apk` 安裝。

## 功能
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
