# コードの配置と責務

ビルド工程なしで動くローカルアプリです。起動は引き続きルートの `server.py` または `start.bat` から行います。

```text
server.py                 HTTP API・静的ファイル配信・起動オプション
analyzer.py               従来の解析APIを保つ互換入口
code_atlas/
  analysis.py             解析全体の組み立て・ノードと統計の生成
  collection.py           フォルダ走査・ファイル取得・サイズ制限
  python_parser.py        Python ASTから定義と呼び出しを抽出
  javascript_parser.py    Node/TypeScriptパーサーとの橋渡し
  relations.py            import・呼び出し・継承の解決
  evidence.py             コメント・docstringと出典の抽出
  projects.py             バージョン・テストファイルの判定
  config.py               言語・除外・制限・アプリルート
js_parser.cjs             TypeScript Compiler APIによるJS/TS構文解析
web/
  index.html              画面の骨格
  app.js                  起動だけを行うES module
  graph-model.js          表示対象・関係集約のモデル（Nodeからも利用）
  graph/layout.js         グラフ配置と共有カード寸法
  ui/
    state.js              共有状態・小さなDOM/保存ヘルパー
    repository.js         リポジトリ読込・範囲選択
    navigation.js         選択・展開・探索操作
    tree.js               ファイルツリー・検索表示
    graph.js              カードと線の描画・クリック・カメラ
    inspector.js          定義・ソース・出典パネル
    panels.js             サイドバー開閉・ドラッグ幅調整・設定保存
    events.js             操作の接続・起動・パン
  style.css               CSSの読込入口
  styles/                 base / shell / graph / inspectorごとの配色・配置
tests/                    Python、Node、ブラウザの回帰テスト
demo_repository/          公開可能な小さな動作確認用コード
artifacts/                生成画像・解析結果。再現スクリプト以外はGit除外
```

## 変更時の確認箇所

- カード寸法・縦横の間隔は `web/graph/layout.js` の `metrics` が基準です。カード幅244px・高さ128pxはCSSの変数と一致させ、線のアンカー・注目点も同じ値を使います。所属のあるグラフでは深さと枝ごとの帯で配置し、呼び出し線は順序計算に使いません。詳しくは [レイアウト設計](LAYOUT_DESIGN.md) を参照してください。
- カードはIDごとにDOMを再利用します。表示領域のサイズ変更だけでカードを作り直すと、押下途中のクリックやフォーカスを失うため、ウィンドウやパネルのリサイズでは再構築しません。
- UI操作は安定した親要素で受け付けます。線やコメントのレイヤーがカードの操作ボタンを覆わないことも確認します。
- 幅は希望値を保存し、実表示時に中央キャンバスと画面幅に合わせて制限します。狭い画面では右パネルを下段へ移し、スマートフォンでは縦配置にします。
- `graph-model.js` と `graph/layout.js` はブラウザとNodeで共有する互換形式です。ブラウザ側の読込順は `ui/state.js` で宣言しています。
- `ui/` 内はES modulesです。描画と選択に相互参照はありますが、トップレベルでは起動せず、`app.js` が全モジュールの初期化後にイベント接続と読込を始めます。
- 新しい静的ファイルは `web/ui`、`web/graph`、`web/styles` の対応拡張子だけ配信されます。リクエストのパスをそのままファイルシステムへ渡しません。

## 検証

```text
python -m unittest discover -s tests -v
npm run test:js
```

サーバーを起動してから、PlaywrightとEdgeがある環境で `npm run test:ui` を実行します。`CODE_ATLAS_URL` で既定の `http://127.0.0.1:8765` を変更でき、`PLAYWRIGHT_MODULE` でPlaywrightの場所を指定できます。4つのブラウザテストはそれぞれ独立したコンテキストを使います。

テスト内の版付きプロジェクトはAPIへ小さなfixtureを渡して作り、個人PC上の別リポジトリを参照しません。変更内容の記録は [2026-10-20改修記録](CHANGES_2026-10-20.md)、公開対象と除外理由は [GitHub準備ガイド](REPOSITORY_GUIDE.md) を参照してください。
