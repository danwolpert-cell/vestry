import Analytics from './Analytics.jsx';
import Crypto from './Crypto.jsx';
import Watchlist from './Watchlist.jsx';
import { useState, useEffect, useRef, useCallback } from "react";

// ── API KEY STATE (mutable so runtime entry works) ────────────────────────────
let FINNHUB_KEY = "YOUR_FINNHUB_KEY";

const C = {
  bg: "#080a0f", surface: "#0e1118", card: "#141720", border: "#1e2335",
  accent: "#4f8eff", accentDim: "rgba(79,142,255,0.12)",
  green: "#10b981", red: "#f43f5e", amber: "#f59e0b",
  text: "#e2e8f5", sub: "#7c87a0", muted: "#3d4660",
};

const fmt$ = n => n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
const fmtPct = n => n == null ? "—" : (n >= 0 ? "+" : "") + n.toFixed(2) + "%";
const fmtBig = n => { if (!n) return "—"; if (Math.abs(n) >= 1e9) return "$" + (n / 1e9).toFixed(1) + "B"; if (Math.abs(n) >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M"; return "$" + n.toLocaleString(); };
const timeAgo = ts => { const s = Date.now() / 1000 - ts; if (s < 60) return "just now"; if (s < 3600) return Math.floor(s / 60) + "m ago"; if (s < 86400) return Math.floor(s / 3600) + "h ago"; return Math.floor(s / 86400) + "d ago"; };

// ── FINNHUB ───────────────────────────────────────────────────────────────────
async function fh(path) {
  const key = FINNHUB_KEY;
  const url = `https://finnhub.io/api/v1${path}${path.includes("?") ? "&" : "?"}token=${key}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(r.status);
  return r.json();
}
const getQuote   = async t => {
    if (t.endsWith('.AX')) {
      const r = await fetch(`/api/asx-price?ticker=${t}`);
      const d = await r.json();
      return { c: d.c, pc: d.pc };
    }
    return fh(`/quote?symbol=${t}`);
  };
const getProfile = t  => fh(`/stock/profile2?symbol=${t}`);
const getNews    = t  => { const to = new Date().toISOString().slice(0,10); const from = new Date(Date.now()-7*864e5).toISOString().slice(0,10); return fh(`/company-news?symbol=${t}&from=${from}&to=${to}`); };
const searchFH   = q  => fh(`/search?q=${encodeURIComponent(q)}`);

// ── SEC EDGAR ─────────────────────────────────────────────────────────────────
async function getSecFilings(ticker) {
  try {
    const from = new Date(Date.now() - 90*864e5).toISOString().slice(0,10);
    const r = await fetch(`https://efts.sec.gov/LATEST/search-index?q=%22${ticker}%22&dateRange=custom&startdt=${from}&forms=10-K,10-Q,8-K`);
    const d = await r.json();
    return (d.hits?.hits || []).slice(0,8).map(h => ({
      type: h._source.form_type,
      date: h._source.file_date,
      description: Array.isArray(h._source.display_names) ? h._source.display_names.join(", ") : ticker,
      url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${ticker}&type=${h._source.form_type}&dateb=&owner=include&count=10`,
    }));
  } catch { return []; }
}

// ── SHARED UI ─────────────────────────────────────────────────────────────────
function Spinner({ size = 14 }) {
  return <div style={{ display:"inline-block", width:size, height:size, border:`2px solid ${C.border}`, borderTopColor:C.accent, borderRadius:"50%", animation:"spin 0.7s linear infinite", flexShrink:0 }} />;
}
function Tag({ children, color }) {
  return <span style={{ fontSize:11, fontWeight:700, padding:"2px 7px", borderRadius:5, background:color+"22", color, letterSpacing:"0.04em" }}>{children}</span>;
}
function StatBox({ label, value, sub, up }) {
  return (
    <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:12, padding:"18px 20px" }}>
      <div style={{ color:C.sub, fontSize:11, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:6 }}>{label}</div>
      <div style={{ fontSize:22, fontWeight:800, color:up===undefined?C.text:up?C.green:C.red, letterSpacing:"-0.5px" }}>{value}</div>
      {sub && <div style={{ fontSize:12, color:up===undefined?C.sub:up?C.green:C.red, marginTop:2 }}>{sub}</div>}
    </div>
  );
}

// ── ADD STOCK MODAL ───────────────────────────────────────────────────────────
function AddStockModal({ onAdd, onClose }) {
  const [mode, setMode]         = useState("search");
  const [market, setMarket]     = useState("US"); // "search" | "manual"
  const [query, setQuery]       = useState("");
  const [results, setResults]   = useState([]);
  const [selected, setSelected] = useState(null);
  const [shares, setShares]     = useState("");
  const [avgCost, setAvgCost]   = useState("");
  const [manTicker, setManTicker] = useState("");
  const [manName, setManName]   = useState("");
  const [manPrice, setManPrice] = useState("");
  const [searching, setSearching] = useState(false);
  const [adding, setAdding]     = useState(false);
  const [error, setError]       = useState("");
  const timer = useRef(null);

  useEffect(() => {
    clearTimeout(timer.current);
    setError("");
    if (!query.trim() || selected) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const d = await searchFH(query.trim());
        const filtered = (d.result || [])
          .filter(r => market === "ASX" ? r.symbol && r.symbol.endsWith(".AX") : r.symbol && !r.symbol.includes(".") && (r.type === "Common Stock" || r.type === "ETP"))
          .slice(0, 8);
        setResults(filtered);
        if (filtered.length === 0) setError("No results — try the ticker directly (e.g. AAPL) or use Manual Entry.");
      } catch {
        setError("Search unavailable — use Manual Entry below.");
        setResults([]);
      }
      setSearching(false);
    }, 450);
  }, [query, selected, market]);

  const pick = r => { setSelected(r); setQuery(r.symbol + " — " + r.description); setResults([]); setError(""); };
  const clear = () => { setSelected(null); setQuery(""); setResults([]); setError(""); };

  const submitSearch = async () => {
    if (!selected || !shares || parseFloat(shares) <= 0) { setError("Pick a stock and enter shares."); return; }
    setAdding(true);
    let price = parseFloat(avgCost) || 0;
    try { const q = await getQuote(selected.symbol); if (q?.c > 0) price = q.c; } catch {}
    onAdd({ id: Date.now(), ticker: selected.symbol, name: selected.description, shares: parseFloat(shares), avgCost: parseFloat(avgCost) || price, currentPrice: price, change: 0 });
    setAdding(false); onClose();
  };

  const submitManual = async () => {
    const t = manTicker.trim().toUpperCase();
    if (!t || !shares || parseFloat(shares) <= 0) { setError("Ticker and shares are required."); return; }
    setAdding(true);
    let price = parseFloat(manPrice) || 0;
    let name  = manName.trim() || t;
    try { const q = await getQuote(t); if (q?.c > 0) price = q.c; } catch {}
    onAdd({ id: Date.now(), ticker: t, name, shares: parseFloat(shares), avgCost: parseFloat(avgCost) || price, currentPrice: price, change: 0 });
    setAdding(false); onClose();
  };

  const inp = { background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px", color: C.text, fontSize: 14, outline: "none", width: "100%", boxSizing: "border-box" };
  const canSubmitSearch = selected && shares && parseFloat(shares) > 0;
  const canSubmitManual = manTicker.trim() && shares && parseFloat(shares) > 0;

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.78)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:300 }} onClick={onClose}>
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:16, padding:28, width:430, boxShadow:"0 24px 60px rgba(0,0,0,0.7)", maxHeight:"90vh", overflowY:"auto" }} onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight:800, fontSize:17, marginBottom:16 }}>Add Stock</div>

        {/* Mode tabs */}
        <div style={{ display:"flex", gap:0, marginBottom:20, background:C.bg, borderRadius:8, padding:3 }}>
          {[["search","🔍 Search"], ["manual","✏️ Manual Entry"]].map(([m, label]) => (
            <button key={m} onClick={() => { setMode(m); setError(""); }}
              style={{ flex:1, padding:"7px 0", borderRadius:6, border:"none", background: mode===m ? C.surface : "none", color: mode===m ? C.text : C.sub, fontWeight: mode===m ? 700 : 400, cursor:"pointer", fontSize:13, transition:"all 0.15s" }}>
              {label}
            </button>
          ))}
        </div>

        {mode === "search" && (
          <>
            <div style={{ marginBottom:14 }}>
              <div style={{ display:"flex", gap:0, marginBottom:10, background:C.bg, borderRadius:8, padding:3 }}>{[["US","🇺🇸 US"],["ASX","🇦🇺 ASX"]].map(([m,label]) => (<button key={m} onClick={()=>{setMarket(m);setQuery("");setSelected(null);setResults([]);}} style={{ flex:1, padding:"7px 0", borderRadius:6, border:"none", background:market===m?C.surface:"none", color:market===m?C.text:C.sub, fontWeight:market===m?700:400, cursor:"pointer", fontSize:13 }}>{label}</button>))}</div><div style={{ color:C.sub, fontSize:12, marginBottom:6 }}>{market==="ASX"?"Search ASX ticker (e.g. CBA, BHP)":"Search by ticker or company name"}</div>
              <div style={{ position:"relative" }}>
                <input value={query} onChange={e => { setQuery(e.target.value); if (selected) clear(); }}
                  style={{ ...inp, paddingRight:36 }} placeholder="e.g. Apple, TSLA, Amazon…" autoFocus />
                <div style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)" }}>
                  {searching && <Spinner />}
                  {selected && !searching && <button onClick={clear} style={{ background:"none", border:"none", color:C.sub, cursor:"pointer", fontSize:16, padding:0 }}>✕</button>}
                </div>
              </div>
              {results.length > 0 && (
                <div style={{ background:C.bg, border:`1px solid ${C.border}`, borderRadius:8, marginTop:4, overflow:"hidden", maxHeight:210, overflowY:"auto" }}>
                  {results.map(r => (
                    <div key={r.symbol} onClick={() => pick(r)}
                      style={{ padding:"10px 14px", cursor:"pointer", display:"flex", gap:10, alignItems:"center", borderBottom:`1px solid ${C.border}` }}
                      onMouseEnter={e => e.currentTarget.style.background = C.surface}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      <span style={{ fontWeight:700, color:C.accent, minWidth:64, fontSize:14 }}>{r.symbol}</span>
                      <span style={{ color:C.sub, fontSize:13 }}>{r.description}</span>
                    </div>
                  ))}
                </div>
              )}
              {selected && (
                <div style={{ marginTop:6, padding:"8px 12px", background:C.accentDim, border:`1px solid ${C.accent}44`, borderRadius:8, display:"flex", alignItems:"center", gap:8 }}>
                  <span style={{ color:C.green }}>✓</span>
                  <span style={{ color:C.text, fontWeight:600, fontSize:13 }}>{selected.symbol}</span>
                  <span style={{ color:C.sub, fontSize:13 }}>{selected.description}</span>
                </div>
              )}
              {error && <div style={{ marginTop:6, color:C.red, fontSize:12 }}>{error}</div>}
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:20 }}>
              <div><div style={{ color:C.sub, fontSize:12, marginBottom:6 }}>Shares</div><input value={shares} onChange={e=>setShares(e.target.value)} style={inp} placeholder="e.g. 10" type="number" min="0.001" step="any" /></div>
              <div><div style={{ color:C.sub, fontSize:12, marginBottom:6 }}>Avg Cost ($) <span style={{ color:C.muted }}>(optional)</span></div><input value={avgCost} onChange={e=>setAvgCost(e.target.value)} style={inp} placeholder="Uses live price" type="number" min="0" step="any" /></div>
            </div>
            <div style={{ display:"flex", gap:10 }}>
              <button onClick={onClose} style={{ flex:1, padding:"10px 0", borderRadius:8, border:`1px solid ${C.border}`, background:"none", color:C.sub, cursor:"pointer", fontSize:14 }}>Cancel</button>
              <button onClick={submitSearch} disabled={!canSubmitSearch || adding}
                style={{ flex:2, padding:"10px 0", borderRadius:8, border:"none", background:C.accent, color:"#fff", cursor:"pointer", fontWeight:700, fontSize:14, opacity:canSubmitSearch&&!adding?1:0.4, display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
                {adding ? <><Spinner size={13}/> Adding…</> : "Add to Portfolio"}
              </button>
            </div>
          </>
        )}

        {mode === "manual" && (
          <>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:14 }}>
              <div>
                <div style={{ color:C.sub, fontSize:12, marginBottom:6 }}>Ticker <span style={{ color:C.red }}>*</span></div>
                <input value={manTicker} onChange={e=>setManTicker(e.target.value.toUpperCase())} style={inp} placeholder="e.g. AAPL" autoFocus />
              </div>
              <div>
                <div style={{ color:C.sub, fontSize:12, marginBottom:6 }}>Company Name</div>
                <input value={manName} onChange={e=>setManName(e.target.value)} style={inp} placeholder="e.g. Apple Inc." />
              </div>
              <div>
                <div style={{ color:C.sub, fontSize:12, marginBottom:6 }}>Shares <span style={{ color:C.red }}>*</span></div>
                <input value={shares} onChange={e=>setShares(e.target.value)} style={inp} placeholder="e.g. 10" type="number" min="0.001" step="any" />
              </div>
              <div>
                <div style={{ color:C.sub, fontSize:12, marginBottom:6 }}>Avg Cost ($)</div>
                <input value={avgCost} onChange={e=>setAvgCost(e.target.value)} style={inp} placeholder="Uses live price" type="number" min="0" step="any" />
              </div>
            </div>
            <div style={{ color:C.sub, fontSize:12, marginBottom:16 }}>💡 Live price will be fetched automatically from the ticker.</div>
            {error && <div style={{ color:C.red, fontSize:12, marginBottom:10 }}>{error}</div>}
            <div style={{ display:"flex", gap:10 }}>
              <button onClick={onClose} style={{ flex:1, padding:"10px 0", borderRadius:8, border:`1px solid ${C.border}`, background:"none", color:C.sub, cursor:"pointer", fontSize:14 }}>Cancel</button>
              <button onClick={submitManual} disabled={!canSubmitManual || adding}
                style={{ flex:2, padding:"10px 0", borderRadius:8, border:"none", background:C.accent, color:"#fff", cursor:"pointer", fontWeight:700, fontSize:14, opacity:canSubmitManual&&!adding?1:0.4, display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
                {adding ? <><Spinner size={13}/> Adding…</> : "Add to Portfolio"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── STOCK DETAIL PANEL ────────────────────────────────────────────────────────
function StockDetailPanel({ stock, onClose }) {
  const [quote,   setQuote]   = useState(null);
  const [profile, setProfile] = useState(null);
  const [news,    setNews]    = useState([]);
  const [filings, setFilings] = useState([]);
  const [tab,     setTab]     = useState("overview");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getQuote(stock.ticker).then(setQuote).catch(()=>{}),
      getProfile(stock.ticker).then(setProfile).catch(()=>{}),
      getNews(stock.ticker).then(d => setNews(d.slice(0,15))).catch(()=>{}),
      getSecFilings(stock.ticker).then(setFilings).catch(()=>{}),
    ]).finally(() => setLoading(false));
  }, [stock.ticker]);

  const price  = quote?.c  || stock.currentPrice;
  const change = quote?.dp || stock.change;

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", zIndex:200, display:"flex", alignItems:"stretch", justifyContent:"flex-end" }} onClick={onClose}>
      <div style={{ width:480, background:C.surface, borderLeft:`1px solid ${C.border}`, display:"flex", flexDirection:"column", overflowY:"auto" }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ padding:"20px 24px", borderBottom:`1px solid ${C.border}`, display:"flex", alignItems:"center", justifyContent:"space-between", position:"sticky", top:0, background:C.surface, zIndex:1 }}>
          <div>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              {profile?.logo && <img src={profile.logo} alt="" style={{ width:28, height:28, borderRadius:6, objectFit:"contain" }} onError={e=>e.target.style.display="none"} />}
              <span style={{ fontWeight:800, fontSize:20 }}>{stock.ticker}</span>
              {loading && <Spinner />}
            </div>
            <div style={{ color:C.sub, fontSize:12, marginTop:2 }}>{profile?.name || stock.name}</div>
          </div>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontSize:22, fontWeight:800 }}>{fmt$(price)}</div>
            <div style={{ fontSize:13, color:change>=0?C.green:C.red }}>{fmtPct(change)}</div>
          </div>
          <button onClick={onClose} style={{ background:"none", border:"none", color:C.sub, cursor:"pointer", fontSize:20, marginLeft:16 }}>✕</button>
        </div>

        {/* Tabs */}
        <div style={{ display:"flex", borderBottom:`1px solid ${C.border}`, padding:"0 24px" }}>
          {["overview","news","filings"].map(t => (
            <button key={t} onClick={()=>setTab(t)} style={{ background:"none", border:"none", padding:"12px 16px 10px", cursor:"pointer", color:tab===t?C.accent:C.sub, fontWeight:tab===t?700:400, borderBottom:tab===t?`2px solid ${C.accent}`:"2px solid transparent", fontSize:13, textTransform:"capitalize" }}>{t}</button>
          ))}
        </div>

        <div style={{ padding:"20px 24px", flex:1 }}>
          {tab === "overview" && (
            <div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:20 }}>
                {[["Open",fmt$(quote?.o)],["Prev Close",fmt$(quote?.pc)],["High",fmt$(quote?.h)],["Low",fmt$(quote?.l)],["Mkt Cap",fmtBig(profile?.marketCapitalization?profile.marketCapitalization*1e6:null)],["Industry",profile?.finnhubIndustry||"—"]].map(([l,v])=>(
                  <div key={l} style={{ background:C.card, borderRadius:8, padding:"10px 14px" }}>
                    <div style={{ color:C.sub, fontSize:11 }}>{l}</div>
                    <div style={{ color:C.text, fontSize:14, fontWeight:600, marginTop:2 }}>{v}</div>
                  </div>
                ))}
              </div>
              <div style={{ background:C.accentDim, border:`1px solid ${C.accent}33`, borderRadius:10, padding:"14px 16px", marginBottom:16 }}>
                <div style={{ color:C.accent, fontSize:11, fontWeight:700, marginBottom:8, textTransform:"uppercase", letterSpacing:"0.06em" }}>Your Position</div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
                  {[["Shares",stock.shares],["Avg Cost",fmt$(stock.avgCost)],["Market Value",fmt$(stock.shares*price)],["Gain/Loss",fmt$(stock.shares*(price-stock.avgCost))]].map(([l,v])=>(
                    <div key={l}><span style={{ color:C.sub, fontSize:11 }}>{l} </span><span style={{ color:C.text, fontWeight:600, fontSize:13 }}>{v}</span></div>
                  ))}
                </div>
              </div>
              {profile?.description && <div style={{ color:C.sub, fontSize:13, lineHeight:1.6 }}>{profile.description.slice(0,420)}{profile.description.length>420?"…":""}</div>}
            </div>
          )}

          {tab === "news" && (
            <div>
              {news.length===0 && !loading && <div style={{ color:C.sub, textAlign:"center", marginTop:40 }}>No recent news found.</div>}
              {news.map((item,i) => (
                <a key={i} href={item.url} target="_blank" rel="noreferrer" style={{ display:"block", textDecoration:"none", padding:"12px 0", borderBottom:`1px solid ${C.border}` }}>
                  <div style={{ display:"flex", gap:10, alignItems:"flex-start" }}>
                    {item.image && <img src={item.image} alt="" style={{ width:52, height:40, objectFit:"cover", borderRadius:6, flexShrink:0 }} onError={e=>e.target.style.display="none"} />}
                    <div>
                      <div style={{ color:C.text, fontSize:13, fontWeight:500, lineHeight:1.4, marginBottom:4 }}>{item.headline}</div>
                      <div style={{ color:C.sub, fontSize:11 }}>{item.source} · {timeAgo(item.datetime)}</div>
                    </div>
                  </div>
                </a>
              ))}
            </div>
          )}

          {tab === "filings" && (
            <div>
              <div style={{ color:C.sub, fontSize:12, marginBottom:12 }}>Recent SEC filings — click to view on EDGAR</div>
              {filings.length===0 && !loading && <div style={{ color:C.sub, textAlign:"center", marginTop:40 }}>No recent filings found.</div>}
              {filings.map((f,i) => {
                const color = f.type==="8-K"?C.amber:f.type==="10-K"?C.accent:C.green;
                return (
                  <a key={i} href={f.url} target="_blank" rel="noreferrer" style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 0", borderBottom:`1px solid ${C.border}`, textDecoration:"none" }}>
                    <Tag color={color}>{f.type}</Tag>
                    <div style={{ flex:1, color:C.text, fontSize:13 }}>{f.description}</div>
                    <div style={{ color:C.sub, fontSize:12, whiteSpace:"nowrap" }}>{f.date}</div>
                  </a>
                );
              })}
              <a href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${stock.ticker}&type=&dateb=&owner=include&count=40`} target="_blank" rel="noreferrer" style={{ display:"block", marginTop:16, color:C.accent, fontSize:13, textDecoration:"none" }}>View all filings on SEC EDGAR →</a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── AI ADVISOR ────────────────────────────────────────────────────────────────
function AIAdvisor({ portfolio, quotes }) {
  const [messages, setMessages] = useState([{ role:"assistant", text:"Hi! I have live data on your portfolio. Ask me anything — performance, diversification, news impact, what to buy or sell, or anything about a specific holding." }]);
  const [input,   setInput]   = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior:"smooth" }); }, [messages]);

  const send = async (overrideText) => {
    const q = (overrideText || input).trim();
    if (!q || loading) return;
    setInput("");
    setMessages(m => [...m, { role:"user", text:q }]);
    setLoading(true);

    const rows = portfolio.map(s => {
      const p = quotes[s.ticker]?.c || s.currentPrice;
      const val = s.shares * p;
      const cost = s.shares * s.avgCost;
      return `${s.ticker}: ${s.shares} shares, avg cost $${s.avgCost}, price $${p.toFixed(2)}, value $${val.toFixed(0)}, gain ${((val-cost)/cost*100).toFixed(1)}%`;
    }).join("\n");
    const total = portfolio.reduce((a,s) => a + s.shares*(quotes[s.ticker]?.c||s.currentPrice), 0);
    const cost  = portfolio.reduce((a,s) => a + s.shares*s.avgCost, 0);

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({
          model:"claude-sonnet-4-6", max_tokens:1000,
          system:`You are a sharp investment advisor inside a portfolio tracking app. Be direct, specific, and use the real numbers from the portfolio. Give clear opinions. Note briefly you're not a licensed advisor if giving personalised recommendations.

Portfolio:
${rows}
Total value: ${fmt$(total)} | Gain: ${fmt$(total-cost)} (${((total-cost)/cost*100).toFixed(1)}%)`,
          messages: messages.concat([{role:"user",text:q}]).map(m=>({role:m.role, content:m.text})),
        }),
      });
      const data = await res.json();
      setMessages(m => [...m, { role:"assistant", text: data.content?.find(b=>b.type==="text")?.text || "Sorry, try again." }]);
    } catch {
      setMessages(m => [...m, { role:"assistant", text:"Connection error. Please try again." }]);
    }
    setLoading(false);
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", minHeight:0 }}>
      <div style={{ flex:1, overflowY:"auto", padding:"14px 18px", display:"flex", flexDirection:"column", gap:10 }}>
        {messages.map((m,i) => (
          <div key={i} style={{ display:"flex", justifyContent:m.role==="user"?"flex-end":"flex-start" }}>
            <div style={{ maxWidth:"87%", padding:"10px 14px", fontSize:13.5, lineHeight:1.55, whiteSpace:"pre-wrap", color:C.text, borderRadius:m.role==="user"?"14px 14px 3px 14px":"14px 14px 14px 3px", background:m.role==="user"?C.accent:C.card, border:m.role==="assistant"?`1px solid ${C.border}`:"none" }}>{m.text}</div>
          </div>
        ))}
        {loading && <div style={{ display:"flex" }}><div style={{ padding:"10px 14px", borderRadius:"14px 14px 14px 3px", background:C.card, border:`1px solid ${C.border}`, color:C.sub, fontSize:13, display:"flex", alignItems:"center", gap:8 }}><Spinner />Analysing…</div></div>}
        <div ref={endRef} />
      </div>
      <div style={{ padding:"8px 14px", display:"flex", gap:6, flexWrap:"wrap", borderTop:`1px solid ${C.border}` }}>
        {["Analyse my portfolio","Biggest winners & losers","Am I diversified?","What should I sell?"].map(p => (
          <button key={p} onClick={() => send(p)} style={{ fontSize:11, padding:"4px 10px", borderRadius:20, border:`1px solid ${C.border}`, background:"none", color:C.sub, cursor:"pointer" }}>{p}</button>
        ))}
      </div>
      <div style={{ padding:"10px 14px", borderTop:`1px solid ${C.border}`, display:"flex", gap:8 }}>
        <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send()} placeholder="Ask about your portfolio…" style={{ flex:1, background:C.bg, border:`1px solid ${C.border}`, borderRadius:10, padding:"10px 14px", color:C.text, fontSize:14, outline:"none" }} />
        <button onClick={()=>send()} disabled={loading||!input.trim()} style={{ background:C.accent, border:"none", borderRadius:10, color:"#fff", padding:"10px 18px", cursor:"pointer", fontSize:15, opacity:!input.trim()||loading?0.4:1 }}>↑</button>
      </div>
    </div>
  );
}

