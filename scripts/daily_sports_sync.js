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
  // v78：前台不再出現整片「無」；抓不到免費資料時，顯示可用的賽前整理狀態。
  if (kind === 'pitcher') return [['ERA','資料整理中'],['WHIP','資料整理中'],['勝投','資料整理中'],['敗投','資料整理中'],['近況','依先發與盤口整理中']];
  if (kind === 'basketball') return [['場均得分','資料整理中'],['場均失分','資料整理中'],['命中率','資料整理中'],['籃板','資料整理中'],['助攻','資料整理中'],['近況','依盤口與近期賽程綜合評估']];
  if (kind === 'football') return [['近五場進球','資料整理中'],['近五場失球','資料整理中'],['主客場','資料整理中'],['近期對戰','資料整理中'],['近況','依盤口與主客場條件評估']];
  return [['近況','依目前盤口條件評估']];
}
function safeMarketText(v){ const x=String(v||'').trim(); return x && !/undefined|null/.test(x) ? x : '尚未開盤'; }
function pctFromConfidence(arr, idx, fallback=50){
  const n = Array.isArray(arr) ? Number(arr[idx]||0) : 0;
  return Number.isFinite(n) && n > 0 ? Math.max(42, Math.min(76, n)) : fallback;
}
function marketFavTeam(game){
  const m = safeMarketText(game.money);
  if(m.includes(game.away)) return game.away;
  if(m.includes(game.home)) return game.home;
  if(/主隊勝|主勝/.test(m)) return game.away;
  if(/客隊勝|客勝/.test(m)) return game.home;
  return '';
}
function teamPerc(game, leftTeam, rightTeam, base=55){
  const fav = marketFavTeam(game);
  if(fav && fav === leftTeam) return [base, 100-base];
  if(fav && fav === rightTeam) return [100-base, base];
  return [50,50];
}
function genericMetrics(game,trueAway,trueHome){
  const money = safeMarketText(game.money), spread = safeMarketText(game.spread), total = safeMarketText(game.total);
  const [mL,mR] = teamPerc(game, trueAway, trueHome, pctFromConfidence(game.confidence,0,56));
  const [sL,sR] = spread.includes(trueAway) ? [pctFromConfidence(game.confidence,1,55), 45] : spread.includes(trueHome) ? [45, pctFromConfidence(game.confidence,1,55)] : [50,50];
  const totalHint = /大/.test(total) ? '大分傾向' : /小/.test(total) ? '小分傾向' : '尚未開盤';
  if(game.sport === 'football') return [
    ['獨贏盤', money, money, mL, mR, money === '尚未開盤' ? '尚未開盤' : '盤口方向', money === '尚未開盤' ? '尚未開盤' : '盤口方向'],
    ['大小球', total, total, pctFromConfidence(game.confidence,2,54), 100-pctFromConfidence(game.confidence,2,54), totalHint, totalHint],
    ['近期狀態', '資料整理中', '資料整理中', 50, 50, '無明顯傷停', '無明顯傷停'],
    ['AI綜合', money === '尚未開盤' ? '觀望' : money, total === '尚未開盤' ? '觀望' : total, mL, mR, '依盤口與主客場', '依盤口與主客場']
  ];
  if(game.sport === 'basketball') return [
    ['獨贏盤', money, money, mL, mR, money === '尚未開盤' ? '尚未開盤' : '盤口方向', money === '尚未開盤' ? '尚未開盤' : '盤口方向'],
    ['讓分盤', spread, spread, sL, sR, spread === '尚未開盤' ? '尚未開盤' : '讓分參考', spread === '尚未開盤' ? '尚未開盤' : '讓分參考'],
    ['大小分', total, total, pctFromConfidence(game.confidence,2,54), 100-pctFromConfidence(game.confidence,2,54), totalHint, totalHint],
    ['近況', '資料整理中', '資料整理中', 50, 50, '待賽前名單', '待賽前名單']
  ];
  return [
    ['獨贏盤', money, money, mL, mR, money === '尚未開盤' ? '尚未開盤' : '盤口方向', money === '尚未開盤' ? '尚未開盤' : '盤口方向'],
    ['讓分盤', spread, spread, sL, sR, spread === '尚未開盤' ? '尚未開盤' : '讓分參考', spread === '尚未開盤' ? '尚未開盤' : '讓分參考'],
    ['大小分', total, total, pctFromConfidence(game.confidence,2,54), 100-pctFromConfidence(game.confidence,2,54), totalHint, totalHint],
    ['先發狀態', '先發已列入', '先發已列入', 50, 50, '投手欄位見上方', '投手欄位見上方']
  ];
}
function defaultAnalysis(game, trueAway, trueHome, starters, links) {
  const isBaseball = game.sport === 'baseball', isBasketball = game.sport === 'basketball', isFootball = game.sport === 'football';
  const marketText = `獨贏：${safeMarketText(game.money)}；讓分：${safeMarketText(game.spread)}；大小分：${safeMarketText(game.total)}`;
  return {
    parser_version: 'v79-mlb-yahoo-official-stats', true_away: trueAway, true_home: trueHome, display_order: 'home_first', competition: isFootball ? (game.competition || '足球') : game.league,
    market_day_label: game.game_day_type === 'yesterday' ? '昨日賽事' : game.game_day_type === 'tomorrow' ? '明日賽事' : '今日賽事',
    starters: isBaseball ? starters.map(s => ({...s, stats: defaultStats('pitcher')})) : [],
    core_players: isBasketball ? [
      {team: trueHome, name:'核心球員', role:'主隊', award:'資料中心整理中', stats: defaultStats('basketball')},
      {team: trueAway, name:'核心球員', role:'客隊', award:'資料中心整理中', stats: defaultStats('basketball')}
    ] : [],
    metrics: genericMetrics(game,trueAway,trueHome),
    injuries: [[trueAway,'傷員狀況','目前未列入主要傷兵','正常'],[trueHome,'傷員狀況','目前未列入主要傷兵','正常']],
    h2h: [['近期對戰',[trueAway,'資料整理中'],[trueHome,'資料整理中'],'盤口前參考']],
    recent: [{team:trueAway,side:'客隊',items:[['近況',trueAway,'盤口與賽前資料整理中','-']]},{team:trueHome,side:'主隊',items:[['近況',trueHome,'盤口與賽前資料整理中','-']]}],
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


const MLB_TEAM_IDS = {
  '響尾蛇':109,'亞利桑那':109,'勇士':144,'亞特蘭大':144,'金鶯':110,'巴爾的摩':110,'紅襪':111,'波士頓':111,
  '小熊':112,'芝加哥小熊':112,'白襪':145,'芝加哥白襪':145,'紅人':113,'辛辛那提':113,'守護者':114,'克里夫蘭':114,
  '洛磯':115,'科羅拉多':115,'老虎':116,'底特律':116,'太空人':117,'休士頓':117,'皇家':118,'堪薩斯':118,
  '天使':108,'洛杉磯天使':108,'道奇':119,'洛杉磯道奇':119,'馬林魚':146,'邁阿密':146,'釀酒人':158,'密爾瓦基':158,
  '雙城':142,'明尼蘇達':142,'大都會':121,'紐約大都會':121,'洋基':147,'紐約洋基':147,'運動家':133,'奧克蘭':133,'費城人':143,'費城':143,
  '海盜':134,'匹茲堡':134,'教士':135,'聖地牙哥':135,'巨人':137,'舊金山':137,'水手':136,'西雅圖':136,
  '紅雀':138,'聖路易':138,'光芒':139,'坦帕灣':139,'遊騎兵':140,'德州':140,'藍鳥':141,'多倫多':141,'國民':120,'華盛頓':120
};
function mlbTeamId(name=''){
  const n = String(name||'').replace(/\s+/g,'').replace(/隊$/,'');
  if(MLB_TEAM_IDS[n]) return MLB_TEAM_IDS[n];
  for(const [k,v] of Object.entries(MLB_TEAM_IDS)) if(n.includes(k) || k.includes(n)) return v;
  return null;
}
async function fetchJson(url){
  try{
    const res = await fetch(url, {headers:{'User-Agent':'Mozilla/5.0','Accept':'application/json,text/plain,*/*'}});
    if(!res.ok) return null;
    return await res.json();
  }catch(e){ console.warn('fetchJson failed:', url, e.message); return null; }
}
const mlbScheduleCache = new Map();
async function mlbSchedule(date){
  if(!date) return [];
  if(mlbScheduleCache.has(date)) return mlbScheduleCache.get(date);
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}&hydrate=probablePitcher,team,linescore`;
  const j = await fetchJson(url);
  const games = j?.dates?.flatMap(d=>d.games||[]) || [];
  mlbScheduleCache.set(date, games);
  console.log(`MLB official schedule ${date}: ${games.length} games`);
  return games;
}
const mlbPitcherStatCache = new Map();
async function mlbPitcherStatsById(personId){
  if(!personId) return null;
  if(mlbPitcherStatCache.has(personId)) return mlbPitcherStatCache.get(personId);
  const season = new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Taipei',year:'numeric'}).format(new Date());
  const url = `https://statsapi.mlb.com/api/v1/people/${personId}/stats?stats=season&group=pitching&season=${season}`;
  const j = await fetchJson(url);
  const stat = j?.stats?.[0]?.splits?.[0]?.stat || null;
  const out = stat ? {
    era: String(stat.era ?? '無'), whip: String(stat.whip ?? '無'), wins: String(stat.wins ?? '0'), losses: String(stat.losses ?? '0'), games: String(stat.gamesPlayed ?? '無'), strikeOuts: String(stat.strikeOuts ?? '無')
  } : null;
  mlbPitcherStatCache.set(personId, out);
  await sleep(60);
  return out;
}
function mlbQueryDate(game){
  const siteDay = game.raw_data?.site_day || game.game_day_type;
  // MLB/NBA/WNBA 的前台「今日」來自玩運彩 tomorrow，所以官方賽程也先抓台灣明天；抓不到會再用今天備援。
  return siteDay === 'tomorrow' ? twDate(1) : twDate(0);
}
async function findOfficialMlbGame(game){
  const aj = game.analysis_json || {};
  const awayName = aj.true_away || game.home || game.away;
  const homeName = aj.true_home || game.away || game.home;
  const awayId = mlbTeamId(awayName), homeId = mlbTeamId(homeName);
  if(!awayId || !homeId) return null;
  const dates = [mlbQueryDate(game), twDate(0), twDate(1)].filter((v,i,a)=>v && a.indexOf(v)===i);
  for(const d of dates){
    const games = await mlbSchedule(d);
    const match = games.find(x => {
      const a = x?.teams?.away?.team?.id, h = x?.teams?.home?.team?.id;
      return (a === awayId && h === homeId) || (a === homeId && h === awayId);
    });
    if(match) return {game:match, awayId, homeId, awayName, homeName, date:d};
  }
  return null;
}
function pitcherBlock(team, name, role, stats){
  return { team, name: name || '無', role, stats:[
    ['ERA', stats?.era ?? '無'], ['WHIP', stats?.whip ?? '無'], ['勝投', stats?.wins ?? '0'], ['敗投', stats?.losses ?? '0'], ['近況', stats ? `本季 ${stats.games || '無'} 場，三振 ${stats.strikeOuts || '無'}` : '無']
  ]};
}
async function enrichMLB(games){
  let enriched=0, matched=0;
  for (const g of games.filter(x=>x.league==='MLB')) {
    const found = await findOfficialMlbGame(g);
    const aj = g.analysis_json || {};
    if(!found){
      // 官方賽程沒對到時，至少不要空白；保留玩運彩先發名字。
      aj.starters = (aj.starters||[]).map(st => pitcherBlock(st.team, st.name, st.role, null));
      aj.injuries = [[aj.true_away || g.home,'傷員狀況','目前未列入主要傷兵','正常'],[aj.true_home || g.away,'傷員狀況','目前未列入主要傷兵','正常']];
      aj.h2h = [['近期對戰',[aj.true_away || g.home,'官方賽程未對應'],[aj.true_home || g.away,'官方賽程未對應'],'無']];
      g.analysis_json = aj;
      continue;
    }
    matched++;
    const off = found.game;
    const awayTeam = off.teams?.away?.team || {}, homeTeam = off.teams?.home?.team || {};
    const awayPitcher = off.teams?.away?.probablePitcher || null;
    const homePitcher = off.teams?.home?.probablePitcher || null;
    const awayStats = await mlbPitcherStatsById(awayPitcher?.id);
    const homeStats = await mlbPitcherStatsById(homePitcher?.id);
    const awayZh = found.awayName, homeZh = found.homeName;
    aj.starters = [
      pitcherBlock(homeZh, homePitcher?.fullName || '無', '主隊先發', homeStats),
      pitcherBlock(awayZh, awayPitcher?.fullName || '無', '客隊先發', awayStats)
    ];
    const awayRec = off.teams?.away?.leagueRecord ? `${off.teams.away.leagueRecord.wins}勝${off.teams.away.leagueRecord.losses}敗` : '無';
    const homeRec = off.teams?.home?.leagueRecord ? `${off.teams.home.leagueRecord.wins}勝${off.teams.home.leagueRecord.losses}敗` : '無';
    aj.metrics = [
      ['球隊戰績', awayRec, homeRec, 50, 50, awayRec, homeRec],
      ['先發ERA', awayStats?.era ?? '無', homeStats?.era ?? '無', 50, 50, awayPitcher?.fullName || '無', homePitcher?.fullName || '無'],
      ['先發WHIP', awayStats?.whip ?? '無', homeStats?.whip ?? '無', 50, 50, '官方投手數據', '官方投手數據'],
      ['盤口方向', safeMarketText(g.money), safeMarketText(g.spread), pctFromConfidence(g.confidence,0,55), pctFromConfidence(g.confidence,1,55), safeMarketText(g.money), safeMarketText(g.spread)]
    ];
    aj.injuries = [[awayZh,'傷員狀況','目前未列入主要傷兵','正常'],[homeZh,'傷員狀況','目前未列入主要傷兵','正常']];
    aj.h2h = [['近期對戰',[awayZh, awayRec],[homeZh, homeRec],'以本季戰績與本場先發投手做賽前參考']];
    aj.recent = [
      {team:awayZh,side:'客隊',items:[['近況',awayZh,awayRec,'官方戰績'],['先發',awayPitcher?.fullName || '無', awayStats ? `ERA ${awayStats.era} / WHIP ${awayStats.whip}` : '無','投手']]},
      {team:homeZh,side:'主隊',items:[['近況',homeZh,homeRec,'官方戰績'],['先發',homePitcher?.fullName || '無', homeStats ? `ERA ${homeStats.era} / WHIP ${homeStats.whip}` : '無','投手']]}
    ];
    aj.detail_status = 'mlb_official_stats_enriched';
    aj.data_sources = [];
    g.analysis_json = aj;
    enriched++;
  }
  console.log(`MLB official enrichment matched ${matched} games, enriched ${enriched} games.`);
  return games;
}
async function enrichOtherFree(games){
  for(const g of games){
    const aj = g.analysis_json || {};
    if(!Array.isArray(aj.injuries) || !aj.injuries.length) aj.injuries = [[g.home,'傷員狀況','目前未列入主要傷兵','正常'],[g.away,'傷員狀況','目前未列入主要傷兵','正常']];
    if(!Array.isArray(aj.h2h) || !aj.h2h.length) aj.h2h = [['近期對戰',[g.home,'資料整理中'],[g.away,'資料整理中'],'盤口前參考']];
    if(!Array.isArray(aj.recent) || !aj.recent.length) aj.recent = [{team:g.home,side:'客隊',items:[['近況',g.home,'資料中心整理中','-']]},{team:g.away,side:'主隊',items:[['近況',g.away,'資料中心整理中','-']]}];
    if(!Array.isArray(aj.metrics) || !aj.metrics.length) aj.metrics = genericMetrics(g,g.home,g.away);
    if(g.sport === 'basketball') {
      aj.core_players = [
        {team:g.away,name:'核心球員',role:'主隊',award:'資料中心整理中',stats:defaultStats('basketball')},
        {team:g.home,name:'核心球員',role:'客隊',award:'資料中心整理中',stats:defaultStats('basketball')}
      ];
    }
    if(g.sport === 'football') {
      aj.football_summary = {home:`${g.away}：近期狀態依盤口與主客場條件整理中。`,away:`${g.home}：近期狀態依盤口與主客場條件整理中。`,conclusion:`獨贏：${safeMarketText(g.money)}；讓分：${safeMarketText(g.spread)}；大小分：${safeMarketText(g.total)}。目前以盤口方向與主客場條件做初步判斷。`};
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
    const run = await supabase('raw_sports_sync_runs', {method:'POST', headers:{Prefer:'return=representation'}, body:JSON.stringify([{source:'github_actions',version:'v79-mlb-yahoo-official-stats',status:'success',total_games:rows.length,created_at:nowISO()}])});
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
  await supabase('daily_sync_status', {method:'POST', headers:{Prefer:'return=minimal'}, body:JSON.stringify([{status:'success',message:`v79 synced ${rows.length} games`,games_count:rows.length,source:'v79-mlb-yahoo-official-stats',created_at:nowISO()}])}).catch(()=>{});
}
async function main(){
  console.log(`v79 Taiwan date=${twDate(0)}`);
  let games = await scrapePlaySport();
  games = await enrichMLB(games);
  games = await enrichOtherFree(games);
  console.log(`Final valid games: ${games.length}`);
  console.log(games.slice(0,80).map(g=>`${g.game_day_type} ${g.league} ${g.game_time} ${g.away} vs ${g.home} | ${g.money} | ${g.spread} | ${g.total}`).join('\n'));
  await writeDaily(games);
}
main().catch(e=>{ console.error(e); process.exit(1); });
