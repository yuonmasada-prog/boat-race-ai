# BOAT RACE AI

公開されているBOAT RACEデータを取得し、モデル確率と市場オッズを比較して、購入候補またはSKIPを提示するWebアプリです。自動投票と利益保証は行いません。

## 現在のデータフロー

```text
scan → race / before / odds → probability + market comparison
     → data-quality gate → positive-EV gate → fractional Kelly
     → prediction history (local + optional Neon) → result auto-settlement
     → profit/loss, ROI, calibration, segment report → training dataset
```

3連単のcanonical keyは、APIとブラウザの公開契約では `1-2-3` 形式です。120通りが完全に取得できない場合、購入候補は出しません。
同一レースの前回snapshotと比較して3連単の90パーセンタイル変動が35%を超えた場合も、直前市場が不安定としてSKIPします。

## ローカル検証

Node.js 22以降を使用します。外部APIへ接続しないunit/contract/parserテストは次で実行できます。

```bash
npm run verify
```

このコマンドは、JavaScript構文、HTML内script、production model/manifest整合性、API契約、3連単120通り、オッズ品質、SKIP、結果照合、ROI、履歴同期、永続化契約を検証します。

Vercel互換のローカルAPIを起動する場合は、Vercel CLIを認証・linkした環境で `vercel dev` を使用してください。認証情報や `.vercel/project.json` はリポジトリへcommitしません。

## 主なAPI

- `GET /api/scan` — 当日の候補レースを一次選別
- `GET /api/race` — 出走表と選手・機材・今節成績
- `GET /api/before` — 展示、進入、ST、気象
- `GET /api/odds` — 3連単・3連複・2連単・2連複と市場確率
- `GET /api/predict` — fail-safe付き3連単予測、EV、資金配分
- `GET /api/result` — 確定結果と払戻
- `GET|POST /api/predictions` — 匿名クライアントID単位の予想履歴同期
- `POST /api/statistics` — 履歴の精算、統計、セグメント評価、学習用dataset生成
- `GET /api/settle-predictions` — Vercel Cronによる未確定履歴の自動精算

ブラウザの予想履歴はlocalStorageへ最大500件保存し、`DATABASE_URL` が設定されていればNeon Postgresへ同期します。DB未設定・通信失敗時も端末内履歴は維持され、予想処理は停止しません。端末をまたいで同じ履歴を使う場合は、localStorageの匿名クライアントIDを引き継ぐ必要があります。

## Vercel / Neon設定

Vercel MarketplaceでNeonを接続し、ProductionとPreviewへ次を設定します。

- `DATABASE_URL` — Neon接続文字列。初回アクセス時にprediction ledger schemaを自動作成します。
- `CRON_SECRET` — `/api/settle-predictions` のBearer認証。Vercel Cronからのみ実行させます。

値は `.env` やリポジトリへcommitしません。`vercel.json` のCronは毎日00:30 JSTに、未確定履歴を公式結果と照合します。

## モデル更新

`model/model.json` と `model/production-manifest.json` がproduction Championです。日次再学習は `model/daily-candidate.json` を生成し、Championを直接上書きしません。時系列validation/backtestを通り、既存Championより改善した候補だけをpromotion対象にします。

詳細な監査結果、検証内容、外部設定が必要な項目は [docs/IMPLEMENTATION_AUDIT.md](docs/IMPLEMENTATION_AUDIT.md) を参照してください。
