/**
 * Generic card deck for deckbuilders: draw/discard/exhaust piles, a seeded
 * shuffle, auto-reshuffle-from-discard on empty draw, and an energy tracker
 * for "how many cards can I play this turn".
 *
 * Invariant: every card is in exactly one zone (draw XOR discard XOR exhaust
 * XOR "in hand", tracked by the caller) at all times — `draw`/`play`/`exhaust`
 * only ever move a card between zones, never duplicate or drop one. `counts()`
 * exists so callers/tests can assert that invariant without reaching into
 * private state.
 *
 * Pure TypeScript, no Phaser import. Shuffling uses the injected `Rng`
 * (never `Math.random`) so a run seed reproduces the exact same draws.
 *
 * Use for: any deckbuilder or card-driven roguelike's card pool (attack/skill
 * decks, loot decks, event decks).
 * Do NOT use for: a hand of cards with no shuffle/discard mechanic (a plain
 * array is simpler) or physical tabletop rules (multiple simultaneous decks
 * with shared discard) — compose several `Deck` instances for that instead.
 */

import type { Rng } from './rng';

export interface DeckCard {
  id: string;
}

export interface EnergyTracker {
  max: number;
  current: number;
  refill(): void;
}

export interface DeckCounts {
  draw: number;
  discard: number;
  exhaust: number;
}

function makeEnergyTracker(max: number): EnergyTracker {
  return {
    max,
    current: max,
    refill(): void {
      this.current = this.max;
    },
  };
}

/**
 * One shuffled draw pile plus discard/exhaust piles for cards of type `TCard`
 * (only `id` is required — decks are otherwise data-agnostic, so the caller's
 * own card definitions pass straight through unmodified).
 */
export class Deck<TCard extends DeckCard> {
  readonly energy: EnergyTracker;

  private drawPile: TCard[] = [];
  private discardPile: TCard[] = [];
  private exhaustPile: TCard[] = [];
  private readonly rng: Rng;

  constructor(cards: readonly TCard[], rng: Rng, energyMax = 3) {
    this.rng = rng;
    this.drawPile = this.rng.shuffle([...cards]);
    this.energy = makeEnergyTracker(energyMax);
  }

  /**
   * Draws up to `n` cards, reshuffling the discard pile into the draw pile
   * (freshly shuffled) whenever the draw pile runs out mid-draw. Returns
   * fewer than `n` cards only once both piles are exhausted of drawable cards
   * (everything left is in `exhaust` or already in the caller's hand).
   */
  draw(n: number): TCard[] {
    const drawn: TCard[] = [];
    for (let i = 0; i < n; i += 1) {
      if (this.drawPile.length === 0) {
        if (this.discardPile.length === 0) break;
        this.drawPile = this.rng.shuffle(this.discardPile);
        this.discardPile = [];
      }
      const card = this.drawPile.pop();
      if (card === undefined) break;
      drawn.push(card);
    }
    return drawn;
  }

  /** Moves a card (already out of the deck, e.g. from the caller's hand) to the discard pile. */
  play(card: TCard): void {
    this.discardPile.push(card);
  }

  /** Moves a card to the exhaust pile — removed from play for the rest of the encounter. */
  exhaust(card: TCard): void {
    this.exhaustPile.push(card);
  }

  /** Read-only zone counts, for save/debug/invariant checks. */
  counts(): DeckCounts {
    return { draw: this.drawPile.length, discard: this.discardPile.length, exhaust: this.exhaustPile.length };
  }
}
