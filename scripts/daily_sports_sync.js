import { chromium } from 'playwright';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in GitHub Secrets');

const BASE_URL = 'https://www.playsport.cc/predict/games';
const TARGETS = [
  { allianceId: 1, label: 'MLB', sport: 'baseball', league: 'MLB', usShift: true },
  { allianceId: 2, label: '日本職棒', sport: 'baseball', league: 'NPB' },
  { allianceId: 6, label: '中華職棒', sport: 'baseball', league: 'CPBL' },
  { allianceId: 9, label: '韓國職棒', sport: 'baseball', league: 'KBO' },
  { allianceId: 3, label: 'NBA', sport: 'basketball', league: 'NBA', usShift: true },
  { allianceId: 7, label: 'WNBA', sport: 'basketball', league: 'WNBA', usShift: true },
  { allianceId: 94, label: '中國職籃', sport: 'basketball', league: 'CBA' },
  { allianceId: 4, label: '足球', sport: 'football', league: '足球' }
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
function twDate(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function nowISO() { return new Date().toISOString(); }
function norm(s='') { return String(s||'').replace(/\u00a0/g,' ').replace(/[\t ]+/g,' ').replace(/\n\s*/g,'\n').trim(); }
function one(s='') { return norm(s).replace(/\s*\n\s*/g,' ').replace(/\s+/g,' ').trim(); }
function lines(s='') { return norm(s).split('\n').map(x => x.replace(/[○◎●◯]/g,'').trim()).filter(Boolean); }
function cleanTeam(s='') {
  return one(s).replace(/^(客隊|主隊|客|主|和|VS|V\.S\.|對戰資訊)\s*/i,'').replace(/^\d{1,5}\s*$/,'').replace(/[,，|｜:：]/g,' ').replace(/\s+/g,' ').trim();
}
function badTeam(s='') {
  const t = cleanTeam(s);
  return !t || t.length < 2 || t.length > 28 || /^[\d\s.\-+]+$/.test(t) || /(vs|v\.s\.|\bS\.\s*\d)/i.test(t) || /賽事資訊|球隊資訊|運彩盤|國際盤|登入|日期|讓分|大小|不讓分|獨贏|預測賽事/.test(t);
}
function timeFrom(s='') { const m = one(s).match(/\b(?:AM|PM)\s*\d{1,2}:\d{2}\b|\b\d{1,2}:\d{2}\b/i); return m ? m[0].replace(/\s+/, ' ').toUpperCase() : ''; }
function nums(s='') { return [...String(s).matchAll(/[+-]?\d+(?:\.\d+)?/g)].map(m => Number(m[0])); }
function parseMarket(text='') {
  const raw = one(text).replace(/\s*,\s*/g, ', ');
  const side = raw.includes('客') ? '客' : raw.includes('主') ? '主' : raw.includes('和') ? '和' : raw.includes('大') ? '大' : raw.includes('小') ? '小' : '';
  const ns = nums(raw);
  if (!side) return null;
  if (side === '大' || side === '小') return { raw, side, line: ns[0] ?? null, odds: ns.length > 1 ? ns[ns.length-1] : null };
  if (side === '客' || side === '主') return { raw, side, line: ns.length > 1 ? ns[0] : null, odds: ns.length > 1 ? ns[ns.length-1] : ns[0] ?? null };
  if (side === '和') return { raw, side, line: null, odds: ns[0] ?? null };
  return null;
}
function okMarket(m){ return m && m.side && Number.isFinite(m.odds) && m.odds > 0; }
function low(...m){ return m.filter(okMarket).sort((a,b)=>a.odds-b.odds)[0] || null; }
function showLine(n){ return n == null ? '' : `${n > 0 ? '+' : ''}${n}`; }
function buildMarkets({sport, away, home, spreadA, spreadH, moneyA, moneyH, moneyD, over, under}) {
  const mp = sport === 'football' ? low(moneyA, moneyH, moneyD) : low(moneyA, moneyH);
  const sp = sport === 'football' ? null : low(spreadA, spreadH);
  const tp = low(over, under);
  let money = '尚未開盤';
  if (okMarket(mp)) money = sport === 'football' ? (mp.side === '客' ? '客隊勝' : mp.side === '主' ? '主隊勝' : mp.side === '和' ? '和局' : '尚未開盤') : `${mp.side === '客' ? away : home}勝`;
  let spread = '尚未開盤';
  if (sport === 'football') spread = money;
  else if (okMarket(sp) && sp.line != null) spread = `${sp.side === '客' ? away : home} ${showLine(sp.line)}`;
  const totalLine = over?.line ?? under?.line;
  const total = okMarket(tp) && totalLine != null ? `${tp.side === '小' ? '小' : '大'} ${Math.abs(totalLine)}` : '尚未開盤';
  const conf = [mp, sp, tp].map(x => okMarket(x) ? Math.max(52, Math.min(76, Math.round(100 / x.odds))) : 0);
  return { money, spread, total, confidence: conf };
}
function defaultStats(kind){
  if (kind === 'pitcher') return [['ERA','無'],['WHIP','無'],['勝投','無'],['敗投','無'],['近況','尚無明確異常']];
  if (kind === 'basketball') return [['場均得分','無'],['場均失分','無'],['命中率','無'],['籃板','無'],['助攻','無'],['近況','尚無明確異常']];
  if (kind === 'football') return [['近五場進球','無'],['近五場失球','無'],['主客場','無'],['近期對戰','無'],['近況','尚無明確異常']];
  return [['近況','尚無明確異常']];
}
function safeMarketText(v){ const x=String(v||'').trim(); return x && !/undefined|null/.test(x) ? x : '尚未開盤'; }
function genericMetrics(game,trueAway,trueHome){
  if(game.sport === 'football') return [
    ['近況', '無', '無', 50, 50, `${trueAway}近期資料整理中`, `${trueHome}近期資料整理中`],
    ['近期對戰', '無', '無', 50, 50, '尚無可用對戰紀錄', '尚無可用對戰紀錄'],
    ['獨贏方向', safeMarketText(game.money), safeMarketText(game.money), 50, 50, '依目前盤口參考', '依目前盤口參考'],
    ['大小分', safeMarketText(game.total), safeMarketText(game.total), 50, 50, '依目前盤口參考', '依目前盤口參考']
  ];
  if(game.sport === 'basketball') return [
    ['場均得分','無','無',50,50,'資料中心整理中','資料中心整理中'],
    ['場均失分','無','無',50,50,'資料中心整理中','資料中心整理中'],
    ['近五場','無','無',50,50,'尚無完整近況','尚無完整近況'],
    ['盤口適配',safeMarketText(game.spread),safeMarketText(game.total),50,50,'讓分參考','大小分參考']
  ];
  return [
    ['先發狀態','無','無',50,50,'投手資料整理中','投手資料整理中'],
    ['團隊近況','無','無',50,50,'尚無完整近況','尚無完整近況'],
    ['對戰紀錄','無','無',50,50,'尚無完整對戰','尚無完整對戰'],
    ['盤口適配',safeMarketText(game.spread),safeMarketText(game.total),50,50,'讓分參考','大小分參考']
  ];
}
function defaultAnalysis(game, trueAway, trueHome, starters, links) {
  const isBaseball = game.sport === 'baseball', isBasketball = game.sport === 'basketball', isFootball = game.sport === 'football';
  const marketText = `獨贏：${safeMarketText(game.money)}；讓分：${safeMarketText(game.spread)}；大小分：${safeMarketText(game.total)}`;
  return {
    parser_version: 'v76-display-stats', true_away: trueAway, true_home: trueHome, display_order: 'home_first', competition: isFootball ? (game.competition || '足球') : game.league,
    market_day_label: game.game_day_type === 'yesterday' ? '昨日賽事' : game.game_day_type === 'tomorrow' ? '明日賽事' : '今日賽事',
    starters: isBaseball ? starters.map(s => ({...s, stats: defaultStats('pitcher')})) : [],
    core_players: isBasketball ? [
      {team: trueHome, name:'核心球員', role:'主隊', award:'資料中心整理中', stats: defaultStats('basketball')},
      {team: trueAway, name:'核心球員', role:'客隊', award:'資料中心整理中', stats: defaultStats('basketball')}
    ] : [],
    metrics: genericMetrics(game,trueAway,trueHome),
    injuries: [[trueAway,'傷員狀況','目前未列入主要傷兵','無'],[trueHome,'傷員狀況','目前未列入主要傷兵','無']],
    h2h: [['近期對戰',[trueAway,'無'],[trueHome,'無'],'無']],
    recent: [{team:trueAway,side:'客隊',items:[['近況',trueAway,'資料中心整理中','-']]},{team:trueHome,side:'主隊',items:[['近況',trueHome,'資料中心整理中','-']]}],
    football_summary: isFootball ? {home:`${trueHome}：近期狀態資料整理中。`,away:`${trueAway}：近期狀態資料整理中。`,conclusion:`${marketText}。目前以盤口方向與主客場條件做初步判斷。`} : null,
    team_urls: links.teamUrls || [], battle_url: links.battleUrl || '', detail_status: 'filled_fallback', odds_hidden: true, source_note: '', data_sources: []
  };
}
function isFinished(group) {
  const text = group.rows.map(r=>r.text).join(' ');
  const scores = group.rows.flatMap(r=>r.cells).filter(c => c.cls.includes('scores')).map(c => c.text).join(' ');
  return /已完賽|完賽|比賽結束|終了|結束/.test(text) || (/V\.?S\.?/i.test(scores) && (scores.match(/\b\d+\b/g)||[]).length >= 2);
}
async function extractGroups(page){
  return page.evaluate(() => {
    const norm = s => String(s||'').replace(/\u00a0/g,' ').trim();
    const cell = td => ({ text:norm(td.innerText||td.textContent||''), cls:[...td.classList].join(' '), links:[...td.querySelectorAll('a')].map(a=>({text:norm(a.innerText||a.textContent||''),href:a.href||''})) });
    const table = document.querySelector('table.predictgame-table') || [...document.querySelectorAll('table')].sort((a,b)=>(b.innerText||'').length-(a.innerText||'').length)[0];
    if (!table) return [];
    const trs = [...table.querySelectorAll('tr')].map(tr=>({text:norm(tr.innerText||tr.textContent||''),cells:[...tr.children].filter(x=>/^(TD|TH)$/.test(x.tagName)).map(cell)})).filter(r=>r.text && r.cells.length);
    const groups=[]; let cur=null;
    for (const row of trs) {
      if (/賽事資訊|球隊資訊|國際盤|運彩盤/.test(row.text)) continue;
      const start = row.cells.some(c=>c.cls.includes('td-gameinfo')) && /(?:AM|PM)\s*\d{1,2}:\d{2}|\d{1,2}:\d{2}/i.test(row.text);
      const gap = row.cells.length === 1 && !row.text.trim();
      if (start) { if(cur) groups.push(cur); cur={rows:[row]}; }
      else if (cur && !gap) cur.rows.push(row);
      else if (cur && gap) { groups.push(cur); cur=null; }
    }
    if (cur) groups.push(cur);
    return groups;
  });
}
function firstLink(group, re){ for(const r of group.rows) for(const c of r.cells) for(const a of c.links||[]) if(re.test(a.text||'') || re.test(a.href||'')) return a.href; return ''; }
function teamLinks(group){ const out=[]; for(const r of group.rows) for(const c of r.cells) for(const a of c.links||[]) if(/gamesData\/teams/.test(a.href||'')) out.push({team:cleanTeam(a.text),url:a.href}); const seen=new Set(); return out.filter(x=>x.team&&!seen.has(x.team)&&seen.add(x.team)); }
function marketCell(group, cls, side){ for(const r of group.rows) for(const c of r.cells){ const t=one(c.text); if(!c.cls.includes(cls)) continue; if(side==='大'||side==='小'){ if(t.includes(side)) return c; } else if(side==='和'){ if(t.includes('和')) return c; } else if(new RegExp(`(^|\\s|\\|)${side}`).test(t)) return c; } return null; }
function parseTeams(group, sport){
  const info = group.rows.flatMap(r=>r.cells).find(c=>c.cls.includes('td-teaminfo'))?.text || '';
  const ls = lines(info).filter(x=>!/^\d+$/.test(x)&&!/^(V\.S\.|VS)$/i.test(x)).map(cleanTeam).filter(x=>!badTeam(x));
  const links = teamLinks(group).map(x=>x.team).filter(x=>!badTeam(x));
  const teams = links.length >= 2 ? links : ls;
  const details = lines(info).filter(x=>/[A-Za-z]/.test(x));
  return { away: teams[0] || '', home: teams[1] || '', awayDetail: details[0] || '', homeDetail: details[1] || '' };
}
function convertGroup(group, target, siteDay, sourceUrl){
  const all = group.rows.map(r=>r.text).join(' ');
  const gameTime = timeFrom(all); if(!gameTime) return null;
  const t = parseTeams(group, target.sport);
  if(badTeam(t.away) || badTeam(t.home) || t.away === t.home) return null;
  if(target.sport === 'baseball' && /(vs|v\.s\.|\bS\.\s*\d)/i.test(`${t.away} ${t.home}`)) return null;
  const spreadA = target.sport === 'football' ? null : parseMarket(marketCell(group,'td-bank-bet01','客')?.text || '');
  const spreadH = target.sport === 'football' ? null : parseMarket(marketCell(group,'td-bank-bet01','主')?.text || '');
  const moneyA = parseMarket(marketCell(group,'td-bank-bet03','客')?.text || '') || parseMarket(marketCell(group,'td-bank-bet01','客')?.text || '');
  const moneyH = parseMarket(marketCell(group,'td-bank-bet03','主')?.text || '') || parseMarket(marketCell(group,'td-bank-bet01','主')?.text || '');
  const moneyD = parseMarket(marketCell(group,'td-bank-bet03','和')?.text || '') || parseMarket(marketCell(group,'td-bank-bet01','和')?.text || '');
  const over = parseMarket(marketCell(group,'td-bank-bet02','大')?.text || '');
  const under = parseMarket(marketCell(group,'td-bank-bet02','小')?.text || '');
  const m = buildMarkets({sport:target.sport, away:t.away, home:t.home, spreadA, spreadH, moneyA, moneyH, moneyD, over, under});
  const us = target.usShift;
  const gameDayType = us ? (siteDay === 'today' ? 'yesterday' : 'today') : siteDay;
  const status = siteDay === 'today' && isFinished(group) ? 'finished' : 'upcoming';
  const game = { game_date: twDate(0), game_day_type: gameDayType, game_status: status, sport: target.sport, league: target.league, game_time: gameTime,
    away: t.home, home: t.away, money:m.money, spread:m.spread, total:m.total, confidence:m.confidence,
    source_url: sourceUrl, source_name:'資料中心', active:true, updated_at: nowISO() };
  const starters = target.sport === 'baseball' ? [
    {team:t.home,name:t.homeDetail||'先發無',role:'主隊先發'}, {team:t.away,name:t.awayDetail||'先發無',role:'客隊先發'}
  ] : [];
  game.analysis_json = defaultAnalysis(game, t.away, t.home, starters, { battleUrl:firstLink(group,/battle|對戰資訊/), teamUrls:teamLinks(group) });
  game.raw_data = { site_day:siteDay, raw_text:one(all).slice(0,6000), odds:{spreadA,spreadH,moneyA,moneyH,moneyD,over,under}, links:{battleUrl:firstLink(group,/battle|對戰資訊/), teamUrls:teamLinks(group)} };
  return game;
}
async function scrapePlaySport(){
  const browser = await chromium.launch({headless:true});
  const context = await browser.newContext({ locale:'zh-TW', timezoneId:'Asia/Taipei', userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36' });
  const page = await context.newPage();
  const games=[];
  try {
    for (const target of TARGETS) {
      for (const siteDay of ['today','tomorrow']) {
        const url = `${BASE_URL}?allianceid=${target.allianceId}&gameday=${siteDay}`;
        console.log(`Opening ${target.league} siteDay=${siteDay} -> ${target.usShift ? (siteDay==='today'?'yesterday':'today') : siteDay}: ${url}`);
        await page.goto(url, { waitUntil:'domcontentloaded', timeout:45000 });
        await page.waitForTimeout(1200);
        const groups = await extractGroups(page);
        let parsed=0, skippedFinished=0;
        for (const g of groups) {
          const game = convertGroup(g, target, siteDay, url);
          if (!game) continue;
          // 非美國時差聯盟：today 只顯示未完賽；美國時差聯盟 yesterday 要包含賽果。
          if (!target.usShift && siteDay === 'today' && game.game_status === 'finished') { skippedFinished++; continue; }
          games.push(game); parsed++;
        }
        console.log(`${target.league} ${siteDay}: groups=${groups.length}, parsed=${parsed}, finished_skipped=${skippedFinished}`);
      }
    }
  } finally { await browser.close(); }
  return games;
}

async function mlbPeopleSearch(name){
  if(!name || name === '先發無') return null;
  try {
    const res = await fetch(`https://statsapi.mlb.com/api/v1/people/search?names=${encodeURIComponent(name)}`);
    if(!res.ok) return null;
    const j = await res.json();
    return Array.isArray(j.people) ? j.people[0] : null;
  } catch { return null; }
}
async function mlbPitcherStats(personId){
  if(!personId) return null;
  try {
    const res = await fetch(`https://statsapi.mlb.com/api/v1/people/${personId}/stats?stats=season&group=pitching`);
    if(!res.ok) return null;
    const j = await res.json();
    const stat = j?.stats?.[0]?.splits?.[0]?.stat || null;
    if(!stat) return null;
    return { era:String(stat.era ?? '無'), whip:String(stat.whip ?? '無'), wins:String(stat.wins ?? '無'), losses:String(stat.losses ?? '無') };
  } catch { return null; }
}
async function enrichMLB(games){
  const cache = new Map();
  let count=0;
  for (const g of games.filter(x=>x.league==='MLB')) {
    const starters = g.analysis_json?.starters || [];
    for (const st of starters) {
      const name = st.name;
      if(!cache.has(name)) {
        const p = await mlbPeopleSearch(name);
        const s = await mlbPitcherStats(p?.id);
        cache.set(name, s || null);
        await sleep(120);
      }
      const s = cache.get(name);
      st.stats = [['ERA',s?.era ?? '無'],['WHIP',s?.whip ?? '無'],['勝投',s?.wins ?? '無'],['敗投',s?.losses ?? '無'],['近況','無']];
      if(s) count++;
    }
  }
  console.log(`MLB free stats enrichment updated ${count} starter stat blocks.`);
  return games;
}
async function enrichOtherFree(games){
  for(const g of games){
    const aj = g.analysis_json || {};
    if(!Array.isArray(aj.injuries) || !aj.injuries.length) aj.injuries = [[g.home,'傷員狀況','目前未列入主要傷兵','無'],[g.away,'傷員狀況','目前未列入主要傷兵','無']];
    if(!Array.isArray(aj.h2h) || !aj.h2h.length) aj.h2h = [['近期對戰',[g.home,'無'],[g.away,'無'],'無']];
    if(!Array.isArray(aj.recent) || !aj.recent.length) aj.recent = [{team:g.home,side:'客隊',items:[['近況',g.home,'資料中心整理中','-']]},{team:g.away,side:'主隊',items:[['近況',g.away,'資料中心整理中','-']]}];
    if(!Array.isArray(aj.metrics) || !aj.metrics.length) aj.metrics = genericMetrics(g,g.home,g.away);
    if(g.sport === 'basketball') {
      aj.core_players = [
        {team:g.away,name:'核心球員',role:'主隊',award:'資料中心整理中',stats:defaultStats('basketball')},
        {team:g.home,name:'核心球員',role:'客隊',award:'資料中心整理中',stats:defaultStats('basketball')}
      ];
    }
    if(g.sport === 'football') {
      aj.football_summary = {home:`${g.away}：近期狀態資料整理中。`,away:`${g.home}：近期狀態資料整理中。`,conclusion:`獨贏：${safeMarketText(g.money)}；讓分：${safeMarketText(g.spread)}；大小分：${safeMarketText(g.total)}。目前以盤口方向與主客場條件做初步判斷。`};
    }
    g.analysis_json = aj;
  }
  return games;
}
async function supabase(path, options={}){
  const url = `${SUPABASE_URL.replace(/\/$/,'')}/rest/v1/${path}`;
  const res = await fetch(url, { ...options, headers:{ apikey:SUPABASE_SERVICE_ROLE_KEY, Authorization:`Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type':'application/json', ...(options.headers||{}) }});
  const txt = await res.text();
  if(!res.ok) throw new Error(txt || `${res.status} ${res.statusText}`);
  try { return txt ? JSON.parse(txt) : null; } catch { return txt; }
}
async function writeRaw(rows){
  try {
    const run = await supabase('raw_sports_sync_runs', {method:'POST', headers:{Prefer:'return=representation'}, body:JSON.stringify([{source:'github_actions',version:'v76-display-stats',status:'success',total_games:rows.length,created_at:nowISO()}])});
    const runId = Array.isArray(run) && run[0]?.id;
    if(!runId) return;
    const rawRows = rows.map(g=>({run_id:runId,game_date:g.game_date,game_day_type:g.game_day_type,game_status:g.game_status,sport:g.sport,league:g.league,game_time:g.game_time,away:g.away,home:g.home,source_url:g.source_url,raw_text:g.raw_data?.raw_text||'',parsed_json:g,created_at:nowISO()}));
    if(rawRows.length) await supabase('raw_sports_games', {method:'POST', headers:{Prefer:'return=minimal'}, body:JSON.stringify(rawRows)});
    console.log(`Saved ${rawRows.length} raw rows.`);
  } catch(e) { console.warn('Raw tables skipped:', e.message); }
}
function strip(g){ const {raw_data, ...x}=g; return x; }
async function writeDaily(rows){
  await writeRaw(rows);
  await supabase(`daily_games?game_date=eq.${twDate(0)}`, {method:'PATCH', headers:{Prefer:'return=minimal'}, body:JSON.stringify({active:false,updated_at:nowISO()})}).catch(e=>console.warn('deactivate skipped:', e.message));
  if(rows.length) await supabase('daily_games?on_conflict=game_date,game_day_type,league,away,home,game_time', {method:'POST', headers:{Prefer:'resolution=merge-duplicates,return=minimal'}, body:JSON.stringify(rows.map(strip))});
  await supabase('daily_sync_status', {method:'POST', headers:{Prefer:'return=minimal'}, body:JSON.stringify([{status:'success',message:`v76 synced ${rows.length} games`,games_count:rows.length,source:'v76-display-stats',created_at:nowISO()}])}).catch(()=>{});
}
async function main(){
  console.log(`v76 Taiwan date=${twDate(0)}`);
  let games = await scrapePlaySport();
  games = await enrichMLB(games);
  games = await enrichOtherFree(games);
  console.log(`Final valid games: ${games.length}`);
  console.log(games.slice(0,80).map(g=>`${g.game_day_type} ${g.league} ${g.game_time} ${g.away} vs ${g.home} | ${g.money} | ${g.spread} | ${g.total}`).join('\n'));
  await writeDaily(games);
}
main().catch(e=>{ console.error(e); process.exit(1); });
