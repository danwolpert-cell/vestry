import { useState, useEffect, useRef } from "react";

export default function Analytics({ holdings }) {
  const C = { bg:"#0d0f14", surface:"#13161e", card:"#1a1e28", border:"#1e2335", text:"#e8ecf4", sub:"#7c87a0", green:"#10b981", red:"#ef4444", accent:"#6366f1" };
  const [prices, setPrices] = useState({});
  const [dividends, setDividends] = useState(() => { try { return JSON.parse(localStorage.getItem("vestry_dividends") || "{}"); } catch { return {}; } });
  const [showAddDiv, setShowAddDiv] = useState(false);
  const [divTicker, setDivTicker] = useState("");
  const [divAmount, setDivAmount] = useState("");
  const [divDate, setDivDate] = useState("");
  const canvasRef = useRef(null);

  useEffect(() => { localStorage.setItem("vestry_dividends", JSON.stringify(dividends)); }, [dividends]);

  useEffect(() => {
    if (!holdings?.length) return;
    const load = async () => {
      const res = {};
      await Promise.all(holdings.map(async h => {
        try {
          const r = await fetch("/api/stock-price?ticker=" + h.ticker);
          const d = await r.json();
          if (d.c) res[h.ticker] = d;
        } catch {}
      }));
      setPrices(res);
    };
    load();
  }, [holdings]);

  const getValue = (h) => {
    const p = prices[h.ticker];
    if (!p) return 0;
    return p.c * h.shares;
  };

  const totalValue = holdings?.reduce((sum, h) => sum + getValue(h), 0) || 0;
  const totalCost = holdings?.reduce((sum, h) => sum + (h.avgCost * h.shares), 0) || 0;
  const totalGain = totalValue - totalCost;
  const totalGainPct = totalCost > 0 ? ((totalGain / totalCost) * 100).toFixed(2) : 0;

  const totalDividends = Object.values(dividends).flat().reduce((sum, d) => sum + (parseFloat(d.amount) || 0), 0);

  // Draw pie chart
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !holdings?.length) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    const cx = W / 2, cy = H / 2, r = Math.min(W, H) / 2 - 40;
    ctx.clearRect(0, 0, W, H);

    const slices = holdings.map(h => ({ ticker: h.ticker, value: getValue(h) })).filter(s => s.value > 0);
    const total = slices.reduce((s, x) => s + x.value, 0);
    if (!total) return;

    const colors = ["#6366f1","#10b981","#f59e0b","#ef4444","#3b82f6","#8b5cf6","#ec4899","#14b8a6","#f97316","#06b6d4"];
    let angle = -Math.PI / 2;

    slices.forEach((s, i) => {
      const slice = (s.value / total) * 2 * Math.PI;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, angle, angle + slice);
      ctx.closePath();
      ctx.fillStyle = colors[i % colors.length];
      ctx.fill();
      ctx.strokeStyle = "#0d0f14";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Label
      const mid = angle + slice / 2;
      const lx = cx + (r * 0.65) * Math.cos(mid);
      const ly = cy + (r * 0.65) * Math.sin(mid);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 11px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      if (slice > 0.15) ctx.fillText(s.ticker, lx, ly);
      angle += slice;
    });
  }, [prices, holdings]);

  const addDividend = () => {
    if (!divTicker || !divAmount) return;
    const updated = { ...dividends, [divTicker]: [...(dividends[divTicker] || []), { amount: parseFloat(divAmount), date: divDate, ticker: divTicker }] };
    setDividends(updated);
    setShowAddDiv(false); setDivTicker(""); setDivAmount(""); setDivDate("");
  };

  const isUp = totalGain >= 0;

  return (
    <div style={{padding:"0 0 40px"}}>
      <div style={{fontWeight:800,fontSize:20,color:C.text,marginBottom:4}}>Analytics</div>
      <div style={{color:C.sub,fontSize:13,marginBottom:24}}>Portfolio performance, dividends and allocation</div>

      {/* Summary Cards */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:12,marginBottom:24}}>
        {[
          ["Total Value", "$" + totalValue.toFixed(2)],
          ["Total Cost", "$" + totalCost.toFixed(2)],
          ["Total Gain/Loss", (isUp?"+":"") + "$" + Math.abs(totalGain).toFixed(2) + " (" + (isUp?"+":"") + totalGainPct + "%)"],
          ["Total Dividends", "$" + totalDividends.toFixed(2)]
        ].map(([l, v], i) => (
          <div key={l} style={{background:C.surface,border:"1px solid "+C.border,borderRadius:14,padding:"16px 20px"}}>
            <div style={{color:C.sub,fontSize:11,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:6}}>{l}</div>
            <div style={{fontWeight:800,fontSize:18,color:i===2?(isUp?C.green:C.red):C.text}}>{v}</div>
          </div>
        ))}
      </div>

      {/* Holdings Breakdown */}
      <div style={{background:C.surface,border:"1px solid "+C.border,borderRadius:14,overflow:"hidden",marginBottom:24}}>
        <div style={{padding:"14px 16px",borderBottom:"1px solid "+C.border,fontWeight:700,fontSize:13,color:C.text}}>Holdings Breakdown</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr 1fr",padding:"8px 16px",color:C.sub,fontSize:11,textTransform:"uppercase",borderBottom:"1px solid "+C.border}}>
          {["Stock","Price","Value","Gain/Loss","Weight"].map((h,i)=><span key={i} style={{textAlign:i>0?"right":"left"}}>{h}</span>)}
        </div>
        {holdings?.map(h => {
          const p = prices[h.ticker];
          const val = getValue(h);
          const cost = h.avgCost * h.shares;
          const gain = val - cost;
          const gainPct = cost > 0 ? ((gain/cost)*100).toFixed(2) : 0;
          const weight = totalValue > 0 ? ((val/totalValue)*100).toFixed(1) : 0;
          const up = gain >= 0;
          return (
            <div key={h.ticker} style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr 1fr",padding:"12px 16px",borderBottom:"1px solid "+C.border,alignItems:"center"}}>
              <div><div style={{fontWeight:700,fontSize:13,color:C.text}}>{h.ticker}</div><div style={{color:C.sub,fontSize:11}}>{h.ticker.endsWith(".AX")?"AUD":"USD"}</div></div>
              <div style={{textAlign:"right",color:C.text,fontWeight:600}}>{p?.c?"$"+p.c.toFixed(2):"--"}</div>
              <div style={{textAlign:"right",color:C.text,fontWeight:600}}>{val?"$"+val.toFixed(2):"--"}</div>
              <div style={{textAlign:"right",color:up?C.green:C.red,fontWeight:600}}>{gain?(up?"+":"")+"$"+Math.abs(gain).toFixed(2)+" ("+(up?"+":"")+gainPct+"%)":"--"}</div>
              <div style={{textAlign:"right",color:C.sub}}>{weight}%</div>
            </div>
          );
        })}
      </div>

      {/* Dividends */}
      <div style={{background:C.surface,border:"1px solid "+C.border,borderRadius:14,overflow:"hidden",marginBottom:24}}>
        <div style={{padding:"14px 16px",borderBottom:"1px solid "+C.border,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{fontWeight:700,fontSize:13,color:C.text}}>Dividend Tracker</div>
          <button onClick={()=>setShowAddDiv(true)} style={{background:C.accent,border:"none",borderRadius:8,color:"#fff",fontWeight:700,fontSize:11,padding:"5px 12px",cursor:"pointer"}}>+ Add Dividend</button>
        </div>
        {showAddDiv && (
          <div style={{padding:16,borderBottom:"1px solid "+C.border,display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
            <select value={divTicker} onChange={e=>setDivTicker(e.target.value)} style={{background:C.card,border:"1px solid "+C.border,borderRadius:8,color:C.text,padding:"8px 12px",fontSize:13}}>
              <option value="">Select stock...</option>
              {holdings?.map(h=><option key={h.ticker} value={h.ticker}>{h.ticker}</option>)}
            </select>
            <input value={divAmount} onChange={e=>setDivAmount(e.target.value)} placeholder="Amount $" style={{background:C.card,border:"1px solid "+C.border,borderRadius:8,color:C.text,padding:"8px 12px",fontSize:13,width:120}} />
            <input type="date" value={divDate} onChange={e=>setDivDate(e.target.value)} style={{background:C.card,border:"1px solid "+C.border,borderRadius:8,color:C.text,padding:"8px 12px",fontSize:13}} />
            <button onClick={addDividend} style={{background:C.accent,border:"none",borderRadius:8,color:"#fff",fontWeight:700,fontSize:13,padding:"8px 16px",cursor:"pointer"}}>Add</button>
            <button onClick={()=>setShowAddDiv(false)} style={{background:"none",border:"1px solid "+C.border,borderRadius:8,color:C.sub,fontWeight:600,fontSize:13,padding:"8px 16px",cursor:"pointer"}}>Cancel</button>
          </div>
        )}
        {Object.values(dividends).flat().length === 0 && <div style={{padding:"30px 16px",textAlign:"center",color:C.sub,fontSize:13}}>No dividends recorded yet</div>}
        {Object.values(dividends).flat().sort((a,b)=>new Date(b.date)-new Date(a.date)).map((d,i)=>(
          <div key={i} style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr auto",padding:"12px 16px",borderBottom:"1px solid "+C.border,alignItems:"center"}}>
            <div style={{fontWeight:600,fontSize:13,color:C.text}}>{d.ticker}</div>
            <div style={{textAlign:"right",color:C.green,fontWeight:700}}>${parseFloat(d.amount).toFixed(2)}</div>
            <div style={{textAlign:"right",color:C.sub,fontSize:12}}>{d.date || "No date"}</div>
            <button onClick={()=>{const u={...dividends};u[d.ticker]=(u[d.ticker]||[]).filter((_,j)=>j!==i);setDividends(u);}} style={{background:"none",border:"none",color:C.sub,cursor:"pointer",fontSize:14,padding:"2px 8px"}}>✕</button>
          </div>
        ))}
        {Object.values(dividends).flat().length > 0 && (
          <div style={{padding:"12px 16px",display:"flex",justifyContent:"flex-end"}}>
            <div style={{color:C.sub,fontSize:13}}>Total: <span style={{color:C.green,fontWeight:700}}>${totalDividends.toFixed(2)}</span></div>
          </div>
        )}
      </div>

      {/* Pie Chart */}
      <div style={{background:C.surface,border:"1px solid "+C.border,borderRadius:14,padding:24}}>
        <div style={{fontWeight:700,fontSize:13,color:C.text,marginBottom:16}}>Portfolio Allocation</div>
        <div style={{display:"flex",gap:32,alignItems:"center",flexWrap:"wrap"}}>
          <canvas ref={canvasRef} width={300} height={300} />
          <div style={{flex:1}}>
            {holdings?.map((h,i)=>{
              const colors=["#6366f1","#10b981","#f59e0b","#ef4444","#3b82f6","#8b5cf6","#ec4899","#14b8a6","#f97316","#06b6d4"];
              const val=getValue(h);
              const weight=totalValue>0?((val/totalValue)*100).toFixed(1):0;
              return(
                <div key={h.ticker} style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                  <div style={{width:12,height:12,borderRadius:3,background:colors[i%colors.length],flexShrink:0}}/>
                  <div style={{color:C.text,fontSize:13,fontWeight:600,flex:1}}>{h.ticker}</div>
                  <div style={{color:C.sub,fontSize:12}}>{weight}%</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
