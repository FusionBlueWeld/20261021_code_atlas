# GitHubリポジトリと公開対象

## Gitの状態

2026-10-21にGitリポジトリとして初期化しました。ブランチは `main`、公開先は [FusionBlueWeld/20261021_code_atlas](https://github.com/FusionBlueWeld/20261021_code_atlas)（公開リポジトリ）です。

## GitHubに含めるもの

アプリのソースコード、テスト、READMEと設計記録、`package.json` と `package-lock.json` を含めます。`artifacts/review-20260919/reproduce.py` と `artifacts/review-20260919/reproduce.cjs` は再現手順に使うため保持します。

## 除外するもの

`.gitignore` は `node_modules`、npmキャッシュ、Pythonのbytecode・仮想環境・ツールキャッシュ、ログを除外します。`artifacts` 内のUI生成画像と解析JSONも除外します。解析JSONにはローカルパスや解析対象のソース情報が含まれることがあるため、GitHubへ公開しません。除外設定は既存ファイルを削除しません。

公開前に、追加するファイルに認証情報、個人情報、公開してよいか確認できていないデータやローカル固有のパスが含まれていないことを確認してください。
