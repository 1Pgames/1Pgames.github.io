// run: node --import ./scripts/ts-resolve.mjs src/sim/kits/deck.selftest.ts
import assert from 'node:assert/strict';
import { Deck } from '../../core/deck';
import { Rng } from '../../core/rng';

interface Card {
  id: string;
}

function makeCards(n: number): Card[] {
  const cards: Card[] = [];
  for (let i = 0; i < n; i += 1) cards.push({ id: `c${i}` });
  return cards;
}

// --- Zone conservation across 200 seeded draw/play/exhaust operations ---
{
  const cards = makeCards(12);
  const deck = new Deck(cards, new Rng(42), 3);
  const hand: Card[] = [];
  const exhausted: Card[] = [];
  const rng = new Rng(7); // separate rng drives the test's own op choices

  for (let i = 0; i < 200; i += 1) {
    const counts = deck.counts();
    assert.equal(
      counts.draw + counts.discard + counts.exhaust + hand.length,
      cards.length,
      `zone conservation violated at op ${i}`,
    );

    const roll = rng.next();
    if (roll < 0.4) {
      const drawn = deck.draw(2);
      hand.push(...drawn);
    } else if (roll < 0.75 && hand.length > 0) {
      const card = hand.pop()!;
      deck.play(card);
    } else if (hand.length > 0) {
      const card = hand.pop()!;
      deck.exhaust(card);
      exhausted.push(card);
    }
  }

  const finalCounts = deck.counts();
  assert.equal(
    finalCounts.draw + finalCounts.discard + finalCounts.exhaust + hand.length,
    cards.length,
    'zone conservation violated at end',
  );
  assert.equal(finalCounts.exhaust, exhausted.length, 'exhaust pile matches every exhausted card');
}

// --- Deterministic shuffle: identical seed produces an identical draw order ---
{
  const cardsA = makeCards(20);
  const cardsB = makeCards(20);
  const deckA = new Deck(cardsA, new Rng('daily-seed'), 3);
  const deckB = new Deck(cardsB, new Rng('daily-seed'), 3);

  const drawnA = deckA.draw(20).map((c) => c.id);
  const drawnB = deckB.draw(20).map((c) => c.id);
  assert.deepEqual(drawnA, drawnB, 'same seed must produce the same shuffle/draw order');

  const deckC = new Deck(makeCards(20), new Rng('different-seed'), 3);
  const drawnC = deckC.draw(20).map((c) => c.id);
  assert.notDeepEqual(drawnA, drawnC, 'a different seed should (overwhelmingly likely) differ');
}

// --- Auto-reshuffle from discard when the draw pile runs dry ---
{
  const cards = makeCards(5);
  const deck = new Deck(cards, new Rng(1), 3);

  const firstDraw = deck.draw(5);
  assert.equal(firstDraw.length, 5, 'drew the whole deck');
  assert.equal(deck.counts().draw, 0);

  for (const card of firstDraw) deck.play(card);
  assert.equal(deck.counts().discard, 5);
  assert.equal(deck.counts().draw, 0);

  // Draw pile is empty but discard has cards: draw() must reshuffle discard -> draw.
  const secondDraw = deck.draw(5);
  assert.equal(secondDraw.length, 5, 'reshuffled the discard pile back into a full draw');
  assert.equal(deck.counts().discard, 0);
  assert.equal(deck.counts().draw, 0);

  // Requesting more than exist anywhere returns only what's available.
  for (const card of secondDraw) deck.exhaust(card);
  const thirdDraw = deck.draw(5);
  assert.equal(thirdDraw.length, 0, 'nothing left to draw once every card is exhausted');
}

// --- Energy tracker refill resets to max regardless of current ---
{
  const energyDeck = new Deck(makeCards(3), new Rng(1), 4);
  assert.equal(energyDeck.energy.current, 4);
  energyDeck.energy.current = 1;
  energyDeck.energy.refill();
  assert.equal(energyDeck.energy.current, 4);
}

console.log('deck.selftest: ok');
