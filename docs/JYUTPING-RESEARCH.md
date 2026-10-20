# jyutping.io：REA 研究筆記

日期：2026-10-20

工具：本機 REA 6.7.0 CLI；研究對象：[jyutping.io 練習頁](https://jyutping.io/practice)。

目的係理解輸入、判定、計時、題目同手機介面，幫助設計 Contest。呢份係公開前端嘅研究結果，唔係對參考網站後端或者容量嘅審計；亦唔代表要直接採用佢嘅程式碼、題庫或賽規。

## 結論同對 Contest 嘅影響

| 項目 | 研究結果 | 對 Contest 嘅影響 |
| --- | --- | --- |
| 輸入 | `window` 嘅鍵盤事件更新本機輸入；空白鍵／Enter 確認，標點位置自動跳過 | 可以參考逐字顯示；手機要另外實測系統鍵盤輸入事件，唔只依賴實體鍵盤事件 |
| 聲調 | 判定前移除標準答案嘅聲調數字，忽略英文字母大小寫；畫面傳入 `checktone:false` | 已確認 Contest 用無聲調；多音／變調答案依正式文章校對 |
| 交錯後行為 | 交錯亦會確認並前進，保留紅字及說明；唔要求先改啱 | Contest 已確認對錯都前進，另按用戶要求實作 Backspace 撤回修正；未將原站撤回已提交答案行為視作已驗證 |
| 速度 | 畫面計 `round(正確音節數 ÷ 活躍秒數 × 60)`，稱為「字／分」 | Contest 已確認固定文章鬥快，以實際完成用時作分母，計入閒置同修正時間 |
| 準確度 | 已確認答案嘅正確比例，包含歷史句子同今句；累計不足 13 個確認音節時顯示 `-` | 唔係按鍵錯誤率；比賽應明確定義提交、重試同未完成答案 |
| 計時 | 本機每秒累加；約 3 秒冇輸入活動會暫停 | Contest 計時唔因閒置或切頁暫停，提交最後一個音節先完場 |
| 題目及答案 | 已追查路徑喺本機抽題，按音韻練習權重及近期題目調整；答案由隨 bundle 下發嘅詞組／字音資料產生 | 比賽應固定同場題目及答案版本，唔按各人弱項出唔同題；客戶端收到答案就有可讀取性 |
| 手機 | 自製觸控鍵盤之外，另有快選完整答案；鍵盤會按預測機率／用戶觸控行為調整 | Contest 已確認只用系統鍵盤，唔做網站鍵盤或快選答案 |
| 統計及儲存 | 已追查打字歷史 store 喺記憶體；設定、近期題目同鍵盤行為另用 localStorage | Contest demo 只存本機成績；正式版再做帳戶、伺服器驗證、提交紀錄及兩組結果榜 |

## 實際操作驗證

全部由 REA `capture-browser-scenario` 啟動臨時 headless Chrome，使用全新暫存 profile。三次場景都完成並回報已終止自己建立嘅瀏覽器。冇登入任何帳戶，冇做負載測試。

| 場景 | 操作及觀察 | 證據 |
| --- | --- | --- |
| 初始頁面 | 開練習頁、等載入，保留 DOM、accessibility 同選定網絡資源 | E1 |
| 錯誤提交 | 關閉教學，打 `zzz` 再 Enter：第一個字標紅並顯示差異，下一個字成為目前位置；再按 Backspace，已確認嘅上一字錯誤仍保留 | E2，步驟 `key_2_z`／`key_3_enter`／`key_4_backspace` |
| 閒置計時 | 關閉教學，打一個 `z`；等待 4 秒時顯示 `00:02`，再等 2 秒仍為 `00:02` | E7，步驟 `idle_four_seconds`／`idle_two_more_seconds` |

閒置場景支持「時間會暫停」，唔用呢個單次畫面結果推斷精確暫停秒數；3 秒 timeout 係下面嘅靜態程式碼證據。

E2 保留嘅事件內，輸入步驟開始後未見新 HTTP request，亦未見 WebSocket 事件；樣本只涵蓋短時間操作。此捕捉有一項 script response body 因事件大小上限未保留，所以唔以呢個結果斷言網站完全冇其他網絡或後端功能。

## 靜態追查位置

下表 bundle 名稱對應 [證據索引](REA-EVIDENCE.json) 嘅完整 URL、SHA-256 同來源。Offset 全部係解碼後文字嘅 **0-based Unicode 字符位置**，唔係原檔 byte offset；模組號係呢個 bundle 版本內部嘅標記，唔當成跨版本穩定 ID。

| Bundle | 位置 | 追查結果 |
| --- | --- | --- |
| `79865102dd31ad47.js` | 輸入處理約 offset 5,900–8,300 | 確認分支移除答案聲調、忽略大小寫；無論答啱或答錯都呼叫 `confirmInput`，再跳過非中文字位置。E2 交叉驗證前進行為 |
| `53eb7ce3892b93dd.js` | 模組 71207；offset 9,155、9,541–9,887 | 由歷史 `isCorrect` 同今句已確認答案累計；計算速度、準確度同 13 個音節顯示門檻 |
| `70f50a0949deb7b7.js` | 模組 41099；offset 5,771–6,217 | `start` 重設 3 秒 idle timeout；每秒 interval 只喺未暫停時累加；有 pause／reset。E7 交叉驗證閒置停時計 |
| `feb79d6bd0b5f6c0.js` | 模組 15106；offset 112 起 | 內嵌題目文字同標籤；本輪以靜態讀取解析題目集合，未複製題庫入 Contest |
| `70f50a0949deb7b7.js` | offset 511,954、513,200、518,641–521,848 | 字／詞組讀音查找、依權重抽題及 `Math.random` seed；近期題目以 `jyutping-recent-sentences` 保存，題目 store 呼叫本機 `getJyutpingList` |
| `70f50a0949deb7b7.js` | 模組 2273；offset 521,849–522,350 | 打字歷史係記憶體 store，排除冇標準音節嘅位置後保存正確性；此 store 未見持久化或遠端提交 |
| `3f653ef400ff674b.js` | 模組 92719；offset 3,383–5,790 | `jyutping-settings` 保存聲音開關及 keyboard／quickpick 模式 |
| `53eb7ce3892b93dd.js` | 約 offset 46,010、47,946–48,006、52,470 起 | 鍵盤行為插件實際以 `persistData:true` 呼叫，key 為 `jyutping-keyboard-behavior`；快選可以直接填入整個音節再確認 |

以上具體行為係對 REA 匯出／鎖定嘅公開 JavaScript 作人工追讀得出。REA 靜態分析提供 AST／關係圖、身份及覆蓋資料，唔等於工具自動證明所有分支都會執行。表內題目及儲存結論係靜態證據，未以長時間操作、重新開頁或真實手機全面驗證。

## Evidence 索引

| 代號 | 操作 | REA Evidence ID |
| --- | --- | --- |
| E1 | 初始 browser scenario | `ev_f604c82c14bb566e13af367e09cb11599970ad225446cda782bd98bc423108ae` |
| E2 | 輸入 browser scenario | `ev_df7d7931a5ad97f26cabf39255ce5ff25e4531196640458b563467ed137cd4eb` |
| E3 | 匯出 E1 已保留 scripts | `ev_f37ecba03ecdfb2f085bb159323607643d0571dc470db93c42a81ac45afd6a7d` |
| E4 | 分析輸入、統計／手機及設定共三個選定檔案 | `ev_fd87a74801853be98e21286c163bc4ba66d714e7da0dadaaffbe400cd8e6f739` |
| E5 | 匯出 E2 已保留 scripts | `ev_ce97930f24fbce62c13b23957abd30cfc6968bd077099d6229260e2f109f2302` |
| E6 | 分析補取主 bundle | `ev_b6e257421d76eb9138d8c224050a74e1ff26042047d34edac63b6594619dae76` |
| E7 | 閒置計時 browser scenario | `ev_ef6ef358572d814fdfbb2bc569857857743f04ecfecc7ff7f2b98d6b53c6e0a3` |

E4 嘅 root artifact SHA-256 為 `64dec550c96a9c55976f0af8cebe56971d7147796f5c90ab9cac450fcfef01c0`，解析 3 個選定檔案，另 11 個匯出檔案未納入該次分析。E6 解析補取嘅 667,887-byte bundle，原檔 SHA-256 為 `936f5c69a944f3867ed83dcb8326615e74f1141c57c1d0e873d34af4a42f25c2`。兩次都冇 parse failure，但關係圖覆蓋均為 **partial**。

`70f50a0949deb7b7.js` 嘅原始 scenario response body 超出保留限制；之後係對 REA 已觀測到嘅完整公開 URL 另作一次 HTTP 下載，再交 REA 分析。呢個雜湊標識補取版本，唔聲稱等同首次網絡回應嘅 bytes。

本機完整 Evidence、scenario 輸入同公開 bundle 放喺本 chat workspace 嘅 `work/jyutping-rea/`，屬研究中間檔，冇推送入 repo。[REA-EVIDENCE.json](REA-EVIDENCE.json) 保留各 Evidence 檔案雜湊、大小、來源 URL 同主要限制；索引本身唔能取代完整 Evidence 重播或重新分析。

## 尚未回答

- 未取得或審核參考站完整後端，唔推斷其最大並發量、正式帳戶認證或全站有冇多人功能。
- 未全面驗證所有聲調、異讀、標點、長句及瀏覽器組合；今次只係原理研究。
- 未用真實手機驗證觸控鍵盤及快選；前端裝置偵測唔係比賽組別認證。
- 未確認程式碼同題庫重用授權；Contest 目前只吸收設計觀察，正式題目另行準備。
- 未對 jyutping.io 做壓測，亦未建立 Contest 伺服器。2,000 人容量係 [SPEC](../SPEC.md) 嘅待驗收目標。
