/**
 * Active gameplay slice re-export. `scripts/new-game.sh --family <code>`
 * rewrites this line to the chosen family and prunes the other slice dirs;
 * the template default is the arena (family A) reference slice.
 *
 * `ART_GROUPS` travels with the scene: it tells `PreloadScene` which
 * `art/manifest.json` groups this game actually loads.
 */
export { GameScene, ART_GROUPS } from '../slices/arena/game';
