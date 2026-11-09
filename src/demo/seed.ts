// Fictional journal for demo mode. Maya Chen is made up: a college sophomore,
// biology major, climbs and runs. Every person named here is fictional.
//
// Dates are relative to server start in the local time zone. Day 0 is today,
// the journal runs 42 days back, and nothing is dated in the future.
//
// Shared anchors (the 2DooD demo uses the same ones):
//   day -24 to -21  stressed and anxious before the CHEM 201 midterm on day -21, relief after
//   day -10 to -8   rough patch: missed tasks, a fight with the roommate. Sad, angry, tired
//   day -3          BIO 210 lab report due, finished a day late on day -2 (tired, then proud)
//   day +4          CHEM 201 exam 2, so the last 3 days lean a little anxious
//   Tue/Thu climbing and Sunday long runs come with calmer, happier days
//
// Mood labels use Nocturne's label vocabulary, where "tired" is "apathy".
// Valence and arousal are the intensity-weighted mean of each label's
// coordinates.
import type { MoodRow, SongRow } from './shape/shape.ts';
import { addDays, localParts, zonedMidnightUtc } from './shape/shape.ts';

export const DEMO_PERSONA = 'Maya Chen (fictional), college sophomore, biology major, climbs and runs';
export const DEMO_DAYS_BACK = 42;

/** Valence and arousal coordinates for the labels used here. */
export const COORDS: Record<string, { valence: number; arousal: number }> = {
  joy: { valence: 0.8, arousal: 0.6 },
  trust: { valence: 0.6, arousal: 0.2 },
  sadness: { valence: -0.7, arousal: -0.5 },
  anger: { valence: -0.5, arousal: 0.9 },
  anticipation: { valence: 0.3, arousal: 0.7 },
  anxiety: { valence: -0.5, arousal: 0.7 },
  stress: { valence: -0.4, arousal: 0.75 },
  frustration: { valence: -0.5, arousal: 0.6 },
  excitement: { valence: 0.7, arousal: 0.9 },
  apathy: { valence: -0.3, arousal: -0.8 },
  contentment: { valence: 0.5, arousal: -0.3 },
  calm: { valence: 0.3, arousal: -0.6 },
  serenity: { valence: 0.6, arousal: -0.5 },
  relaxation: { valence: 0.4, arousal: -0.4 },
  peace: { valence: 0.5, arousal: -0.5 },
  guilt: { valence: -0.6, arousal: 0.2 },
  pride: { valence: 0.7, arousal: 0.5 },
  nostalgia: { valence: 0.2, arousal: -0.3 },
  awe: { valence: 0.6, arousal: 0.5 },
  confusion: { valence: -0.2, arousal: 0.3 },
};

type Emotions = Array<[label: string, intensity: number]>;
type Song = [title: string, artist: string] | null;

interface Template {
  emotions: Emotions;
  text: string;
  song: Song;
  time: string;
  drawing?: boolean;
}

/** One stored entry: what the backend's repository would return, plus the text. */
export interface DemoEntry extends MoodRow, SongRow {
  id: string;
  created_at: string;
  text: string;
  bullets: string[];
  /** Day offset from today, for tests and the README. */
  day: number;
}

