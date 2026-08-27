import type { Rng } from '../core/rng';

/**
 * Original general-knowledge bank for the family H (trivia quiz) slice: 60
 * questions, 15 per category, 5 per difficulty tier inside each category.
 *
 * Rules for anyone extending it:
 *  - questions are written for this template, never lifted from a quiz product;
 *  - `question` stays under 90 characters so it fits the portrait panel in
 *    three lines at 34px;
 *  - exactly 4 options, all distinct, exactly one defensibly correct — a
 *    "second nearly-right option" is a bug, not a hard question;
 *  - the correct answer is authored FIRST (`answerIndex: 0`) so a reviewer can
 *    fact-check the bank by reading one column; `drawQuiz` shuffles the option
 *    order per draw, so the position is never a tell in play;
 *  - `difficulty` 1..3 drives the ramp in `drawQuiz`, not the score alone.
 *
 * `src/sim/kits/trivia.selftest.ts` enforces every one of those invariants.
 */

export type TriviaCategory = 'science' | 'geography' | 'wordplay' | 'logic';

export interface TriviaQuestion {
  id: string;
  category: TriviaCategory;
  /** Prompt, <= 90 characters. */
  question: string;
  /** Exactly 4 distinct answers. */
  options: readonly string[];
  /** Index into `options` of the single correct answer. */
  answerIndex: number;
  /** 1 = warm-up, 2 = standard, 3 = the closing stretch. */
  difficulty: 1 | 2 | 3;
}

