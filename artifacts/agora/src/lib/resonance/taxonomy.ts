/**
 * Single source of truth for the Agora Resonance taxonomy.
 *
 * Six families derived from the Resonance playbook. Every other Resonance
 * module — event encode/decode, validator, editor UI, map view — imports
 * from this file. Adding or renaming a tag here is the only change needed
 * to update the whole feature.
 *
 * Tag ids are stable, lowercase, kebab-case and short — they ship in
 * every published interest event so brevity matters. Labels are the
 * human-readable string shown in the UI and are safe to retitle without
 * breaking backwards compatibility.
 *
 * "Hard boundaries" tags from the playbook (HIV/PrEP, dealbreakers,
 * substance preferences) are intentionally absent: they need
 * zero-knowledge protection before they can be safely published to
 * relays and are deferred to a later phase.
 */

export type ResonanceFamilyId =
  | "aesthetics"
  | "culture"
  | "music"
  | "mind"
  | "lifestyle"
  | "texture";

export type ResonanceTag = {
  id: string;
  label: string;
  family: ResonanceFamilyId;
};

export type ResonanceFamily = {
  id: ResonanceFamilyId;
  label: string;
  blurb: string;
  tags: ResonanceTag[];
};

function f(family: ResonanceFamilyId, entries: [string, string][]): ResonanceTag[] {
  return entries.map(([id, label]) => ({ id, label, family }));
}

export const RESONANCE_FAMILIES: ResonanceFamily[] = [
  {
    id: "aesthetics",
    label: "Aesthetics & Energy",
    blurb: "The visual and emotional register you live in.",
    tags: f("aesthetics", [
      ["minimalist", "Minimalist"],
      ["maximalist", "Maximalist"],
      ["dark-academia", "Dark academia"],
      ["cottagecore", "Cottagecore"],
      ["cyberpunk", "Cyberpunk"],
      ["vintage", "Vintage"],
      ["brutalist", "Brutalist"],
      ["sleek-modern", "Sleek modern"],
      ["playful", "Playful"],
    ]),
  },
  {
    id: "culture",
    label: "Cultural Interests",
    blurb: "Where you spend your attention.",
    tags: f("culture", [
      ["film", "Film"],
      ["literature", "Literature"],
      ["theatre", "Theatre"],
      ["visual-art", "Visual art"],
      ["photography", "Photography"],
      ["design", "Design"],
      ["architecture", "Architecture"],
      ["fashion", "Fashion"],
      ["gaming", "Gaming"],
      ["anime", "Anime"],
      ["comics", "Comics"],
      ["food", "Food"],
    ]),
  },
  {
    id: "music",
    label: "Music",
    blurb: "What's in your headphones.",
    tags: f("music", [
      ["jazz", "Jazz"],
      ["classical", "Classical"],
      ["electronic", "Electronic"],
      ["hip-hop", "Hip-hop"],
      ["indie-rock", "Indie rock"],
      ["folk", "Folk"],
      ["metal", "Metal"],
      ["pop", "Pop"],
      ["world-music", "World music"],
      ["ambient", "Ambient"],
    ]),
  },
  {
    id: "mind",
    label: "Mind & Values",
    blurb: "How you think and what you care about.",
    tags: f("mind", [
      ["philosophy", "Philosophy"],
      ["science", "Science"],
      ["spirituality", "Spirituality"],
      ["activism", "Activism"],
      ["entrepreneurship", "Entrepreneurship"],
      ["craftsmanship", "Craftsmanship"],
      ["learning", "Lifelong learning"],
      ["debate", "Debate"],
      ["writing", "Writing"],
      ["journalism", "Journalism"],
    ]),
  },
  {
    id: "lifestyle",
    label: "Social & Lifestyle",
    blurb: "How you spend an unstructured day.",
    tags: f("lifestyle", [
      ["outdoors", "Outdoors"],
      ["fitness", "Fitness"],
      ["travel", "Travel"],
      ["urban-explorer", "Urban explorer"],
      ["homebody", "Homebody"],
      ["nightlife", "Nightlife"],
      ["hosting", "Hosting"],
      ["volunteering", "Volunteering"],
      ["cooking", "Cooking"],
    ]),
  },
  {
    id: "texture",
    label: "Relationship Texture",
    blurb: "The flavour of connection you enjoy.",
    tags: f("texture", [
      ["deep-conversation", "Deep conversation"],
      ["witty-banter", "Witty banter"],
      ["playful-flirt", "Playful flirt"],
      ["intellectual-spar", "Intellectual spar"],
      ["warm-companionship", "Warm companionship"],
    ]),
  },
];

const TAG_INDEX: Map<string, ResonanceTag> = (() => {
  const m = new Map<string, ResonanceTag>();
  for (const fam of RESONANCE_FAMILIES) {
    for (const tag of fam.tags) m.set(tag.id, tag);
  }
  return m;
})();

export function findResonanceTag(id: string): ResonanceTag | undefined {
  return TAG_INDEX.get(id);
}

export function isKnownResonanceTag(id: string): boolean {
  return TAG_INDEX.has(id);
}

/** Hard upper bound on selections per published event — keeps it compact. */
export const MAX_RESONANCE_SELECTIONS = 30;

/** Inclusive intensity range for the 1–5 slider. */
export const MIN_INTENSITY = 1;
export const MAX_INTENSITY = 5;

export function clampIntensity(n: number): number {
  if (!Number.isFinite(n)) return MIN_INTENSITY;
  const r = Math.round(n);
  if (r < MIN_INTENSITY) return MIN_INTENSITY;
  if (r > MAX_INTENSITY) return MAX_INTENSITY;
  return r;
}
