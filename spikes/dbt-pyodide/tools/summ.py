import sys, json
txt = sys.stdin.read(); j = json.loads(txt[:txt.rindex('}') + 1])
print('type', j['type'], 'wall', j['wallMs'], 'ms; bytes', j['bytesSentMB'], 'MB; error', (j.get('error') or '')[:400])
print(j.get('timings'))
for r in j.get('results') or []:
    if r['cmd'].lstrip('!').startswith(('build', 'parse', 'run --select fct_order_items fct')):
        print('   ', r['cmd'][:50], r['ok'], r['ms'], 'ms')