const ANCHORS: Record<number, Template> = {
  [-24]: {
    time: '21:40',
    emotions: [['anxiety', 0.7], ['stress', 0.5]],
    song: ['Under Pressure', 'Queen'],
    text:
      "CHEM 201 midterm is in three days and I still can't do the equilibrium problems without peeking at the key. " +
      'Spent four hours in the library and only got through one problem set. ' +
      'Made flashcards for the reaction types, so at least that is something.',
  },
  [-23]: {
    time: '23:05',
    emotions: [['stress', 0.7], ['anxiety', 0.5], ['frustration', 0.3]],
    song: ['Stressed Out', 'Twenty One Pilots'],
    text:
      'Study group with Theo and Ana tonight. They both seem to get Le Chatelier instantly and I felt so slow. ' +
      'Theo walked me through it again and it finally kind of clicked near the end. Going to bed before midnight for once.',
  },
  [-22]: {
    time: '22:30',
    emotions: [['anxiety', 0.8], ['anticipation', 0.4]],
    song: ['Weightless', 'Marconi Union'],
    text:
      'Night before the midterm. I did the practice exam and got a 74, which is better than last week. ' +
      "My stomach is in knots anyway. Laying out my calculator and pencils so I don't have to think in the morning.",
  },
  [-21]: {
    time: '18:20',
    emotions: [['relaxation', 0.7], ['joy', 0.5], ['apathy', 0.3]],
    song: ['Dog Days Are Over', 'Florence + The Machine'],
    text:
      'Midterm done. The equilibrium section was actually okay and I only blanked on one titration question. ' +
      'Jess made pasta to celebrate and we watched a dumb movie. I feel like I can breathe again.',
  },
  [-20]: {
    time: '10:30',
    emotions: [['contentment', 0.6], ['calm', 0.5]],
    song: ['Banana Pancakes', 'Jack Johnson'],
    text:
      'Slept nine hours. Took a slow walk to the farmers market and bought way too many apples. ' +
      'Not thinking about chemistry today at all.',
  },
  [-10]: {
    time: '23:20',
    emotions: [['sadness', 0.6], ['guilt', 0.5], ['apathy', 0.4]],
    song: ['Liability', 'Lorde'],
    text:
      'Missed two things on my list today, including the office hours I signed up for. ' +
      'I keep saying yes to everything and then dropping the ball. Felt kind of low all evening and skipped the climbing social.',
  },
  [-9]: {
    time: '22:50',
    emotions: [['anger', 0.7], ['frustration', 0.6], ['sadness', 0.3]],
    song: ['Motion Sickness', 'Phoebe Bridgers'],
    text:
      "Got into it with Jess about the dishes and the noise at night. It wasn't really about the dishes. " +
      'We both said things louder than we needed to and now the apartment feels weird. I went for a walk to cool off.',
  },
  [-8]: {
    time: '21:10',
    emotions: [['apathy', 0.7], ['sadness', 0.4]],
    song: ['Holocene', 'Bon Iver'],
    text:
      'So tired today. Barely made it through lab and then napped for two hours, which wrecked my evening. ' +
      'Jess and I are still being polite and careful around each other.',
  },
  [-7]: {
    time: '22:00',
    emotions: [['calm', 0.6], ['relaxation', 0.4], ['trust', 0.3]],
    song: ['Put Your Records On', 'Corinne Bailey Rae'],
    drawing: true,
    text:
      'Jess knocked on my door and we actually talked it out. We made a chore chart, which is very dorky, and agreed on quiet hours after 11. ' +
      'I feel lighter. Made tea and went to bed early.',
  },
  [-3]: {
    time: '23:55',
    emotions: [['apathy', 0.65], ['stress', 0.6], ['frustration', 0.3]],
    song: ['Retrograde', 'James Blake'],
    text:
      "BIO 210 lab report was due tonight and I'm not done. The discussion section is a mess and my graphs keep breaking. " +
      "Emailed my TA to ask for one more day and she said yes. Going to sleep and finishing tomorrow.",
  },
  [-2]: {
    time: '20:15',
    emotions: [['pride', 0.7], ['relaxation', 0.4], ['anxiety', 0.3]],
    song: ['Good Days', 'SZA'],
    text:
      'Submitted the BIO 210 report this afternoon, a day late but actually good. The enzyme kinetics graph finally looks right. ' +
      'Treated myself to bubble tea on the way home. Already starting to think about the CHEM exam though.',
  },
  [-1]: {
    time: '22:25',
    emotions: [['anxiety', 0.6], ['anticipation', 0.4], ['calm', 0.3]],
    song: ['Bags', 'Clairo'],
    text:
      'CHEM 201 exam 2 is in five days. Made a study schedule and stuck it on the wall above my desk. ' +
      "I'm nervous but it's the normal kind of nervous, not the midterm kind. Priya says climbing is still on this week no matter what.",
  },
  [0]: {
    time: '08:40',
    emotions: [['anxiety', 0.5], ['anticipation', 0.4], ['contentment', 0.3]],
    song: ['Coffee', 'beabadoobee'],
    text:
      'Woke up early and did twenty minutes of acid-base problems before class. Four days until the exam. ' +
      'Coffee, then lecture, then the library. I can do this.',
  },
};

