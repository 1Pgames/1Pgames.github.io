# icons-v3 brief (ArtIcons3)

Sheet `icons-v3-cards`, 4x4 on 1024x1024 magenta, 96 px cells, read target 48 px.
Inputs on every call: `art/refs/vision-1.png` (palette/lighting/finish) + accepted
`art/briefs/v2-icons/raw/icons-kit/provider-raw.jpg` (icon rendering: chunky hand-drawn,
thick near-black outline). No red/green rims; gold only on treasure, dusk-violet for magic.

| frame | id | subject | silhouette note |
|---|---|---|---|
| 0 | icon-card-stat_might | clenched skeletal fist | diagonal bone mass |
| 1 | icon-card-stat_haste | bone hourglass, violet sand | tall rectangle |
| 2 | icon-card-stat_area | ash cloud ring around ember | round, open centre |
| 3 | icon-card-stat_crit | broken dagger, amber glint | thin diagonal |
| 4 | icon-card-stat_vital | stitched hide heart | heart |
| 5 | icon-card-stat_swift | skeletal foot + violet streaks | diagonal, streaks |
| 6 | icon-card-stat_greed | grasping hand + gold shards | splayed hand |
| 7 | icon-card-fx_lastgasp | skull exhaling violet breath | round skull |
| 8 | icon-card-fill_bread | scored stale loaf (distinct from icons-v2 cb_bread bandaged loaf) | long oval |
| 9 | icon-card-fill_purse | leather purse spilling coins | sack on coin pile |
| 10 | icon-branch-body | stitched ribcage with heart | ribs |
| 11 | icon-branch-greed | gilt coin on shard pile | disc on mound |
| 12 | icon-branch-escape | stone arch filled with violet portal | arch |
| 13 | icon-branch-ascension | winged horned-crown skull, violet up-arrow | wide wings |
| 14 | icon-branch-root | rope-bound oath scroll with bone clasp (Hauler's Oath) | slab |
| 15 | icon-sanctum-keystone | carved keystone, violet sigil | tombstone |

Attempts: 1 rejected (gradient/glow bg, pink holes in ash ring & lantern, bread read as a rock);
2 accepted base (flat bg); 3 edit asked to replace only r4c2 plain crown (it duplicated
`icon-uniq-u_dreadcrown`) — provider drew the new crest in r3c2 instead; `compose-cells.py`
copies that cell into r4c2. Reproduce: `sh art/briefs/v3-icons/rebuild.sh` from repo root.
