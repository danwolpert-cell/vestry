import { useState, useEffect } from "react";

export default function Crypto() {
  const [coins, setCoins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("rank");
  const C = { surface:"#13161e", card:"#1a1e28", border:"#1e2335", text:"#e8ecf4", sub:"#7c87a0", green:"#10b981", red:"#ef4444", accent:"#6366f1" };

  useEffect(() => {
    fetch("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false&price_change_percentage=24h,7d")
      .then(r => r.json())
      .then(d => { setCoins(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const fmt = n => !n ? "--" : n >= 1e12 ? "$"+(n/1e12).toFixed(2)+"T" : n >= 1e9 ? "$"+(n/1e9).toFixed(2)+"B" : n >= 1e6 ? "$"+(n/1e6).toFixed(2)+"M" : "$"+n.toFixed(2);
  const fmtP = n => !n && n !== 0 ? "--" : n >= 1 ? "$"+n.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}) : "$"+n.toPrecision(4);

  const filtered = coins
    .filter(c => c.name.toLowerCase().includes(search.toLowerCase()) || c.symbol.toLowerCase().includes(search.toLowerCase()))
    .sort((a,b) => sortBy==="rank" ? a.market_cap_rank-b.market_cap_rank : sortBy==="price" ? b.current_price-a.current_price : sortBy==="change" ? b.price_change_percentage_24h-a.price_change_percentage_24h : b.total_volume-a.total_volume);

  return (
    <div style={{paddingBottom:40}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:12}}>
        <div>
          <div style={{fontWeight:800,fontSize:20,color:C.text}}>Top 100 Cryptocurrencies</div>
          <div style={{color:C.sub,fontSize:13,marginTop:2}}>Live prices via CoinGecko</div>
        </div>
        <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search crypto..." style={{background:C.surface,border:"1px solid "+C.border,borderRadius:10,padding:"8px 14px",color:C.text,fontSize:13,outline:"none",width:180}} />
          <select value={sortBy} onChange={e=>setSortBy(e.target.value)} style={{background:C.surface,border:"1px solid "+C.border,borderRadius:10,padding:"8px 14px",color:C.text,fontSize:13,outline:"none"}}>
            <option value="rank">Sort: Rank</option>
            <option value="price">Sort: Price</option>
            <option value="change">Sort: 24h Change</option>
            <option value="volume">Sort: Volume</option>
          </select>
        </div>
      </div>

      {loading && <div style={{textAlign:"center",color:C.sub,padding:60,fontSize:14}}>Loading top 100 cryptocurrencies...</div>}

      {!loading && (
        <div style={{background:C.surface,border:"1px solid "+C.border,borderRadius:14,overflow:"hidden"}}>
          <div style={{display:"grid",gridTemplateColumns:"40px 2fr 1fr 1fr 1fr 1fr 1fr 1fr",padding:"10px 16px",color:C.sub,fontSize:11,textTransform:"uppercase",letterSpacing:"0.06em",borderBottom:"1px solid "+C.border}}>
            {["#","Name","Price","24h %","7d %","Market Cap","Volume 24h","ATH"].map((h,i)=>(
              <span key={i} style={{textAlign:i>1?"right":"left"}}>{h}</span>
            ))}
          </div>
          {filtered.map(coin => {
            const c24 = coin.price_change_percentage_24h;
            const c7d = coin.price_change_percentage_7d_in_currency;
            return (
              <div key={coin.id} style={{display:"grid",gridTemplateColumns:"40px 2fr 1fr 1fr 1fr 1fr 1fr 1fr",padding:"12px 16px",borderBottom:"1px solid "+C.border,alignItems:"center"}}>
                <div style={{color:C.sub,fontSize:12}}>{coin.market_cap_rank}</div>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <img src={coin.image} alt={coin.symbol} style={{width:28,height:28,borderRadius:"50%"}} />
                  <div>
                    <div style={{fontWeight:700,fontSize:13,color:C.text}}>{coin.name}</div>
                    <div style={{color:C.sub,fontSize:11,textTransform:"uppercase"}}>{coin.symbol}</div>
                  </div>
                </div>
                <div style={{textAlign:"right",fontWeight:700,color:C.text,fontSize:13}}>{fmtP(coin.current_price)}</div>
                <div style={{textAlign:"right",fontWeight:600,fontSize:13,color:c24==null?C.sub:c24>=0?C.green:C.red}}>{c24!=null?(c24>=0?"+":"")+c24.toFixed(2)+"%":"--"}</div>
                <div style={{textAlign:"right",fontWeight:600,fontSize:13,color:c7d==null?C.sub:c7d>=0?C.green:C.red}}>{c7d!=null?(c7d>=0?"+":"")+c7d.toFixed(2)+"%":"--"}</div>
                <div style={{textAlign:"right",color:C.sub,fontSize:12}}>{fmt(coin.market_cap)}</div>
                <div style={{textAlign:"right",color:C.sub,fontSize:12}}>{fmt(coin.total_volume)}</div>
                <div style={{textAlign:"right",color:C.sub,fontSize:12}}>{fmtP(coin.ath)}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
