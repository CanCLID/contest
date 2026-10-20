# Contest

粵拼打字比賽嘅純前端 demo，用嚟試輸入流程同討論賽規。正式需求同實現計劃見 [SPEC.md](SPEC.md)。

## Demo 有乜

- 選擇手機組或電腦組，以及 30／60 秒練習。
- 睇中文字，逐字輸入無聲調粵拼；空格或 Enter 確認，答錯會留喺原位。
- 顯示速度、準確度同本機成績；手機組、電腦組各有示範排行榜。

示範榜單同本機成績會分開標示。Demo 未有帳戶登入、後端、真正多人同步或可信嘅比賽排名；選組亦唔係裝置認證。呢版嘅玩法只供試用，正式賽規仍喺 spec 討論。

使用原創題目及系統字體，冇外部腳本、字體或分析追蹤請求。本機紀錄最多保存最近 20 輪；儲存不可用時會留喺當前頁面記憶體。

## 本機試用

喺 repo 根目錄執行：

```sh
python3 -m http.server 4173 --directory demo
```

用瀏覽器開 [localhost:4173](http://localhost:4173)。測試用 Node.js 執行，毋須安裝依賴：

```sh
npm test
```

測試涵蓋固定截止、錯誤重試、空白提交、提早打完題目及本機紀錄保存。另已喺瀏覽器試過 30 秒完整流程、30／60 秒設定、切頁繼續計時、分組榜單、重載保留紀錄，以及桌面和 390px 手機尺寸排版。尚未做 iOS／Android 真機鍵盤兼容測試。

## GitHub Pages

已準備手動部署 workflow，但**目前未部署**。Repo 目前係 private，而 CanCLID 使用 GitHub Free；要啟用 Pages，需要將 repo 改為 public，或者使用支援 private repo Pages 嘅相應付費方案。Private repo 並唔代表 Pages 網站本身會限制訪問。

符合條件後，喺 Settings → Pages 選擇 GitHub Actions，再喺 Actions 手動執行 **Deploy demo to GitHub Pages**。流程會先跑測試，只上傳 `demo/`，唔會發佈 repo 根目錄嘅文件。Push 本身唔會觸發部署。

GitHub Pages 只供呢個靜態 demo；正式服務嘅阿里雲部署、手機短訊／Google 登入、全球約 2,000 人同場比賽及兩組獨立排名，仍按 [SPEC.md](SPEC.md) 規劃。