export const TRIVIA: readonly TriviaQuestion[] = [
  // --- science ---------------------------------------------------------------
  {
    id: 'sci-01',
    category: 'science',
    question: 'Which gas do plants take from the air to build sugars?',
    options: ['Carbon dioxide', 'Oxygen', 'Nitrogen', 'Helium'],
    answerIndex: 0,
    difficulty: 1,
  },
  {
    id: 'sci-02',
    category: 'science',
    question: 'How many legs does an adult insect have?',
    options: ['Six', 'Four', 'Eight', 'Ten'],
    answerIndex: 0,
    difficulty: 1,
  },
  {
    id: 'sci-03',
    category: 'science',
    question: 'Which planet orbits closest to the Sun?',
    options: ['Mercury', 'Venus', 'Mars', 'Earth'],
    answerIndex: 0,
    difficulty: 1,
  },
  {
    id: 'sci-04',
    category: 'science',
    question: 'At sea level, water boils at how many degrees Celsius?',
    options: ['100', '80', '90', '120'],
    answerIndex: 0,
    difficulty: 1,
  },
  {
    id: 'sci-05',
    category: 'science',
    question: 'Which organ pumps blood around the human body?',
    options: ['The heart', 'The liver', 'A lung', 'A kidney'],
    answerIndex: 0,
    difficulty: 1,
  },
  {
    id: 'sci-06',
    category: 'science',
    question: 'What is the chemical symbol for potassium?',
    options: ['K', 'P', 'Pt', 'Po'],
    answerIndex: 0,
    difficulty: 2,
  },
  {
    id: 'sci-07',
    category: 'science',
    question: 'Which blood cells carry oxygen to your tissues?',
    options: ['Red cells', 'White cells', 'Platelets', 'Stem cells'],
    answerIndex: 0,
    difficulty: 2,
  },
  {
    id: 'sci-08',
    category: 'science',
    question: 'How many bones are in a typical adult human skeleton?',
    options: ['206', '176', '242', '300'],
    answerIndex: 0,
    difficulty: 2,
  },
  {
    id: 'sci-09',
    category: 'science',
    question: 'Which force holds the planets in orbit around the Sun?',
    options: ['Gravity', 'Magnetism', 'Friction', 'Tension'],
    answerIndex: 0,
    difficulty: 2,
  },
  {
    id: 'sci-10',
    category: 'science',
    question: "Which gas makes up about 78% of Earth's atmosphere?",
    options: ['Nitrogen', 'Oxygen', 'Argon', 'Carbon dioxide'],
    answerIndex: 0,
    difficulty: 2,
  },
  {
    id: 'sci-11',
    category: 'science',
    question: 'Which particle inside an atom carries no electric charge?',
    options: ['Neutron', 'Proton', 'Electron', 'Positron'],
    answerIndex: 0,
    difficulty: 3,
  },
  {
    id: 'sci-12',
    category: 'science',
    question: 'Roughly how long does sunlight take to reach Earth?',
    options: ['8 minutes', '8 seconds', '8 hours', '1 minute'],
    answerIndex: 0,
    difficulty: 3,
  },
  {
    id: 'sci-13',
    category: 'science',
    question: 'What is the SI unit of electrical resistance?',
    options: ['Ohm', 'Volt', 'Watt', 'Ampere'],
    answerIndex: 0,
    difficulty: 3,
  },
  {
    id: 'sci-14',
    category: 'science',
    question: 'Which of these metals is liquid at room temperature?',
    options: ['Mercury', 'Lead', 'Aluminium', 'Tin'],
    answerIndex: 0,
    difficulty: 3,
  },
  {
    id: 'sci-15',
    category: 'science',
    question: 'In the name DNA, what does the letter A stand for?',
    options: ['Acid', 'Adenine', 'Amine', 'Alkali'],
    answerIndex: 0,
    difficulty: 3,
  },

  // --- geography -------------------------------------------------------------
  {
    id: 'geo-01',
    category: 'geography',
    question: 'On which continent is the Sahara Desert?',
    options: ['Africa', 'Asia', 'Australia', 'South America'],
    answerIndex: 0,
    difficulty: 1,
  },
  {
    id: 'geo-02',
    category: 'geography',
    question: 'What is the capital city of Japan?',
    options: ['Tokyo', 'Osaka', 'Kyoto', 'Sapporo'],
    answerIndex: 0,
    difficulty: 1,
  },
  {
    id: 'geo-03',
    category: 'geography',
    question: 'Which ocean lies between Europe and North America?',
    options: ['Atlantic', 'Pacific', 'Indian', 'Arctic'],
    answerIndex: 0,
    difficulty: 1,
  },
  {
    id: 'geo-04',
    category: 'geography',
    question: 'Mount Everest sits on the border of Nepal and which country?',
    options: ['China', 'India', 'Bhutan', 'Pakistan'],
    answerIndex: 0,
    difficulty: 1,
  },
  {
    id: 'geo-05',
    category: 'geography',
    question: 'Which boot-shaped country has Rome as its capital?',
    options: ['Italy', 'Spain', 'Greece', 'Portugal'],
    answerIndex: 0,
    difficulty: 1,
  },
  {
    id: 'geo-06',
    category: 'geography',
    question: 'Which river flows through the city of Cairo?',
    options: ['The Nile', 'The Congo', 'The Niger', 'The Zambezi'],
    answerIndex: 0,
    difficulty: 2,
  },
  {
    id: 'geo-07',
    category: 'geography',
    question: 'Which country covers the largest land area?',
    options: ['Russia', 'Canada', 'China', 'Brazil'],
    answerIndex: 0,
    difficulty: 2,
  },
  {
    id: 'geo-08',
    category: 'geography',
    question: 'Which continent has no permanent human residents?',
    options: ['Antarctica', 'Australia', 'Europe', 'South America'],
    answerIndex: 0,
    difficulty: 2,
  },
  {
    id: 'geo-09',
    category: 'geography',
    question: 'What is the capital city of Australia?',
    options: ['Canberra', 'Sydney', 'Melbourne', 'Perth'],
    answerIndex: 0,
    difficulty: 2,
  },
  {
    id: 'geo-10',
    category: 'geography',
    question: 'What is the capital city of Canada?',
    options: ['Ottawa', 'Toronto', 'Vancouver', 'Montreal'],
    answerIndex: 0,
    difficulty: 2,
  },
  {
    id: 'geo-11',
    category: 'geography',
    question: 'Which strait separates Spain from Morocco?',
    options: ['Gibraltar', 'Bosporus', 'Hormuz', 'Malacca'],
    answerIndex: 0,
    difficulty: 3,
  },
  {
    id: 'geo-12',
    category: 'geography',
    question: 'Lake Titicaca lies between Peru and which country?',
    options: ['Bolivia', 'Chile', 'Ecuador', 'Brazil'],
    answerIndex: 0,
    difficulty: 3,
  },
  {
    id: 'geo-13',
    category: 'geography',
    question: 'Which country is completely surrounded by South Africa?',
    options: ['Lesotho', 'Eswatini', 'Botswana', 'Namibia'],
    answerIndex: 0,
    difficulty: 3,
  },
  {
    id: 'geo-14',
    category: 'geography',
    question: 'Which Russian mountain range is the Europe-Asia boundary?',
    options: ['The Urals', 'The Alps', 'The Pyrenees', 'The Carpathians'],
    answerIndex: 0,
    difficulty: 3,
  },
  {
    id: 'geo-15',
    category: 'geography',
    question: 'Which desert covers southern Mongolia and northern China?',
    options: ['Gobi', 'Kalahari', 'Atacama', 'Thar'],
    answerIndex: 0,
    difficulty: 3,
  },

  // --- wordplay --------------------------------------------------------------
  {
    id: 'wrd-01',
    category: 'wordplay',
    question: 'Which of these words reads the same backwards?',
    options: ['LEVEL', 'LEVER', 'LEAVE', 'LOVER'],
    answerIndex: 0,
    difficulty: 1,
  },
  {
    id: 'wrd-02',
    category: 'wordplay',
    question: 'How many letters are in the word ALPHABET?',
    options: ['Eight', 'Seven', 'Nine', 'Ten'],
    answerIndex: 0,
    difficulty: 1,
  },
  {
    id: 'wrd-03',
    category: 'wordplay',
    question: 'Which word is the opposite of ANCIENT?',
    options: ['MODERN', 'AGED', 'ANTIQUE', 'OLDEN'],
    answerIndex: 0,
    difficulty: 1,
  },
  {
    id: 'wrd-04',
    category: 'wordplay',
    question: 'Which word rhymes with BRIGHT?',
    options: ['KITE', 'BREATH', 'BRICK', 'BOUGHT'],
    answerIndex: 0,
    difficulty: 1,
  },
  {
    id: 'wrd-05',
    category: 'wordplay',
    question: 'What is the plural of MOUSE, the animal?',
    options: ['MICE', 'MOUSES', 'MOUSEN', 'MOICE'],
    answerIndex: 0,
    difficulty: 1,
  },
  {
    id: 'wrd-06',
    category: 'wordplay',
    question: 'Rearrange every letter of NIGHT to make which word?',
    options: ['THING', 'TIGHT', 'THIN', 'SIGH'],
    answerIndex: 0,
    difficulty: 2,
  },
  {
    id: 'wrd-07',
    category: 'wordplay',
    question: 'Which word has four vowels in a row?',
    options: ['QUEUE', 'BEAUTY', 'GUARD', 'SIEVE'],
    answerIndex: 0,
    difficulty: 2,
  },
  {
    id: 'wrd-08',
    category: 'wordplay',
    question: 'Which single word names a group of wolves?',
    options: ['PACK', 'HERD', 'FLOCK', 'SWARM'],
    answerIndex: 0,
    difficulty: 2,
  },
  {
    id: 'wrd-09',
    category: 'wordplay',
    question: 'Which word means the same as BRAVE?',
    options: ['VALIANT', 'TIMID', 'WEARY', 'HASTY'],
    answerIndex: 0,
    difficulty: 2,
  },
  {
    id: 'wrd-10',
    category: 'wordplay',
    question: 'How many syllables does the word CAMERA have?',
    options: ['Three', 'Two', 'Four', 'One'],
    answerIndex: 0,
    difficulty: 2,
  },
  {
    id: 'wrd-11',
    category: 'wordplay',
    question: 'Which word uses exactly the letters of TEACHER?',
    options: ['CHEATER', 'REACHED', 'CHEATED', 'RETRACE'],
    answerIndex: 0,
    difficulty: 3,
  },
  {
    id: 'wrd-12',
    category: 'wordplay',
    question: 'Which word means easy to read?',
    options: ['LEGIBLE', 'ELIGIBLE', 'TANGIBLE', 'AUDIBLE'],
    answerIndex: 0,
    difficulty: 3,
  },
  {
    id: 'wrd-13',
    category: 'wordplay',
    question: 'Which of these words is a palindrome?',
    options: ['KAYAK', 'KAYAKS', 'KOALA', 'KIOSK'],
    answerIndex: 0,
    difficulty: 3,
  },
  {
    id: 'wrd-14',
    category: 'wordplay',
    question: 'Which prefix means across, as in ___atlantic?',
    options: ['TRANS', 'SUB', 'INTER', 'PRE'],
    answerIndex: 0,
    difficulty: 3,
  },
  {
    id: 'wrd-15',
    category: 'wordplay',
    question: 'Which word contains the letter E exactly three times?',
    options: ['ELEMENT', 'ENGINE', 'SEVEN', 'EMBER'],
    answerIndex: 0,
    difficulty: 3,
  },

  // --- numbers and logic -----------------------------------------------------
  {
    id: 'log-01',
    category: 'logic',
    question: 'What is 7 times 8?',
    options: ['56', '48', '54', '64'],
    answerIndex: 0,
    difficulty: 1,
  },
  {
    id: 'log-02',
    category: 'logic',
    question: 'How many sides does a hexagon have?',
    options: ['Six', 'Five', 'Seven', 'Eight'],
    answerIndex: 0,
    difficulty: 1,
  },
  {
    id: 'log-03',
    category: 'logic',
    question: 'What is half of 250?',
    options: ['125', '115', '120', '135'],
    answerIndex: 0,
    difficulty: 1,
  },
  {
    id: 'log-04',
    category: 'logic',
    question: 'Which of these numbers is prime?',
    options: ['13', '9', '15', '21'],
    answerIndex: 0,
    difficulty: 1,
  },
  {
    id: 'log-05',
    category: 'logic',
    question: 'How many minutes are in two and a half hours?',
    options: ['150', '120', '140', '160'],
    answerIndex: 0,
    difficulty: 1,
  },
  {
    id: 'log-06',
    category: 'logic',
    question: 'What is 15% of 200?',
    options: ['30', '20', '25', '35'],
    answerIndex: 0,
    difficulty: 2,
  },
  {
    id: 'log-07',
    category: 'logic',
    question: 'What comes next: 2, 4, 8, 16, ...?',
    options: ['32', '20', '24', '64'],
    answerIndex: 0,
    difficulty: 2,
  },
  {
    id: 'log-08',
    category: 'logic',
    question: 'The angles of a triangle add up to how many degrees?',
    options: ['180', '90', '270', '360'],
    answerIndex: 0,
    difficulty: 2,
  },
  {
    id: 'log-09',
    category: 'logic',
    question: 'A shirt costs 40 and is cut by 25%. What is the new price?',
    options: ['30', '28', '32', '35'],
    answerIndex: 0,
    difficulty: 2,
  },
  {
    id: 'log-10',
    category: 'logic',
    question: 'How many edges does a cube have?',
    options: ['12', '6', '8', '16'],
    answerIndex: 0,
    difficulty: 2,
  },
  {
    id: 'log-11',
    category: 'logic',
    question: 'What is the next prime number after 23?',
    options: ['29', '25', '27', '31'],
    answerIndex: 0,
    difficulty: 3,
  },
  {
    id: 'log-12',
    category: 'logic',
    question: 'What comes next: 1, 1, 2, 3, 5, 8, ...?',
    options: ['13', '11', '12', '16'],
    answerIndex: 0,
    difficulty: 3,
  },
  {
    id: 'log-13',
    category: 'logic',
    question: 'What is the square root of 169?',
    options: ['13', '12', '14', '17'],
    answerIndex: 0,
    difficulty: 3,
  },
  {
    id: 'log-14',
    category: 'logic',
    question: 'A bag holds 3 red and 5 blue balls. Chance of drawing red?',
    options: ['3 in 8', '3 in 5', '1 in 3', '5 in 8'],
    answerIndex: 0,
    difficulty: 3,
  },
  {
    id: 'log-15',
    category: 'logic',
    question: 'In how many different orders can 4 books sit on a shelf?',
    options: ['24', '12', '16', '64'],
    answerIndex: 0,
    difficulty: 3,
  },
];

