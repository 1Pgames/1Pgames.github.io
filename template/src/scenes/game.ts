/**
 * Active gameplay slice re-export. `scripts/new-game.sh --family <code>`
 * rewrites this line to the chosen family and prunes the other slice dirs;
 * the template default is the arena (family A) reference slice.
 */
export { GameScene } from '../slices/arena/game';
