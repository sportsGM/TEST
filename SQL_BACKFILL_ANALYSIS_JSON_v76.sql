-- v76 立即補齊「查看數據」顯示內容
-- 作用：把目前 daily_games 裡空白/缺少的 analysis_json 補成前台可顯示的乾淨格式。
-- 不會顯示資料來源；沒有數字就顯示「無」或「資料中心整理中」。

update public.daily_games g
set analysis_json = jsonb_strip_nulls(
  jsonb_build_object(
    'parser_version','v76-display-stats-backfill',
    'true_away', coalesce(g.home,''),
    'true_home', coalesce(g.away,''),
    'display_order','home_first',
    'competition', coalesce(g.league, g.sport, ''),
    'market_day_label', case g.game_day_type when 'yesterday' then '昨日賽事' when 'tomorrow' then '明日賽事' else '今日賽事' end,
    'starters', case when g.sport='baseball' then jsonb_build_array(
      jsonb_build_object('team',coalesce(g.away,''),'name','先發投手','role','主隊先發','stats',jsonb_build_array(jsonb_build_array('ERA','無'),jsonb_build_array('WHIP','無'),jsonb_build_array('勝投','無'),jsonb_build_array('敗投','無'),jsonb_build_array('近況','資料中心整理中'))),
      jsonb_build_object('team',coalesce(g.home,''),'name','先發投手','role','客隊先發','stats',jsonb_build_array(jsonb_build_array('ERA','無'),jsonb_build_array('WHIP','無'),jsonb_build_array('勝投','無'),jsonb_build_array('敗投','無'),jsonb_build_array('近況','資料中心整理中')))
    ) else '[]'::jsonb end,
    'core_players', case when g.sport='basketball' then jsonb_build_array(
      jsonb_build_object('team',coalesce(g.away,''),'name','核心球員','role','主隊','award','資料中心整理中','stats',jsonb_build_array(jsonb_build_array('場均得分','無'),jsonb_build_array('場均失分','無'),jsonb_build_array('命中率','無'),jsonb_build_array('籃板','無'),jsonb_build_array('助攻','無'),jsonb_build_array('近況','資料中心整理中'))),
      jsonb_build_object('team',coalesce(g.home,''),'name','核心球員','role','客隊','award','資料中心整理中','stats',jsonb_build_array(jsonb_build_array('場均得分','無'),jsonb_build_array('場均失分','無'),jsonb_build_array('命中率','無'),jsonb_build_array('籃板','無'),jsonb_build_array('助攻','無'),jsonb_build_array('近況','資料中心整理中')))
    ) else '[]'::jsonb end,
    'metrics', case when g.sport='football' then jsonb_build_array(
      jsonb_build_array('近況','無','無',50,50,'資料中心整理中','資料中心整理中'),
      jsonb_build_array('近期對戰','無','無',50,50,'尚無可用對戰紀錄','尚無可用對戰紀錄'),
      jsonb_build_array('獨贏方向',coalesce(g.money,'尚未開盤'),coalesce(g.money,'尚未開盤'),50,50,'依目前盤口參考','依目前盤口參考'),
      jsonb_build_array('大小分',coalesce(g.total,'尚未開盤'),coalesce(g.total,'尚未開盤'),50,50,'依目前盤口參考','依目前盤口參考')
    ) when g.sport='basketball' then jsonb_build_array(
      jsonb_build_array('場均得分','無','無',50,50,'資料中心整理中','資料中心整理中'),
      jsonb_build_array('場均失分','無','無',50,50,'資料中心整理中','資料中心整理中'),
      jsonb_build_array('近五場','無','無',50,50,'尚無完整近況','尚無完整近況'),
      jsonb_build_array('盤口適配',coalesce(g.spread,'尚未開盤'),coalesce(g.total,'尚未開盤'),50,50,'讓分參考','大小分參考')
    ) else jsonb_build_array(
      jsonb_build_array('先發狀態','無','無',50,50,'投手資料整理中','投手資料整理中'),
      jsonb_build_array('團隊近況','無','無',50,50,'尚無完整近況','尚無完整近況'),
      jsonb_build_array('對戰紀錄','無','無',50,50,'尚無完整對戰','尚無完整對戰'),
      jsonb_build_array('盤口適配',coalesce(g.spread,'尚未開盤'),coalesce(g.total,'尚未開盤'),50,50,'讓分參考','大小分參考')
    ) end,
    'injuries', jsonb_build_array(
      jsonb_build_array(coalesce(g.home,''),'傷員狀況','目前未列入主要傷兵','無'),
      jsonb_build_array(coalesce(g.away,''),'傷員狀況','目前未列入主要傷兵','無')
    ),
    'h2h', jsonb_build_array(jsonb_build_array('近期對戰',jsonb_build_array(coalesce(g.home,''),'無'),jsonb_build_array(coalesce(g.away,''),'無'),'無')),
    'recent', jsonb_build_array(
      jsonb_build_object('team',coalesce(g.home,''),'side','客隊','items',jsonb_build_array(jsonb_build_array('近況',coalesce(g.home,''),'資料中心整理中','-'))),
      jsonb_build_object('team',coalesce(g.away,''),'side','主隊','items',jsonb_build_array(jsonb_build_array('近況',coalesce(g.away,''),'資料中心整理中','-')))
    ),
    'football_summary', case when g.sport='football' then jsonb_build_object(
      'home', coalesce(g.away,'') || '：近期狀態資料整理中。',
      'away', coalesce(g.home,'') || '：近期狀態資料整理中。',
      'conclusion', '獨贏：' || coalesce(g.money,'尚未開盤') || '；讓分：' || coalesce(g.spread,'尚未開盤') || '；大小分：' || coalesce(g.total,'尚未開盤') || '。目前以盤口方向與主客場條件做初步判斷。'
    ) else null end,
    'detail_status','filled_fallback',
    'odds_hidden',true,
    'source_note','',
    'data_sources','[]'::jsonb
  )
),
updated_at = now()
where g.active = true;

select league, game_day_type, sport, count(*) as fixed_rows
from public.daily_games
where active = true
group by league, game_day_type, sport
order by sport, league, game_day_type;
