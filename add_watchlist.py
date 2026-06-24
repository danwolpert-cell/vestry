import os, re

APP = os.path.expanduser("~/vestry/src/App.jsx")
f = open(APP); c = f.read(); f.close()

c = re.sub(r'\nfunction Watchlist\(\)[\s\S]*?(?=\nexport default|\nfunction [A-Z])', '', c)

if '"watchlist"' not in c:
    c = c.replace('["portfolio","hedgefunds","advisor"]', '["portfolio","hedgefunds","watchlist","advisor"]')
    c = c.replace('t==="advisor"?"AI Advisor":t==="hedgefunds"?"Hedge Funds":"Portfolio"', 't==="advisor"?"AI Advisor":t==="hedgefunds"?"Hedge Funds":t==="watchlist"?"Watchlist":"Portfolio"')

if 'tab === "watchlist"' not in c:
    c = c.replace('{tab === "hedgefunds" && <HedgeFunds />}', '{tab === "hedgefunds" && <HedgeFunds />}\n\n        {tab === "watchlist" && <Watchlist />}')

open(APP, "w").write(c)
print("DONE -", len(c), "chars")