// Filler days with no anchor. Tuesday and Thursday are climbing nights, Sunday
// is the long run, and every third other free day gets an ordinary entry.
const CLIMB: Template[] = [
  {
    time: '21:30',
    emotions: [['joy', 0.7], ['excitement', 0.4]],
    song: ['Electric Feel', 'MGMT'],
    drawing: true,
    text:
      "Climbing with Priya tonight. I finally sent the purple V3 on the overhang wall that's been beating me for two weeks. " +
      "My forearms are dead and I'm so happy about it.",
  },
  {
    time: '21:45',
    emotions: [['calm', 0.6], ['contentment', 0.5]],
    song: ['Space Song', 'Beach House'],
    text:
      'Easy session at the gym, mostly traversing and stretching. Something about focusing on the next hold makes my brain go quiet. ' +
      'Walked home with chalk still on my hands.',
  },
  {
    time: '21:20',
    emotions: [['joy', 0.6], ['trust', 0.4]],
    song: ['Kids', 'MGMT'],
    text:
      'Priya and I tried top rope for the first time this semester and she caught my fall like a pro. ' +
      'We laughed the whole way down. Good night.',
  },
  {
    time: '21:35',
    emotions: [['pride', 0.6], ['joy', 0.5]],
    song: ['Sunflower', 'Rex Orange County'],
    text:
      'Got the heel hook on the blue route on the first try today. Two months ago I could not even reach that hold. Small wins count.',
  },
  {
    time: '21:50',
    emotions: [['calm', 0.6], ['relaxation', 0.4]],
    song: ['Pink + White', 'Frank Ocean'],
    text:
      'Did not climb hard tonight, just bouldered the easy wall and talked with Priya about her research lab. ' +
      'It was nice to be around people without having to perform. Feeling settled.',
  },
  {
    time: '21:25',
    emotions: [['excitement', 0.6], ['joy', 0.5]],
    song: ['Walking On a Dream', 'Empire of the Sun'],
    text:
      'New routes went up at the gym and the whole place was buzzing. I flashed a V2 and fell off a V4 about eight times. ' +
      'Already planning my next session.',
  },
  {
    time: '21:40',
    emotions: [['contentment', 0.6], ['calm', 0.4]],
    song: ['Cherry Wine', 'Hozier'],
    text:
      'Climbed for an hour after lab. My shoulders were tight from hunching over the microscope and this fixed it. ' +
      'Leftover soup and an early night.',
  },
  {
    time: '21:30',
    emotions: [['joy', 0.6], ['pride', 0.4]],
    song: ['Heat Waves', 'Glass Animals'],
    text:
      'Priya convinced me to try the lead climbing intro class. I was shaking at the top but I clipped every draw. ' +
      'We got dumplings after.',
  },
  {
    time: '21:15',
    emotions: [['calm', 0.5], ['joy', 0.4]],
    song: ['Riptide', 'Vance Joy'],
    text:
      'Quiet session tonight. I worked on footwork drills like the coach suggested and actually noticed a difference. ' +
      'Slow progress is still progress.',
  },
];

const RUN: Template[] = [
  {
    time: '11:15',
    emotions: [['peace', 0.6], ['joy', 0.4]],
    song: ['Let It Happen', 'Tame Impala'],
    text:
      "Long run along the river this morning, eight miles. The fog was lifting off the water and I didn't look at my watch once. Pancakes after.",
  },
  {
    time: '11:40',
    emotions: [['joy', 0.6], ['pride', 0.4]],
    song: ['Midnight City', 'M83'],
    text:
      "Ten miles today, the longest I've done since summer. Legs felt heavy around mile seven and then something clicked. " +
      'Spent the afternoon reading on the couch.',
  },
  {
    time: '10:50',
    emotions: [['calm', 0.6], ['contentment', 0.5]],
    song: null,
    text: 'Easy long run, nothing fancy. Saw the same dog walker who always waves at me. My head feels clear for the week.',
  },
  {
    time: '11:05',
    emotions: [['serenity', 0.6], ['joy', 0.3]],
    song: ['Harvest Moon', 'Neil Young'],
    text:
      'Ran the loop around the reservoir with my running club. Cold air, bright leaves, and nobody talking much. Best part of the week.',
  },
  {
    time: '12:10',
    emotions: [['contentment', 0.6], ['relaxation', 0.5]],
    song: ['Budapest', 'George Ezra'],
    text:
      'Nine miles at a slow, chatty pace with Ana. We talked about summer research programs the whole time. ' +
      'Meal prepped for the week after and called my mom.',
  },
  {
    time: '09:30',
    emotions: [['awe', 0.5], ['calm', 0.5]],
    song: ['Dreams', 'Fleetwood Mac'],
    text:
      'Started the long run before sunrise and caught the sky turning pink over the bridge. ' +
      'I stopped to take a photo, which I never do. Good start to the week.',
  },
];