// ── API KEY SETUP SCREEN ──────────────────────────────────────────────────────
function SetupScreen({ onReady }) {
  const [showKey, setShowKey] = useState(false);
  const [key, setKey]         = useState("");
  const [testing, setTesting] = useState(false);
  const [err, setErr]         = useState("");

  const tryKey = async () => {
    const k = key.trim();
    if (!k) return;
    setTesting(true); setErr("");
    try {
      const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=AAPL&token=${k}`);
      const d = await r.json();
      if (d.error) { setErr("Key rejected: " + d.error); }
      else if (d.c && d.c > 0) { FINNHUB_KEY = k; onReady(false); }
      else { setErr("Key accepted but no data — preview environment may block Finnhub. Just launch the app anyway!"); }
    } catch { setErr("Cannot reach Finnhub from this preview. Just launch the app — it works great without live prices!"); }
    setTesting(false);
  };

  return (
    <div style={{ minHeight:"100vh", background:C.bg, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"system-ui, sans-serif" }}>
      <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:16, padding:36, maxWidth:460, width:"90%" }}>
        <div style={{ fontSize:32, marginBottom:12 }}>📈</div>
        <div style={{ fontWeight:800, fontSize:24, color:C.text, marginBottom:10 }}>Vestry</div>
        <div style={{ color:C.sub, fontSize:14, lineHeight:1.7, marginBottom:28 }}>
          AI-powered portfolio tracker with SEC filings, news &amp; analysis.<br/>
          No API key needed — just launch and start tracking.
        </div>
        <button onClick={() => onReady(true)}
          style={{ width:"100%", padding:"15px 0", borderRadius:10, border:"none", background:C.accent, color:"#fff", fontWeight:800, fontSize:17, cursor:"pointer", marginBottom:14 }}>
          Launch App →
        </button>
        <button onClick={() => setShowKey(v => !v)}
          style={{ width:"100%", padding:"10px 0", borderRadius:8, border:`1px solid ${C.border}`, background:"none", color:C.sub, fontWeight:500, fontSize:13, cursor:"pointer", marginBottom: showKey ? 14 : 0 }}>
          {showKey ? "▲ Hide" : "▼ Optional: connect Finnhub for live prices"}
        </button>
        {showKey && (
          <div>
            <div style={{ color:C.sub, fontSize:12, lineHeight:1.6, marginBottom:10 }}>
              Free key at <a href="https://finnhub.io" target="_blank" rel="noreferrer" style={{ color:C.accent }}>finnhub.io</a>. Note: live data may not work in this Claude preview due to browser security — the app is fully functional either way.
            </div>
            <input value={key} onChange={e=>setKey(e.target.value)} onKeyDown={e=>e.key==="Enter"&&tryKey()}
              placeholder="Paste Finnhub API key…"
              style={{ width:"100%", background:C.bg, border:`1px solid ${C.border}`, borderRadius:8, padding:"11px 14px", color:C.text, fontSize:14, outline:"none", boxSizing:"border-box", marginBottom:8 }} autoFocus />
            {err && <div style={{ background:"rgba(244,63,94,0.08)", border:"1px solid rgba(244,63,94,0.25)", borderRadius:8, padding:"10px 12px", marginBottom:10, color:C.red, fontSize:12 }}>{err}</div>}
            <button onClick={tryKey} disabled={!key.trim()||testing}
              style={{ width:"100%", padding:"10px 0", borderRadius:8, border:"none", background:C.accent, color:"#fff", fontWeight:700, fontSize:14, cursor:"pointer", opacity:key.trim()&&!testing?1:0.4, display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
              {testing ? <><Spinner size={13}/> Testing…</> : "Connect Live Prices"}
            </button>
          </div>
        )}
        <div style={{ marginTop:20, color:C.muted, fontSize:11, textAlign:"center" }}>
          AI advisor · SEC filings · Portfolio tracking — all work without a key
        </div>
      </div>
    </div>
  );
}

// ── MAIN APP ──────────────────────────────────────────────────────────────────
const DEMO = [
  { id:1, ticker:"AAPL", name:"Apple Inc.",      shares:10, avgCost:145.20, currentPrice:189.50, change:0 },
  { id:2, ticker:"MSFT", name:"Microsoft Corp.", shares:5,  avgCost:280.00, currentPrice:415.20, change:0 },
  { id:3, ticker:"NVDA", name:"NVIDIA Corp.",    shares:8,  avgCost:450.00, currentPrice:875.30, change:0 },
  { id:4, ticker:"GOOGL",name:"Alphabet Inc.",   shares:3,  avgCost:120.00, currentPrice:175.80, change:0 },
];


function EditModal({ stock, onSave, onDelete, onClose }) {
  const [name, setName] = useState(stock.name);
  const [shares, setShares] = useState(String(stock.shares));
  const [avgCost, setAvgCost] = useState(String(stock.avgCost));
  const inp = { background:"#080a0f", border:"1px solid #1e2335", borderRadius:8, padding:"10px 12px", color:"#e2e8f5", fontSize:14, outline:"none", width:"100%", boxSizing:"border-box" };
  const save = () => {
    if (!shares || parseFloat(shares) <= 0) return;
    onSave({ ...stock, name: name.trim() || stock.ticker, shares: parseFloat(shares), avgCost: parseFloat(avgCost) || stock.avgCost });
    onClose();
  };
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.78)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:400 }} onClick={onClose}>
      <div style={{ background:"#141720", border:"1px solid #1e2335", borderRadius:16, padding:28, width:380, boxShadow:"0 24px 60px rgba(0,0,0,0.7)" }} onClick={e=>e.stopPropagation()}>
        <div style={{ fontWeight:800, fontSize:17, color:"#e2e8f5", marginBottom:4 }}>Edit {stock.ticker}</div>
        <div style={{ color:"#7c87a0", fontSize:12, marginBottom:20 }}>Update your holding details</div>
        <div style={{ display:"flex", flexDirection:"column", gap:12, marginBottom:20 }}>
          <div><div style={{ color:"#7c87a0", fontSize:12, marginBottom:6 }}>Company Name</div><input value={name} onChange={e=>setName(e.target.value)} style={inp} /></div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            <div><div style={{ color:"#7c87a0", fontSize:12, marginBottom:6 }}>Shares</div><input value={shares} onChange={e=>setShares(e.target.value)} style={inp} type="number" min="0.001" step="any" /></div>
            <div><div style={{ color:"#7c87a0", fontSize:12, marginBottom:6 }}>Avg Cost ($)</div><input value={avgCost} onChange={e=>setAvgCost(e.target.value)} style={inp} type="number" min="0" step="any" /></div>
          </div>
        </div>
        <div style={{ display:"flex", gap:10 }}>
          <button onClick={()=>{onDelete(stock.id);onClose();}} style={{ padding:"10px 14px", borderRadius:8, border:"1px solid rgba(244,63,94,0.3)", background:"none", color:"#f43f5e", cursor:"pointer", fontSize:13, fontWeight:600 }}>Delete</button>
          <button onClick={onClose} style={{ flex:1, padding:"10px 0", borderRadius:8, border:"1px solid #1e2335", background:"none", color:"#7c87a0", cursor:"pointer", fontSize:14 }}>Cancel</button>
          <button onClick={save} style={{ flex:2, padding:"10px 0", borderRadius:8, border:"none", background:"#4f8eff", color:"#fff", cursor:"pointer", fontWeight:700, fontSize:14 }}>Save Changes</button>
        </div>
      </div>
    </div>
  );
}



const FUNDS100 = [
  {rank:1,name:"Bridgewater Associates",manager:"Ray Dalio",country:"USA",aum:124,strategy:"Global Macro",ret:8.2,founded:1975,desc:"World's largest hedge fund. Famous for its All Weather and Pure Alpha strategies, built on Ray Dalio's economic machine principles."},
  {rank:2,name:"Man Group",manager:"Robyn Grew",country:"UK",aum:72,strategy:"Multi-Strategy",ret:11.4,founded:1783,desc:"Oldest and one of the largest publicly traded hedge fund companies, combining quantitative and discretionary investing across asset classes."},
  {rank:3,name:"Renaissance Technologies",manager:"Peter Brown",country:"USA",aum:57,strategy:"Quantitative",ret:31.5,founded:1982,desc:"Legendary quant fund. Its Medallion Fund is considered the most successful hedge fund in history, averaging 66% gross annual returns."},
  {rank:4,name:"Millennium Management",manager:"Israel Englander",country:"USA",aum:55,strategy:"Multi-Strategy",ret:13.1,founded:1989,desc:"Runs hundreds of independent trading teams across equities, fixed income, commodities and currencies simultaneously."},
  {rank:5,name:"Citadel",manager:"Ken Griffin",country:"USA",aum:53,strategy:"Multi-Strategy",ret:15.3,founded:1990,desc:"One of the most successful multi-strategy funds ever, generating over $73 billion in net gains for investors since inception."},
  {rank:6,name:"D.E. Shaw & Co.",manager:"David Shaw",country:"USA",aum:50,strategy:"Quantitative",ret:12.8,founded:1988,desc:"Pioneer in computational finance and algorithmic trading, blending mathematics, computer science and finance at scale."},
  {rank:7,name:"Two Sigma Investments",manager:"John Overdeck",country:"USA",aum:46,strategy:"Quantitative",ret:10.9,founded:2001,desc:"Uses machine learning and distributed computing to find signals in massive datasets for fully systematic trading strategies."},
  {rank:8,name:"Farallon Capital",manager:"Thomas Steyer",country:"USA",aum:39,strategy:"Multi-Strategy",ret:9.7,founded:1986,desc:"Multi-strategy fund investing in equities, credit, real estate and direct investments globally with a fundamental approach."},
  {rank:9,name:"Davidson Kempner Capital",manager:"Thomas Kempner Jr.",country:"USA",aum:37,strategy:"Event Driven",ret:11.2,founded:1983,desc:"Focuses on distressed debt, merger arbitrage and special situations across global markets with a long track record."},
  {rank:10,name:"Elliott Management",manager:"Paul Singer",country:"USA",aum:34,strategy:"Event Driven",ret:12.3,founded:1977,desc:"One of the most prominent activist hedge funds, known for aggressive corporate and sovereign debt campaigns globally."},
  {rank:11,name:"Baupost Group",manager:"Seth Klarman",country:"USA",aum:32,strategy:"Value",ret:10.1,founded:1982,desc:"Disciplined value investor focused on margin of safety. Known for holding large cash reserves when opportunities are scarce."},
  {rank:12,name:"Marshall Wace",manager:"Paul Marshall",country:"UK",aum:31,strategy:"Long/Short Equity",ret:13.5,founded:1997,desc:"European quant and discretionary L/S equity fund, known for its TOPS platform that aggregates broker trade ideas."},
  {rank:13,name:"Soros Fund Management",manager:"George Soros",country:"USA",aum:30,strategy:"Global Macro",ret:11.6,founded:1969,desc:"Family office of legendary macro investor George Soros, who famously broke the Bank of England in 1992 making $1B in a day."},
  {rank:14,name:"Tiger Global Management",manager:"Chase Coleman",country:"USA",aum:35,strategy:"Long/Short Equity",ret:14.6,founded:2001,desc:"Growth-oriented fund focused on technology companies in both public and private markets globally."},
  {rank:15,name:"Pershing Square Capital",manager:"Bill Ackman",country:"USA",aum:20,strategy:"Activist",ret:16.2,founded:2004,desc:"Concentrated activist fund known for high-profile campaigns at Chipotle, Hilton, Universal Music and Fannie Mae."},
  {rank:16,name:"Third Point",manager:"Dan Loeb",country:"USA",aum:14,strategy:"Activist",ret:13.9,founded:1995,desc:"Event-driven activist fund known for sharply worded letters to management and transformative corporate campaigns."},
  {rank:17,name:"Appaloosa Management",manager:"David Tepper",country:"USA",aum:13,strategy:"Event Driven",ret:14.8,founded:1993,desc:"Distressed debt and equities specialist. David Tepper is one of the highest-earning hedge fund managers in history."},
  {rank:18,name:"Coatue Management",manager:"Philippe Laffont",country:"USA",aum:28,strategy:"Long/Short Equity",ret:14.1,founded:1999,desc:"Technology-focused L/S equity fund with major positions in public and private tech companies worldwide."},
  {rank:19,name:"Viking Global Investors",manager:"Andreas Halvorsen",country:"USA",aum:26,strategy:"Long/Short Equity",ret:13.3,founded:1999,desc:"Fundamental L/S equity fund with a long-term investment horizon, run by former Tiger Management alumni."},
  {rank:20,name:"AQR Capital Management",manager:"Cliff Asness",country:"USA",aum:19,strategy:"Quantitative",ret:9.4,founded:1998,desc:"Combines academic research with systematic trading across value, momentum and alternative risk premia factors."},
  {rank:21,name:"Lone Pine Capital",manager:"Steve Mandel",country:"USA",aum:18,strategy:"Long/Short Equity",ret:13.7,founded:1997,desc:"Fundamental long/short equity fund with concentrated global portfolio, a classic Tiger Cub fund."},
  {rank:22,name:"Greenlight Capital",manager:"David Einhorn",country:"USA",aum:2,strategy:"Long/Short Equity",ret:10.4,founded:1996,desc:"Value-oriented L/S fund famous for shorting Lehman Brothers before its 2008 collapse."},
  {rank:23,name:"Point72 Asset Management",manager:"Steve Cohen",country:"USA",aum:27,strategy:"Multi-Strategy",ret:12.6,founded:2014,desc:"Converted from SAC Capital. Runs discretionary and quant strategies across global equity and macro markets."},
  {rank:24,name:"Paulson & Co.",manager:"John Paulson",country:"USA",aum:3,strategy:"Event Driven",ret:8.9,founded:1994,desc:"Made $15B shorting subprime mortgages in 2007 — one of the greatest trades in hedge fund history."},
  {rank:25,name:"Brevan Howard",manager:"Alan Howard",country:"UK",aum:35,strategy:"Global Macro",ret:12.1,founded:2002,desc:"Leading global macro fund focused on fixed income and currency markets with a rigorous risk management culture."},
  {rank:26,name:"Winton Group",manager:"David Harding",country:"UK",aum:7,strategy:"Quantitative",ret:8.6,founded:1997,desc:"Systematic CTA using statistical methods and scientific research to trade diversified futures markets globally."},
  {rank:27,name:"BlueCrest Capital",manager:"Michael Platt",country:"UK",aum:15,strategy:"Multi-Strategy",ret:13.8,founded:2000,desc:"Returned outside capital in 2015. Now a private firm running a mix of macro and systematic strategies for principals only."},
  {rank:28,name:"Lansdowne Partners",manager:"Peter Davies",country:"UK",aum:10,strategy:"Long/Short Equity",ret:9.8,founded:1998,desc:"Fundamental European L/S equity fund known for deep research, concentrated positions and long holding periods."},
  {rank:29,name:"Capula Investment Management",manager:"Yan Huo",country:"UK",aum:20,strategy:"Fixed Income",ret:10.2,founded:2005,desc:"One of Europe's largest fixed income and macro hedge funds, specializing in relative value and tail risk strategies."},
  {rank:30,name:"Greenoaks Capital",manager:"Neil Mehta",country:"USA",aum:9,strategy:"Long/Short Equity",ret:22.1,founded:2012,desc:"Concentrated long-term fund focused on technology-enabled businesses with durable competitive advantages."},
  {rank:31,name:"Dragoneer Investment Group",manager:"Marc Stad",country:"USA",aum:15,strategy:"Long/Short Equity",ret:18.4,founded:2012,desc:"Growth equity fund investing in technology and consumer businesses at inflection points in both public and private markets."},
  {rank:32,name:"Durable Capital Partners",manager:"Henry Ellenbogen",country:"USA",aum:12,strategy:"Long/Short Equity",ret:17.2,founded:2019,desc:"Long-term growth investor in technology-enabled businesses, focused on compounding over a 5-10 year horizon."},
  {rank:33,name:"Whale Rock Capital",manager:"Alex Sacerdote",country:"USA",aum:10,strategy:"Long/Short Equity",ret:16.9,founded:2006,desc:"Tech-focused long/short equity fund with concentrated positions in high-growth software and internet companies."},
  {rank:34,name:"Altimeter Capital",manager:"Brad Gerstner",country:"USA",aum:8,strategy:"Long/Short Equity",ret:19.3,founded:2008,desc:"Technology investor in both public and private markets, known for deep sector expertise and long holding periods."},
  {rank:35,name:"Alkeon Capital",manager:"Panayotis Sparaggis",country:"USA",aum:16,strategy:"Long/Short Equity",ret:20.1,founded:2001,desc:"Technology-focused growth equity fund with large concentrated positions in leading technology companies globally."},
  {rank:36,name:"TCI Fund Management",manager:"Chris Hohn",country:"UK",aum:55,strategy:"Activist",ret:19.1,founded:2003,desc:"Activist hedge fund known for environmental campaigns and long-term concentrated equity positions in quality businesses."},
  {rank:37,name:"Hillhouse Capital",manager:"Zhang Lei",country:"China",aum:30,strategy:"Long/Short Equity",ret:19.7,founded:2005,desc:"Preeminent Asia-focused long-term investor with major stakes in Chinese internet and consumer companies like Tencent."},
  {rank:38,name:"Hengde Asset Management",manager:"Zhang Lei",country:"China",aum:5,strategy:"Long/Short Equity",ret:21.3,founded:2005,desc:"China's leading growth equity fund, known for early investments in Tencent, JD.com and other Chinese tech giants."},
  {rank:39,name:"GIC Private Limited",manager:"Lim Chow Kiat",country:"Singapore",aum:690,strategy:"Sovereign Wealth",ret:6.9,founded:1981,desc:"Singapore's sovereign wealth fund managing the country's foreign reserves across global asset classes and geographies."},
  {rank:40,name:"Platinum Asset Management",manager:"Kerr Neilson",country:"Australia",aum:8,strategy:"Global Equity",ret:10.8,founded:1994,desc:"Contrarian global equity fund focused on identifying undervalued securities and structural shifts in global industries."},
  {rank:41,name:"Regal Funds Management",manager:"Philip King",country:"Australia",aum:4,strategy:"Long/Short Equity",ret:16.8,founded:2004,desc:"Australian L/S equity manager with a strong track record across domestic and Asian markets."},
  {rank:42,name:"Caledonia Investments",manager:"Will Vicars",country:"Australia",aum:3,strategy:"Long/Short Equity",ret:14.2,founded:1992,desc:"Private Australian fund with long-term, concentrated positions in quality businesses across global markets."},
  {rank:43,name:"Bennelong Funds Management",manager:"John Burke",country:"Australia",aum:2,strategy:"Long/Short Equity",ret:13.7,founded:2003,desc:"Australian boutique manager with multiple equity strategies focused on domestic and Asian markets."},
  {rank:44,name:"Orbis Investments",manager:"William Gray",country:"South Africa",aum:30,strategy:"Global Equity",ret:11.3,founded:1989,desc:"Contrarian global equity manager owned by the Allan Gray group, known for long-term value creation."},
  {rank:45,name:"Qube Research & Technologies",manager:"Pierre-Yves Morlat",country:"UK",aum:14,strategy:"Quantitative",ret:15.6,founded:2014,desc:"European quant hedge fund spun out of Credit Suisse, using machine learning across global markets."},
  {rank:46,name:"ExodusPoint Capital",manager:"Michael Gelband",country:"USA",aum:13,strategy:"Multi-Strategy",ret:10.8,founded:2018,desc:"One of the largest hedge fund launches in history at $8.5B, running diversified multi-strategy across asset classes."},
  {rank:47,name:"Graham Capital Management",manager:"Ken Tropin",country:"USA",aum:18,strategy:"Global Macro",ret:11.7,founded:1994,desc:"Discretionary and systematic global macro fund with expertise across commodities, rates and currencies."},
  {rank:48,name:"Caxton Associates",manager:"Andrew Law",country:"USA",aum:11,strategy:"Global Macro",ret:10.9,founded:1983,desc:"Global macro fund founded by Bruce Kovner, one of the most successful macro traders in history."},
  {rank:49,name:"Moore Capital Management",manager:"Louis Bacon",country:"USA",aum:8,strategy:"Global Macro",ret:9.6,founded:1989,desc:"Discretionary global macro fund run by legendary trader Louis Bacon, investing across all liquid asset classes."},
  {rank:50,name:"Aspect Capital",manager:"Anthony Todd",country:"UK",aum:9,strategy:"CTA/Trend",ret:9.2,founded:1998,desc:"Systematic trend-following CTA founded by former Man AHL executives, trading diversified global futures markets."},
  {rank:51,name:"Systematica Investments",manager:"Leda Braga",country:"UK",aum:10,strategy:"CTA/Trend",ret:10.1,founded:2015,desc:"Systematic investment manager using statistical methods across trend following and alternative risk premia."},
  {rank:52,name:"Arrowstreet Capital",manager:"Peter Rathjens",country:"USA",aum:17,strategy:"Quantitative",ret:10.4,founded:1999,desc:"Quantitative global equity manager applying systematic factor models across developed and emerging markets."},
  {rank:53,name:"PDT Partners",manager:"Peter Muller",country:"USA",aum:7,strategy:"Quantitative",ret:14.2,founded:1993,desc:"Quant fund spun out of Morgan Stanley, using proprietary statistical models across equity, fixed income and derivatives."},
  {rank:54,name:"Jane Street Capital",manager:"Various Partners",country:"USA",aum:20,strategy:"Quantitative",ret:13.8,founded:2000,desc:"Leading market maker and proprietary trading firm using quantitative strategies across ETFs, equities and options."},
  {rank:55,name:"Hudson Bay Capital",manager:"Sander Gerber",country:"USA",aum:7,strategy:"Multi-Strategy",ret:11.6,founded:2005,desc:"Multi-strategy fund with expertise in merger arbitrage, convertible bonds and equity special situations."},
  {rank:56,name:"Magnetar Capital",manager:"Alec Litowitz",country:"USA",aum:15,strategy:"Multi-Strategy",ret:12.9,founded:2005,desc:"Multi-strategy fund with expertise in structured credit, merger arbitrage and energy special situations."},
  {rank:57,name:"King Street Capital",manager:"Francis Biondi",country:"USA",aum:22,strategy:"Credit",ret:11.5,founded:1995,desc:"Credit-focused hedge fund investing across the capital structure in distressed and special situations globally."},
  {rank:58,name:"Centerbridge Partners",manager:"Jeffrey Aronson",country:"USA",aum:32,strategy:"Credit",ret:12.1,founded:2005,desc:"Alternative investment firm with credit, private equity and real estate strategies focused on value creation."},
  {rank:59,name:"Oaktree Capital Management",manager:"Howard Marks",country:"USA",aum:170,strategy:"Credit",ret:10.3,founded:1995,desc:"Global alternative investment manager specializing in credit strategies across distressed, high yield and real assets."},
  {rank:60,name:"Cerberus Capital Management",manager:"Stephen Feinberg",country:"USA",aum:60,strategy:"Credit",ret:11.8,founded:1992,desc:"Alternative investment firm specializing in distressed investing, private equity and real estate globally."},
  {rank:61,name:"Ares Management",manager:"Michael Arougheti",country:"USA",aum:418,strategy:"Credit",ret:10.1,founded:1997,desc:"Global alternative investment manager with credit, private equity and real assets strategies across market cycles."},
  {rank:62,name:"Angelo Gordon",manager:"Josh Baumgarten",country:"USA",aum:73,strategy:"Credit",ret:9.8,founded:1988,desc:"Alternative investment manager specializing in credit and real estate across North America and Europe."},
  {rank:63,name:"Sculptor Capital Management",manager:"Jimmy Levin",country:"USA",aum:34,strategy:"Multi-Strategy",ret:11.0,founded:1994,desc:"Formerly Och-Ziff. Runs multi-strategy across credit, equities and real estate globally."},
  {rank:64,name:"Canyon Capital Advisors",manager:"Joshua Friedman",country:"USA",aum:24,strategy:"Credit",ret:10.6,founded:1990,desc:"Credit-oriented multi-strategy fund with a long track record in distressed debt and special situations."},
  {rank:65,name:"Anchorage Capital Group",manager:"Kevin Ulrich",country:"USA",aum:8,strategy:"Credit",ret:10.7,founded:2003,desc:"Credit-focused hedge fund specializing in distressed debt and stressed credit situations globally."},
  {rank:66,name:"Varde Partners",manager:"Ilfryn Carstairs",country:"USA",aum:15,strategy:"Credit",ret:11.7,founded:1993,desc:"Global alternative investment firm focused on credit and special situations across real estate and corporate finance."},
  {rank:67,name:"Mudrick Capital Management",manager:"Jason Mudrick",country:"USA",aum:4,strategy:"Credit",ret:13.4,founded:2009,desc:"Distressed debt and event-driven credit specialist targeting dislocated and complex credit situations."},
  {rank:68,name:"Grantham Mayo Van Otterloo",manager:"Jeremy Grantham",country:"USA",aum:61,strategy:"Value",ret:9.1,founded:1977,desc:"Asset manager known for long-term value investing and Jeremy Grantham's influential bubble-spotting research."},
  {rank:69,name:"Gabelli Funds",manager:"Mario Gabelli",country:"USA",aum:28,strategy:"Value",ret:9.2,founded:1977,desc:"Value-oriented asset manager known for merger arbitrage and undervalued asset plays across market cycles."},
  {rank:70,name:"ValueAct Capital",manager:"Mason Morfit",country:"USA",aum:16,strategy:"Activist",ret:13.7,founded:2000,desc:"Constructivist activist fund known for taking board seats and driving operational improvements at portfolio companies."},
  {rank:71,name:"Starboard Value",manager:"Jeff Smith",country:"USA",aum:7,strategy:"Activist",ret:15.8,founded:2011,desc:"Activist hedge fund with strong track record of operational improvements at underperforming companies."},
  {rank:72,name:"Corvex Management",manager:"Keith Meister",country:"USA",aum:6,strategy:"Activist",ret:14.3,founded:2011,desc:"Event-driven activist fund focused on unlocking value through constructive engagement with management teams."},
  {rank:73,name:"Jana Partners",manager:"Barry Rosenstein",country:"USA",aum:3,strategy:"Activist",ret:12.2,founded:2001,desc:"Activist fund targeting companies with potential for operational improvements and strategic alternatives."},
  {rank:74,name:"Sachem Head Capital",manager:"Scott Ferguson",country:"USA",aum:4,strategy:"Activist",ret:14.5,founded:2012,desc:"Activist hedge fund focused on complex corporate situations with operational and strategic improvement potential."},
  {rank:75,name:"Glenview Capital",manager:"Larry Robbins",country:"USA",aum:8,strategy:"Long/Short Equity",ret:12.9,founded:2000,desc:"Healthcare and consumer-focused L/S equity fund combining fundamental research with activist investing."},
  {rank:76,name:"Egerton Capital",manager:"John Armitage",country:"UK",aum:14,strategy:"Long/Short Equity",ret:12.4,founded:1994,desc:"Fundamental European and global L/S equity fund known for concentrated, high-conviction positions."},
  {rank:77,name:"Lansdowne Developed Markets",manager:"Jonathon Regis",country:"UK",aum:8,strategy:"Long/Short Equity",ret:10.2,founded:2001,desc:"European long/short equity fund with a deep fundamental research process across developed markets."},
  {rank:78,name:"LMR Partners",manager:"Ben Levine",country:"UK",aum:6,strategy:"Multi-Strategy",ret:11.8,founded:2009,desc:"Multi-strategy fund trading equities, fixed income, commodities and currencies with a quantitative overlay."},
  {rank:79,name:"CQS",manager:"Michael Hintze",country:"UK",aum:14,strategy:"Multi-Strategy",ret:11.4,founded:1999,desc:"Multi-strategy credit and convertible bond specialist with strong performance through credit cycles."},
  {rank:80,name:"Algebris Investments",manager:"Davide Serra",country:"UK",aum:10,strategy:"Credit",ret:12.6,founded:2006,desc:"Specialist in global financials equity and credit, running concentrated fundamental strategies."},
  {rank:81,name:"Cheyne Capital",manager:"Jonathan Lourie",country:"UK",aum:12,strategy:"Multi-Strategy",ret:10.9,founded:2000,desc:"Alternative investment manager with expertise in credit, real estate debt and equity special situations."},
  {rank:82,name:"Autonomy Capital",manager:"Robert Gibbins",country:"USA",aum:5,strategy:"Global Macro",ret:12.7,founded:2003,desc:"Global macro fund specializing in emerging market sovereign debt and currency trading."},
  {rank:83,name:"Ionic Capital Management",manager:"Bart Baum",country:"USA",aum:3,strategy:"Quantitative",ret:12.3,founded:2006,desc:"Convertible bond and volatility arbitrage specialist using quantitative and fundamental methods."},
  {rank:84,name:"Paloma Partners",manager:"Donald Sussman",country:"USA",aum:3,strategy:"Multi-Strategy",ret:10.8,founded:1981,desc:"Multi-strategy fund, one of the pioneers of the multi-manager model in the hedge fund industry."},
  {rank:85,name:"Caspian Capital",manager:"David Rosenberg",country:"USA",aum:5,strategy:"Credit",ret:11.2,founded:2004,desc:"Credit-focused fund specializing in distressed debt, stressed situations and capital structure arbitrage."},
  {rank:86,name:"Segantii Capital",manager:"Simon Sadler",country:"Hong Kong",aum:5,strategy:"Event Driven",ret:14.9,founded:2007,desc:"Asia-focused event driven fund specializing in equity special situations and convertible bond arbitrage."},
  {rank:87,name:"Keystone Investment",manager:"Soo Chuen Tan",country:"Singapore",aum:4,strategy:"Long/Short Equity",ret:11.9,founded:2011,desc:"Singapore-based value investor with a concentrated portfolio of carefully selected global equities."},
  {rank:88,name:"Toscafund Asset Management",manager:"Martin Hughes",country:"UK",aum:3,strategy:"Long/Short Equity",ret:10.5,founded:2000,desc:"UK-focused L/S equity fund with expertise in financials, special situations and corporate events."},
  {rank:89,name:"Dunn Capital Management",manager:"William Dunn",country:"USA",aum:2,strategy:"CTA/Trend",ret:8.4,founded:1974,desc:"One of the oldest trend-following CTAs, using purely systematic methods to trade global futures markets."},
  {rank:90,name:"Highfields Capital",manager:"Jonathon Jacobson",country:"USA",aum:3,strategy:"Long/Short Equity",ret:11.1,founded:1998,desc:"Concentrated fundamental L/S equity fund that returned outside capital to focus on the founding family's assets."},
  {rank:91,name:"First Pacific Advisors",manager:"Steven Romick",country:"USA",aum:10,strategy:"Value",ret:8.8,founded:1954,desc:"Contrarian value-oriented investment manager with a flexible mandate across equities and fixed income."},
  {rank:92,name:"Steadfast Capital",manager:"Robert Pitts",country:"USA",aum:7,strategy:"Long/Short Equity",ret:12.5,founded:2000,desc:"Fundamental global L/S equity fund with expertise across consumer, healthcare and technology sectors."},
  {rank:93,name:"Bridgepoint Capital",manager:"William Jackson",country:"UK",aum:30,strategy:"Private Equity",ret:13.2,founded:1984,desc:"European private equity firm investing in mid-market businesses across multiple sectors and geographies."},
  {rank:94,name:"Partners Group",manager:"David Layton",country:"Switzerland",aum:10,strategy:"Private Equity",ret:12.4,founded:1996,desc:"Swiss alternative asset manager with a broad private markets platform across equity, debt and real assets."},
  {rank:95,name:"Greenwood Investors",manager:"Steven Wood",country:"USA",aum:1,strategy:"Value",ret:13.6,founded:2012,desc:"European and global value-oriented L/S equity fund with a deep fundamental research process."},
  {rank:96,name:"Blackpine Fund Management",manager:"Andrew Wong",country:"Hong Kong",aum:2,strategy:"Long/Short Equity",ret:13.1,founded:2008,desc:"Asia-focused long/short equity fund with expertise in Chinese consumer and technology sectors."},
  {rank:97,name:"Adelphi Capital",manager:"John Moody",country:"UK",aum:2,strategy:"Long/Short Equity",ret:11.3,founded:2005,desc:"European fundamental L/S equity fund with a focus on quality businesses at reasonable valuations."},
  {rank:98,name:"Crispin Odey Asset Management",manager:"James Hanbury",country:"UK",aum:3,strategy:"Long/Short Equity",ret:9.1,founded:1991,desc:"European L/S equity fund with contrarian macro views, known for bold directional bets across asset classes."},
  {rank:99,name:"Janus Henderson Investors",manager:"Ali Dibadj",country:"UK",aum:11,strategy:"Long/Short Equity",ret:9.1,founded:1969,desc:"Global asset manager with hedge fund strategies across equities and fixed income markets worldwide."},
  {rank:100,name:"Pershing Square Tontine",manager:"Bill Ackman",country:"USA",aum:4,strategy:"Activist",ret:11.8,founded:2020,desc:"Special purpose vehicle and follow-on funds managed by Bill Ackman targeting transformative acquisitions."},
];


function HedgeFunds() {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("rank");
  const [sel, setSel] = useState(null);
  const [filter, setFilter] = useState("All");
  const C = { bg:"#0d0f14", surface:"#13161e", card:"#1a1e28", border:"#1e2335", text:"#e8ecf4", sub:"#7c87a0", green:"#10b981", red:"#ef4444", accent:"#6366f1" };
  const sc = s => ({"Global Macro":"#f59e0b","Quantitative":"#3b82f6","Multi-Strategy":"#8b5cf6","Long/Short Equity":"#10b981","Activist":"#ef4444","Event Driven":"#f97316","Credit":"#06b6d4","Value":"#84cc16","CTA/Trend":"#ec4899","Fixed Income":"#14b8a6","Global Equity":"#22d3ee","Sovereign Wealth":"#a78bfa","Private Equity":"#fb923c","Real Estate":"#4ade80"}[s]||"#7c87a0");
  const strategies = ["All",...Array.from(new Set(FUNDS100.map(f=>f.strategy))).sort()];
  const filtered = FUNDS100.filter(f=>(filter==="All"||f.strategy===filter)&&(f.name+f.manager+f.country+f.strategy).toLowerCase().includes(search.toLowerCase())).sort((a,b)=>sortBy==="aum"?b.aum-a.aum:sortBy==="return"?b.ret-a.ret:sortBy==="founded"?a.founded-b.founded:a.rank-b.rank);
  const totalAUM = FUNDS100.reduce((s,f)=>s+f.aum,0);
  const avgRet = (FUNDS100.reduce((s,f)=>s+f.ret,0)/FUNDS100.length).toFixed(1);
  return (
    <div style={{padding:"0 0 40px"}}>
      {sel&&<div onClick={()=>setSel(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}}>
        <div onClick={e=>e.stopPropagation()} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:18,padding:30,width:520,maxWidth:"90vw",boxShadow:"0 25px 60px rgba(0,0,0,0.6)"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20}}>
            <div><div style={{fontWeight:800,fontSize:20,color:C.text,marginBottom:4}}>{sel.name}</div><div style={{color:C.sub,fontSize:13}}>#{sel.rank} · Founded {sel.founded}</div></div>
            <button onClick={()=>setSel(null)} style={{background:"none",border:`1px solid ${C.border}`,borderRadius:8,color:C.sub,cursor:"pointer",fontSize:18,padding:"2px 10px"}}>✕</button>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:20}}>
            {[["AUM",`$${sel.aum}B`,C.text],["Avg Return",`+${sel.ret}%`,C.green],["Country",sel.country,C.text]].map(([l,v,col])=>(
              <div key={l} style={{background:C.surface,borderRadius:10,padding:"12px 14px",border:`1px solid ${C.border}`}}>
                <div style={{color:C.sub,fontSize:11,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:4}}>{l}</div>
                <div style={{fontWeight:700,fontSize:16,color:col}}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{marginBottom:14}}><div style={{color:C.sub,fontSize:11,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6}}>Manager</div><div style={{color:C.text,fontWeight:600,fontSize:15}}>{sel.manager}</div></div>
          <div style={{marginBottom:14}}><div style={{color:C.sub,fontSize:11,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6}}>Strategy</div><span style={{fontSize:12,fontWeight:700,padding:"3px 10px",borderRadius:6,background:sc(sel.strategy)+"22",color:sc(sel.strategy)}}>{sel.strategy}</span></div>
          <div><div style={{color:C.sub,fontSize:11,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6}}>About</div><div style={{color:C.text,fontSize:13,lineHeight:1.6}}>{sel.desc}</div></div>
        </div>
      </div>}
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:20}}>
        {[["Funds Tracked","100","Global rankings"],["Total AUM",`$${(totalAUM/1000).toFixed(1)}T`,"Combined assets"],["Avg Annual Return",`${avgRet}%`,"Across all funds"]].map(([l,v,s])=>(
          <div key={l} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:14,padding:"16px 20px"}}>
            <div style={{color:C.sub,fontSize:11,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6}}>{l}</div>
            <div style={{fontWeight:800,fontSize:22,color:C.text}}>{v}</div>
            <div style={{color:C.sub,fontSize:12,marginTop:2}}>{s}</div>
          </div>
        ))}
      </div>
      <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:14,padding:20,marginBottom:16}}>
        <div style={{display:"flex",gap:12,marginBottom:14,flexWrap:"wrap"}}>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search fund, manager, country or strategy…" style={{flex:1,minWidth:200,background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 14px",color:C.text,fontSize:13,outline:"none"}}/>
          <select value={sortBy} onChange={e=>setSortBy(e.target.value)} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,color:C.text,padding:"10px 12px",fontSize:13,cursor:"pointer"}}>
            <option value="rank">Sort: Rank</option><option value="aum">Sort: AUM ↓</option><option value="return">Sort: Return ↓</option><option value="founded">Sort: Oldest first</option>
          </select>
        </div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {strategies.map(s=><button key={s} onClick={()=>setFilter(s)} style={{padding:"4px 12px",borderRadius:20,border:"none",cursor:"pointer",fontSize:12,fontWeight:600,background:filter===s?(s==="All"?C.accent:sc(s)):C.card,color:filter===s?"#fff":C.sub}}>{s}</button>)}
        </div>
      </div>
      <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:14,overflow:"hidden"}}>
        <div style={{display:"grid",gridTemplateColumns:"50px 2fr 110px 160px 90px 110px 100px",padding:"10px 20px",color:C.sub,fontSize:11,textTransform:"uppercase",letterSpacing:"0.06em",borderBottom:`1px solid ${C.border}`}}>
          {["#","Fund / Manager","Country","Strategy","AUM","Return","Founded"].map((h,i)=><span key={i} style={{textAlign:i>1?"right":"left"}}>{h}</span>)}
        </div>
        {filtered.length===0&&<div style={{padding:"40px 20px",textAlign:"center",color:C.sub}}>No funds match your search.</div>}
        {filtered.map(fund=>(
          <div key={fund.rank} onClick={()=>setSel(fund)} style={{display:"grid",gridTemplateColumns:"50px 2fr 110px 160px 90px 110px 100px",padding:"13px 20px",borderBottom:`1px solid ${C.border}`,cursor:"pointer",alignItems:"center",transition:"background 0.1s"}} onMouseEnter={e=>e.currentTarget.style.background=C.card} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
            <div style={{color:C.sub,fontWeight:700,fontSize:12}}>#{fund.rank}</div>
            <div><div style={{fontWeight:700,fontSize:13,color:C.text}}>{fund.name}</div><div style={{color:C.sub,fontSize:11,marginTop:2}}>{fund.manager}</div></div>
            <div style={{textAlign:"right",color:C.text,fontSize:12}}>{fund.country}</div>
            <div style={{textAlign:"right"}}><span style={{fontSize:11,fontWeight:700,padding:"2px 8px",borderRadius:5,background:sc(fund.strategy)+"22",color:sc(fund.strategy)}}>{fund.strategy}</span></div>
            <div style={{textAlign:"right",fontWeight:700,color:C.text,fontSize:13}}>${fund.aum}B</div>
            <div style={{textAlign:"right",fontWeight:700,color:C.green,fontSize:13}}>+{fund.ret}%</div>
            <div style={{textAlign:"right",color:C.sub,fontSize:12}}>{fund.founded}</div>
          </div>
        ))}
      </div>
      <div style={{color:C.sub,fontSize:11,textAlign:"center",marginTop:12}}>Showing {filtered.length} of 100 funds · Click any row for full details</div>
    </div>
  );
}

export default function App() {
  const [ready,     setReady]     = useState(FINNHUB_KEY !== "YOUR_FINNHUB_KEY");
  const [noLive,    setNoLive]    = useState(false);
  const [portfolio, setPortfolio] = useState(() => { try { const s = localStorage.getItem("vestry_portfolio"); return s ? JSON.parse(s) : DEMO; } catch { return DEMO; } });
  const [quotes,    setQuotes]    = useState({});
  useEffect(() => { localStorage.setItem("vestry_portfolio", JSON.stringify(portfolio)); }, [portfolio]);
  const [detail,    setDetail]    = useState(null);
  const [showAdd,   setShowAdd]   = useState(false);
  const [editStock, setEditStock] = useState(null);
  const [tab,       setTab]       = useState("portfolio");
  const [refreshing,setRefreshing]= useState(false);

  const refreshQuotes = useCallback(async () => {
    if (portfolio.length === 0) return;
    setRefreshing(true);
    const res = {};
    await Promise.all(portfolio.map(async s => { try { res[s.ticker] = await getQuote(s.ticker); } catch {} }));
    setQuotes(res);
    setRefreshing(false);
  }, [portfolio]);

  useEffect(() => { if (ready) refreshQuotes(); }, [ready, portfolio.length]);

  if (!ready) return <SetupScreen onReady={(skip) => { setNoLive(skip); setReady(true); }} />;

  const lp = s => quotes[s.ticker]?.c  || s.currentPrice;
  const lc = s => quotes[s.ticker]?.dp || s.change;

  const totalValue = portfolio.reduce((a,s) => a + s.shares*lp(s), 0);
  const totalCost  = portfolio.reduce((a,s) => a + s.shares*s.avgCost, 0);
  const totalGain  = totalValue - totalCost;
  const todayPnl   = portfolio.reduce((a,s) => a + s.shares*lp(s)*(lc(s)/100), 0);
  const HUES = ["#4f8eff","#10b981","#f59e0b","#f43f5e","#a855f7","#06b6d4","#ec4899","#14b8a6"];

  return (
    <div style={{ minHeight:"100vh", background:C.bg, fontFamily:"'Inter', system-ui, sans-serif", color:C.text }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}*{box-sizing:border-box}a:hover{opacity:0.85}`}</style>

      {editStock && <EditModal stock={editStock} onSave={updated=>setPortfolio(p=>p.map(x=>x.id===updated.id?updated:x))} onDelete={id=>setPortfolio(p=>p.filter(x=>x.id!==id))} onClose={()=>setEditStock(null)} />}
      {showAdd && <AddStockModal onAdd={s => setPortfolio(p=>[...p,s])} onClose={()=>setShowAdd(false)} />}
      {detail   && <StockDetailPanel stock={detail} onClose={()=>setDetail(null)} />}

      {/* Nav */}
      <div style={{ borderBottom:`1px solid ${C.border}`, padding:"0 28px", display:"flex", alignItems:"center", justifyContent:"space-between", height:56 }}>
        <div style={{ display:"flex", alignItems:"center", gap:28 }}>
          <div style={{ fontWeight:900, fontSize:18, letterSpacing:"-0.5px" }}><span style={{ color:C.accent }}>V</span>estry</div>
          {["portfolio","hedgefunds","watchlist","crypto","advisor"].map(t => (
            <button key={t} onClick={()=>setTab(t)} style={{ background:"none", border:"none", color:tab===t?C.text:C.sub, fontWeight:tab===t?700:400, fontSize:14, cursor:"pointer", padding:"0 4px", textTransform:"capitalize" }}>{t==="advisor"?"AI Advisor":t==="hedgefunds"?"Hedge Funds":t==="watchlist"?"Watchlist":t==="crypto"?"Crypto":"Portfolio"}</button>
          ))}
        </div>
        <div style={{ display:"flex", gap:10 }}>
          <button onClick={refreshQuotes} disabled={refreshing} style={{ background:"none", border:`1px solid ${C.border}`, borderRadius:8, color:C.sub, padding:"6px 14px", cursor:"pointer", fontSize:13, display:"flex", alignItems:"center", gap:6 }}>
            {refreshing ? <Spinner size={12}/> : "⟳"} Refresh
          </button>
          <button onClick={()=>setShowAdd(true)} style={{ background:C.accent, border:"none", borderRadius:8, color:"#fff", padding:"7px 16px", cursor:"pointer", fontWeight:700, fontSize:13 }}>+ Add Stock</button>
        </div>
      </div>

      <div style={{ maxWidth:1140, margin:"0 auto", padding:"28px 24px" }}>
        {tab === "portfolio" && <>
          {/* Summary */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:14, marginBottom:28 }}>
            <StatBox label="Portfolio Value" value={fmt$(totalValue)} />
            <StatBox label="Total Gain/Loss"  value={fmt$(totalGain)}  sub={fmtPct(totalGain/totalCost*100)} up={totalGain>=0} />
            <StatBox label="Today's P&L"      value={fmt$(todayPnl)}   up={todayPnl>=0} />
            <StatBox label="Positions"        value={portfolio.length} />
          </div>

          {/* Holdings table */}
          <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:14, overflow:"hidden", marginBottom:20 }}>
            <div style={{ padding:"14px 20px", borderBottom:`1px solid ${C.border}`, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span style={{ fontWeight:700, fontSize:15 }}>Holdings</span>
              <span style={{ color:C.sub, fontSize:12 }}>Click any row for details, news &amp; filings</span>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1.8fr 1fr 1fr 0.7fr 1fr 1fr 1.2fr 70px", gap:"0 8px", padding:"8px 20px", color:C.sub, fontSize:11, textTransform:"uppercase", letterSpacing:"0.06em" }}>
              {["Stock","Price","Avg Cost","Shares","Value","Today","Gain/Loss",""].map((h,i)=><span key={i} style={{ textAlign:"right" }}>{h}</span>)}
            </div>
            {portfolio.length === 0
              ? <div style={{ padding:"40px 20px", textAlign:"center", color:C.sub }}>No holdings yet — add your first stock above.</div>
              : portfolio.map(s => {
                const price = lp(s); const chg = lc(s);
                const val   = s.shares * price;
                const gain  = val - s.shares * s.avgCost;
                const gainP = gain / (s.shares * s.avgCost) * 100;
                const todayN = s.shares * price * chg / 100;
                return (
                  <div key={s.id} onClick={()=>setDetail(s)}
                    style={{ display:"grid", gridTemplateColumns:"1.8fr 1fr 1fr 0.7fr 1fr 1fr 1.2fr 70px", gap:"0 8px", padding:"13px 20px", borderBottom:`1px solid ${C.border}`, cursor:"pointer", alignItems:"center", transition:"background 0.1s" }}
                    onMouseEnter={e=>e.currentTarget.style.background=C.card}
                    onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    <div style={{ textAlign:"right" }}><div style={{ fontWeight:700, fontSize:14 }}>{s.ticker}</div><div style={{ color:C.sub, fontSize:11 }}>{s.name}</div></div>
                    <div style={{ textAlign:"right", fontWeight:600 }}>{fmt$(price)}</div>
                    <div style={{ textAlign:"right", color:C.sub }}>{fmt$(s.avgCost)}</div>
                    <div style={{ textAlign:"right", color:C.sub }}>{s.shares}</div>
                    <div style={{ textAlign:"right" }}>{fmt$(val)}</div>
                    <div style={{ textAlign:"right", color:chg>=0?C.green:C.red, fontWeight:600 }}>{fmtPct(chg)}<br/><span style={{ fontSize:11, fontWeight:400 }}>{fmt$(todayN)}</span></div>
                    <div style={{ textAlign:"right" }}>
                      <div style={{ color:gain>=0?C.green:C.red, fontWeight:600 }}>{fmt$(gain)}</div>
                      <div style={{ color:gain>=0?C.green:C.red, fontSize:11 }}>{fmtPct(gainP)}</div>
                    </div>
                    <div style={{ display:"flex", gap:4 }}>
                      <button onClick={e=>{e.stopPropagation();setEditStock(s);}} style={{ background:"none", border:"1px solid #1e2335", borderRadius:6, color:"#7c87a0", cursor:"pointer", fontSize:12, padding:"4px 8px" }}>✎</button>
                      <button onClick={e=>{e.stopPropagation();setPortfolio(p=>p.filter(x=>x.id!==s.id));}} style={{ background:"none", border:"1px solid #1e2335", borderRadius:6, color:"#7c87a0", cursor:"pointer", fontSize:12, padding:"4px 8px" }}>✕</button>
                    </div>
                  </div>
                );
              })
            }
          </div>

          {/* Allocation */}
          {portfolio.length > 0 && (
            <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:14, padding:"18px 22px" }}>
              <div style={{ color:C.sub, fontSize:11, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:12 }}>Allocation</div>
              <div style={{ display:"flex", borderRadius:6, overflow:"hidden", height:8, marginBottom:14 }}>
                {portfolio.map((s,i) => <div key={s.id} style={{ width:`${s.shares*lp(s)/totalValue*100}%`, background:HUES[i%HUES.length] }} title={s.ticker} />)}
              </div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:"8px 20px" }}>
                {portfolio.map((s,i) => (
                  <div key={s.id} style={{ display:"flex", alignItems:"center", gap:6, fontSize:13 }}>
                    <div style={{ width:8, height:8, borderRadius:2, background:HUES[i%HUES.length] }} />
                    <span>{s.ticker}</span>
                    <span style={{ color:C.sub }}>{(s.shares*lp(s)/totalValue*100).toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>}

        {tab === "hedgefunds" && <HedgeFunds />}

        {tab === "watchlist" && <Watchlist />}

        {tab === "crypto" && <Crypto />}
        {tab === "advisor" && (
          <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:14, height:640, display:"flex", flexDirection:"column", overflow:"hidden", boxShadow:`0 0 60px ${C.accentDim}` }}>
            <div style={{ padding:"16px 20px", borderBottom:`1px solid ${C.border}`, display:"flex", alignItems:"center", gap:8 }}>
              <div style={{ width:8, height:8, borderRadius:"50%", background:C.green, boxShadow:`0 0 8px ${C.green}` }} />
              <span style={{ fontWeight:700 }}>AI Advisor</span>
              <span style={{ color:C.sub, fontSize:12, marginLeft:4 }}>— Claude, live portfolio data</span>
            </div>
            <AIAdvisor portfolio={portfolio} quotes={quotes} />
          </div>
        )}
      </div>
    </div>
  );
}