/**
 * Seeded quiz draw with a difficulty ramp: ~40% tier 1, ~30% tier 2, the rest
 * tier 3, shuffled inside each tier and returned in non-decreasing difficulty
 * order so a quiz opens warm and closes hard. Same seed, same quiz.
 *
 * `count` above one tier's size spills into the next tier (and is clamped to
 * the bank), so a caller can safely ask for a reserve of spare questions.
 */
export function drawQuiz(rng: Rng, count: number): TriviaQuestion[] {
  const wanted = Math.max(0, Math.min(count, TRIVIA.length));
  const tiers = [1, 2, 3].map((tier) => rng.shuffle(TRIVIA.filter((q) => q.difficulty === tier)));
  const quota = [Math.ceil(wanted * 0.4), Math.round(wanted * 0.3), 0];
  quota[2] = wanted - (quota[0] ?? 0) - (quota[1] ?? 0);

  const drawn: TriviaQuestion[] = [];
  let carry = 0;
  for (let tier = 0; tier < tiers.length; tier += 1) {
    const pool = tiers[tier] ?? [];
    const take = Math.min((quota[tier] ?? 0) + carry, pool.length);
    carry = (quota[tier] ?? 0) + carry - take;
    for (let i = 0; i < take; i += 1) drawn.push(pool[i]!);
    tiers[tier] = pool.slice(take);
  }
  // A tier that ran dry leaves a shortfall the higher tiers could not absorb;
  // backfill from whatever is left and re-sort so the ramp still holds.
  if (drawn.length < wanted) {
    for (const pool of tiers) {
      for (const question of pool) {
        if (drawn.length >= wanted) break;
        drawn.push(question);
      }
    }
  }
  // Stable sort: the shuffle inside each tier survives, the ramp is guaranteed.
  drawn.sort((a, b) => a.difficulty - b.difficulty);
  // The bank authors the answer first; permute per draw so the correct option
  // never sits in a predictable slot.
  return drawn.map((question) => {
    const answer = question.options[question.answerIndex] ?? '';
    const options = rng.shuffle([...question.options]);
    return { ...question, options, answerIndex: options.indexOf(answer) };
  });
}
