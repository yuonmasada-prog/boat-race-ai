# BOAT RACE AI 実装監査

監査日: 2026-09-01  
対象: `yuonmasada-prog/boat-race-ai` main (`bc167fe`)を起点とした作業ブランチ

## 結論

既存資産は、データ取得、予測、学習、時系列backtestまで広く実装済みでした。最大の欠落は「予想を結果へ結合して継続集計する運用ループ」で、最大の破損要因は旧3連単キー修正workflowと、日次学習がpromotion済みChampionを無条件に上書きする競合でした。

今回、公開API/UIのcanonical 3連単キーを `1-2-3` に固定し、品質不足時のSKIP、保守的確率補正、fractional Kelly、履歴のlocal/Neon同期、結果自動精算、ROI/Calibration/セグメント指標、学習dataset生成、CI契約テストまで接続しました。

## 監査分類

### 1. 実装済み

- `api/race.js`, `api/race-edge.js`: 6艇の選手、級別、ST、全国/当地、モーター/ボート、今節成績のparserとfallback。
- `api/before.js`: 展示タイム、展示ST、進入、気象の取得。
- `api/odds.js`: 3連単、3連複、2連単、2連複、市場確率。
- `api/result.js`: boatraceopenapi結果、払戻、進入、ST、着順、決まり手。
- `api/scan.js`: 全24場のrace card/oddsを使う候補探索。
- `training/`: 時系列train/validation/test、Brier、Log Loss、ROI、Champion/Challenger、AutoML、backtest。
- `index.html`: iPhone向け単一ページUI、候補検索、事前/直前モード、券種比較。

### 2. 部分実装

- scanと本予測は同じデータ源と品質思想になったが、scanは軽量heuristic、本予測は学習モデルであり、スコア式自体は同一ではない。
- 確率校正は市場確率への保守的shrinkを追加したが、履歴から学習したisotonic/Platt calibrationではない。
- 履歴はブラウザlocalStorageを常時利用し、`DATABASE_URL` 設定時は匿名クライアントID単位でNeonへ同期する。DB未設定時は端末内へ安全にフォールバックする。
- `api/predict.js` は構造化予測APIとして残る一方、現UIは `race/before/odds` を取得してブラウザでも推論する。契約テストは共有しているが、推論経路は二つある。
- data qualityは取得成否、欠損、件数、取得時刻を持つ。連続したオッズsnapshotの90パーセンタイル変動が35%超の場合はSKIPする。

### 3. 未実装

- 日次最大損失をサーバー側で強制するbankroll account。
- 学習済みprobability calibratorの自動生成とOOS比較。
- production全体を横断する管理者向けperformance dashboard（集計関数とAPI契約は実装済み）。
- 認証済みpreview deploy → E2E → production promote。現在のVercel project ID/tokenはローカルにない。

### 4. 壊れていた可能性が高いもの

- `.github/workflows/fix-trifecta-key.yml`: 正しい `1-2-3` キーを `123` に変更する内容だったため削除。
- `.github/workflows/train-model.yml`: 日次再学習が `model/model.json` を無条件上書きし、promotion済みv12をv9.1へ戻していた。出力先を `model/daily-candidate.json` に分離。
- `model/production-manifest.json` はv12 active、`model/model.json` はv9.1で不一致だった。検証済みv12を復元し、CIで一致を強制。
- production smokeで過去日・非開催レースはodds/raceがfail-safe応答になった。これは正常なSKIPだが、固定レースだけのsmoke testは開催状況に依存する。

### 5. 重複実装

- Node API予測 (`api/predict.js`) とブラウザ推論 (`index.html`)。
- Node runtime版 `api/race.js` とEdge runtime版 `api/race-edge.js`。
- 複数の学習/AutoML/backtest workflow。役割は異なるが、model artifact更新時の排他制御が重要。
- `training/training/training/train model.py` は旧学習scriptの入れ子コピーで、SyntaxErrorがあり現workflowからも未参照だったため削除。

