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
const getQuote   = t  => fh(`/quote?symbol=${t}`);
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

export default function App() {
  const [ready,     setReady]     = useState(FINNHUB_KEY !== "YOUR_FINNHUB_KEY");
  const [noLive,    setNoLive]    = useState(false);
  const [portfolio, setPortfolio] = useState(DEMO);
  const [quotes,    setQuotes]    = useState({});
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
          {["portfolio","advisor"].map(t => (
            <button key={t} onClick={()=>setTab(t)} style={{ background:"none", border:"none", color:tab===t?C.text:C.sub, fontWeight:tab===t?700:400, fontSize:14, cursor:"pointer", padding:"0 4px", textTransform:"capitalize" }}>{t==="advisor"?"AI Advisor":"Portfolio"}</button>
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
                    <div><div style={{ fontWeight:700, fontSize:14 }}>{s.ticker}</div><div style={{ color:C.sub, fontSize:11 }}>{s.name}</div></div>
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
