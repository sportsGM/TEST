v75 免費資料源乾淨版

建議：真的想降 bug，最好新開一個 GitHub repo + 新 Supabase project 測 v75。
確認正常後，再把正式網址切過去。

新 Supabase 執行順序：
1. SQL_RUN_THIS_ONLY_v42.sql
2. SQL_RUN_THIS_ONLY_v75_FREE_DATA_CLEAN_INSTALL.sql

舊 Supabase 可只跑：
SQL_RUN_THIS_ONLY_v75_FREE_DATA_CLEAN_INSTALL.sql

GitHub 需要 Secrets：
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY

v75 邏輯：
- 玩運彩只抓賽事與運彩盤。
- MLB 投手數據嘗試用免費 MLB Stats API 補 ERA / WHIP / 勝敗。
- NBA/WNBA/足球維持乾淨欄位，抓不到顯示「無」，不亂塞整包文字。
- MLB/NBA/WNBA：yesterday = 玩運彩 today，today = 玩運彩 tomorrow。
- 其他聯盟：today = 玩運彩 today，tomorrow = 玩運彩 tomorrow。