### 6. 不要になった旧実装

- ルートのminified `predict.js`: Vercel API構成から未参照のMVPだったため削除。
- `training/install_multibet.py` と対応workflow: 本番コードを文字列置換する一回限りのinstallerだったため削除。
- `promote-v11.yml`: v12 promotion後の固定version promotion workflowだったため削除。
- `boat-race-ai-upload.zip`: 現在未参照。履歴保全のため今回は削除していない。

## Phase別結果

### PHASE 1 — データ/API統合・安定化

変更:

- `lib/boat-race-core.js` に120通り生成、canonical key、オッズ検証、市場確率、data quality、retry、SKIPを集約。
- `odds/race/before/result/scan` にtimeout/retry、取得時刻、品質、warning/errorを追加。
- 3連単は120/120かつ不正値なしの場合だけ購入判定へ進む。
- `scan.js` の公開comboを `123` から `1-2-3` へ統一。
- scanの3連単品質判定をpredictと同じ共有validatorへ統一し、120/120未満は候補から除外。

テスト:

- 120 unique combinations、parser mapping、missing/invalid/noncanonical odds、API invalid input、SKIPをfixtureで検証。

### PHASE 2 — 結果・履歴・学習基盤

変更:

- `history.js` で予想をlocalStorageへ保存し、`/api/result` と自動結合。
- `api/predictions.js` とNeon prediction ledgerを追加。匿名ID単位で双方向同期し、未設定時はlocalStorageへフォールバック。
- `api/settle-predictions.js` をVercel Cronから実行し、未確定履歴を日次で自動精算。
- 3連単/3連複/2連単/2連複の払戻を正規化。
- 的中、払戻、損益、ROI、Brier、Log Lossを集計。
- `api/statistics.js` でsettle/statistics/dataset契約を提供。
- 会場、券種、オッズ帯、風速帯、grade、時間帯、1号艇の扱い、model version別の集計を提供。
- 学習datasetは `featuresAtPrediction` と `label` を分離し、結果を予測featureへ混ぜない。
- model/manifest一致をCIで検証し、日次candidateとproduction Championを分離。

外部設定:

- コードはNeon対応済み。実環境ではVercelに `DATABASE_URL` と `CRON_SECRET` を設定する必要がある。

### PHASE 3 — 実運用最適化

変更:

- 市場確率へのshrinkでモデル確率を保守的に補正。
- `EV = calibratedProbability × odds` と市場優位比の両方を購入条件化。
- 1/4 Kelly、1レース30%、1買い目15%、最大3点、100円単位を既定値に設定。
- 1日最大損失を入力予算の50%とし、確定損失と未確定投資を差し引いて新規配分を抑止。
- UIにEV、データ取得率、BET/SKIP、的中率、純損益、ROI、結果更新を表示。
- CIでsyntax/unit/contract/parser/model checksを実行。

## テスト戦略

- Unit: canonical key、120通り、market normalization、data quality、Kelly、settlement、metrics。
- Parser: official odds HTML、boatraceopenapi result JSON fixture。
- Contract: APIのinvalid input、statistics settle/aggregate、prediction store、Cron認証。
- Integration: browser localStorage ↔ central store、result fetch → settled history。
- Smoke: production alias、model version、scan、当日oddsを読み取り確認。

実行コマンド:

```bash
npm run verify
```

## コード外で必要な完了作業

1. Vercel projectをlinkし、Neonの `DATABASE_URL` と `CRON_SECRET` をProduction/Previewへ設定する。
2. preview deploymentでAPI/E2Eを通し、確認後にproductionへpromoteする。
3. 実履歴が十分に蓄積してから、時系列OOSでcalibratorを比較し、Brier/Log Lossが改善した候補だけをpromotionする。サンプル不足の状態で自動補正モデルを作らない。
