#!/bin/bash
# usage: ae_proc.sh <raw> <asset-id> <duration> [extra flags...]
set -e
P=~/.omp/plugins/node_modules/oh-my-pi-sprite-forge/skills/sprite-forge/scripts
G=/Users/tmwh/homework/1Pgames/games/2026-08-29-duskhaul
RAW=$1; ID=$2; DUR=$3; shift 3
OUT=$G/public/assets/generated/enemies-v2/$ID
bun $P/process-sprite.ts --input "$RAW" --output "$OUT" --rows 2 --cols 2 --cell-size 256 \
  --align feet --scale preserve --sampling nearest --duration "$DUR" --strict --preserve-raw \
  --source-provider xai "$@" >/tmp/ae_proc_last.json 2>&1 || true
python3 - "$OUT" <<'EOF'
import json,sys,os
d=sys.argv[1]
f=os.path.join(d,'sprite-metadata.json'); ff=os.path.join(d,'sprite-metadata.failed.json')
if os.path.exists(ff): 
    m=json.load(open(ff)); print('FAILED',os.path.basename(d),m['qc'].get('failures'),m['qc'].get('retryHints',[])[:2])
m=json.load(open(f)) if os.path.exists(f) else None
if m:
    q=m['qc'];s=q['summary'];o=m['output']
    print(os.path.basename(d),'passed',q['passed'],'fail',q['failures'],'cv %.4f ay %.4f bs %.3f h %s'%(s['bodyScaleCv'],s['anchorYStd'],s['bodyScaleMean'],s['outputSubjectHeightMean']),'prof',o.get('profileApplied'),'post',q.get('postureChange'),'notes',q.get('notes'))
EOF
tail -3 /tmp/ae_proc_last.json | cut -c1-400
