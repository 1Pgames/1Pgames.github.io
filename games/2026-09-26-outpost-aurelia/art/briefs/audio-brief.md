# Outpost Aurelia: audio brief (game-art Step 1d)

Source: `art/style.json` (`aurelia-retro-nasa`), PRD §1, §2, §12, §13. Log of what was generated: `art/briefs/sfx-elevenlabs/prompts.md`.

## Identity

- **Mood** (from `artStyle` + `lighting`): 1970s mission-control calm under a low warm dusk key light. The colony is sleek painted hardware in cream and sodium amber. Aurelia is cool violet, nacre and glassy chitin. The sound is quiet competence that tightens as the light fails. Nothing is gritty or distorted-for-effect; even threats sound polished and slightly alien.
- **Timbre from materials and temperature.** Colony events are warm and analog: Moog/Prophet-style saws and triangles, Rhodes, brass latches, pneumatic hiss, servo chimes and teletype clicks. Aurelia and the fauna are cool and glassy: crystalline resonance, wet chitin, papery wings, deep bellows. Threats get rust (distorted metal, dents, power-down whines). Rewards get brass and bells.
- **Tempo** (PRD §2 sol pacing): menu is calm (~80 BPM feel, no drums). Day is ambient at ~90 BPM with no percussion. Night is tension at ~110 BPM, with percussion and brighter arps. The score crossfades at dusk and dawn. Big beats (`dusk`, `alpha`, `launch`) duck the score by −6 dB.

## Music (one paragraph per track)

- **menu** (hub calm): slow, evolving warm analog pads in A minor, with distant glassy Rhodes chimes and soft sub swells. It sounds like a NASA documentary over a violet dusk. No drums, even level, seamless loop.
- **game-low** (day): 90 BPM, A minor i–VI–III–VII. A soft Moog bass pulse on the beat, a mellow detuned pad and a sparse quarter-note arp. Hopeful but restrained. No percussion.
- **game-high** (night / Chorus): same key, tempo grid and bar length as game-low so the intensity crossfade can land on any bar. Denser 16th arps, a brighter filter, an off-beat percussion tick and a tritone ostinato for alphas (`setMusicLayer('boss')`).

Status: the ElevenLabs key lacks `music_generation`, so no stems were generated. `core/music.ts` synthesises all three moods from this brief: menu at intensity 0.12 ≈ 83 BPM; day at 0.25 ≈ 89 BPM with perc off; night at 0.7 ≈ 109 BPM with perc on.

## Shared SFX prompt suffix

`; 1970s retro sci-fi colony game sound effect, dry and close, crisp transient, no music, no voice, no reverb tail`

Beats whose sound is a tail (pads, sirens, bellows, organ, launch) drop `crisp transient, no reverb tail`. The per-voice suffix is logged in `prompts.md`.

## Voices (one line per PRD §12 event)

| voice | event | sound |
|---|---|---|
| place | building placed | heavy metal module clunking onto gravel, pneumatic hiss |
| build | building completes | bright retro servo chime with a soft latch |
| upgrade | Mk upgrade | rising analog synth whoosh ending in a warm bell |
| demolish | demolish | metal panels collapsing into dust |
| deny | invalid tap | soft low double buzz from a vintage console |
| drone | drone delivery | tiny electric chirp of a delivery drone |
| ship | order shipped | shuttle thrusters igniting and fading upward |
| dawn | dawn | warm analog synth pad swelling like sunrise |
| lander | lander arrivals (signature, 3 options) | retro rocket descent with a landing-gear thump |
| dusk | dusk telegraph (signature, 3 options, ducks) | distant colony siren rising over wind |
| night | nightfall | cold wind gust with a metallic creak |
| draft | draft open | three teletype clicks and a soft tone |
| pick | directive picked | stamp press on paper, brass click |
| evolve | protocol evolution | ascending choir chord through tape delay |
| pulse | pulse turret fire | short laser zap with a warm analog tail |
| arc | arc turret fire | electric arc snapping between copper rods |
| flak | flak fire | hollow mortar thump then glass shrapnel |
| hit | fauna hit | wet crunch into glassy chitin |
| die | fauna death | small insect shriek cut off by a crack |
| hurt | building damaged | metal plate denting under claws |
| wreck | building destroyed | structure collapsing with electrical pops |
| brownout | relay dark | power-down whine and a heavy relay clack |
| leech | leech latch | wet suction with an electric buzz |
| moth | moths inbound | papery wings fluttering around a lamp |
| alpha | alpha arrives (ducks) | deep alien bellow echoing across a basin |
| overdrive | core overdrive | turbine spinning up to a strained roar |
| relic | relic claimed | crystal resonance with a data-chirp arpeggio |
| loss | colonist death | single low cello note fading |
| charge | Beacon trigger | rising organ drone with pulsing electricity |
| launch | Beacon launch (signature, 3 options, ducks) | massive light-beam eruption and a triumphant brass swell |
| fail | Landing lost | colony lights clicking off one by one in wind |

Template voices the shared UI still fires, re-voiced to the same identity: `ui` (chunky console push button), `tap` (toggle-switch tick), `pickup` (ore canister into a brass hopper), `combo` (two rising glassy synth blips), `levelup` (analog fanfare arpeggio with a warm bell) and `whoosh` (sliding hatch air). `jump` is never fired and has no sample.