const ORDINARY: Template[] = [
  {
    time: '22:10',
    emotions: [['contentment', 0.5], ['anticipation', 0.3]],
    song: ['505', 'Arctic Monkeys'],
    text:
      'Normal day. Genetics lecture was actually interesting, we talked about fruit fly eye color mutations. Got through most of my reading.',
  },
  {
    time: '22:35',
    emotions: [['apathy', 0.4], ['calm', 0.4], ['contentment', 0.3]],
    song: null,
    text: 'Long lab day. Pipetting for three hours makes my hand cramp. Watched a cooking show with Jess and went to bed.',
  },
  {
    time: '23:00',
    emotions: [['stress', 0.4], ['anticipation', 0.35]],
    song: ['Feels Like We Only Go Backwards', 'Tame Impala'],
    text: 'Organic chem problem set took forever. I kept mixing up the reagents. Theo sent me his notes, which helped a lot.',
  },
  {
    time: '21:55',
    emotions: [['joy', 0.5], ['trust', 0.4]],
    song: ['Stick Season', 'Noah Kahan'],
    text:
      "Lunch with my lab group turned into a two-hour conversation about whether we'd survive on Mars. Didn't get much done but I laughed a lot.",
  },
  {
    time: '22:20',
    emotions: [['contentment', 0.5], ['calm', 0.4]],
    song: ['Landslide', 'Fleetwood Mac'],
    text:
      'Got my BIO 210 quiz back with a 92. Spent the evening tidying my desk and planning the week. Feeling on top of things for once.',
  },
  {
    time: '22:45',
    emotions: [['confusion', 0.5], ['frustration', 0.3]],
    song: null,
    text:
      'Office hours for chem today. I thought I understood buffers until the TA asked me one question. ' +
      'Wrote down everything she said and will try again tomorrow.',
  },
  {
    time: '21:50',
    emotions: [['nostalgia', 0.5], ['contentment', 0.4]],
    song: ['Sofia', 'Clairo'],
    text:
      'Called my grandma and she told me about her first year in college. Made me want to slow down a bit. ' +
      'Did my reading in the window seat at the library.',
  },
  {
    time: '22:05',
    emotions: [['anticipation', 0.5], ['joy', 0.3]],
    song: ['Golden Hour', 'JVKE'],
    text:
      'Signed up for the spring climbing trip. Also emailed a professor about volunteering in her ecology lab. Nervous but excited.',
  },
];

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Intensity-weighted mean of each label's coordinates. */
export function valenceArousal(emotions: Emotions): { valence: number; arousal: number } {
  const total = emotions.reduce((s, [, i]) => s + i, 0);
  const v = emotions.reduce((s, [l, i]) => s + COORDS[l].valence * i, 0) / total;
  const a = emotions.reduce((s, [l, i]) => s + COORDS[l].arousal * i, 0) / total;
  return { valence: round2(Math.max(-1, Math.min(1, v))), arousal: round2(Math.max(-1, Math.min(1, a))) };
}

/** Stable per-day id. 4d415941 is "MAYA" in hex. */
export const demoId = (day: number) => `4d415941-0000-4000-8000-${String(100 + day).padStart(12, '0')}`;

/** Day of week for a YYYY-MM-DD date, 0 = Sunday. */
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** Builds the journal relative to `now` in `tz`, oldest first. Entries later than `now` are left out. */
export function seedDemo(now: Date, tz: string): DemoEntry[] {
  const today = localParts(now, tz).date;
  const counters = { climb: 0, run: 0, ordinary: 0 };
  const out: DemoEntry[] = [];
  for (let day = -DEMO_DAYS_BACK; day <= 0; day++) {
    const date = addDays(today, day);
    let t: Template | undefined = ANCHORS[day];
    // Anchored stretches stay as written. Filler only fills the gaps between them.
    const inAnchorStretch = (day >= -24 && day <= -20) || (day >= -10 && day <= -7) || day >= -3;
    if (!t && !inAnchorStretch) {
      const dow = weekday(date);
      if (dow === 2 || dow === 4) t = CLIMB[counters.climb++ % CLIMB.length];
      else if (dow === 0) t = RUN[counters.run++ % RUN.length];
      else if (-day % 3 === 0) t = ORDINARY[counters.ordinary++ % ORDINARY.length];
    }
    if (!t) continue;
    const [hh, mm] = t.time.split(':').map(Number);
    const at = new Date(zonedMidnightUtc(date, tz).getTime() + (hh * 60 + mm) * 60_000);
    if (at.getTime() > now.getTime()) continue;
    const { valence, arousal } = valenceArousal(t.emotions);
    const sorted = [...t.emotions].sort((a, b) => b[1] - a[1]);
    out.push({
      id: demoId(day),
      day,
      created_at: at.toISOString(),
      primary_emotion: sorted[0][0],
      valence,
      arousal,
      emotions: sorted.map(([emotion, intensity]) => ({ emotion, intensity, ...COORDS[emotion] })),
      has_songs: t.song !== null,
      has_drawing: t.drawing === true,
      seed_track: t.song ? { name: t.song[0], artists: [t.song[1]] } : null,
      tracks: null,
      text: t.text,
      bullets: [],
    });
  }
  return out;
}
