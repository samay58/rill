import { decodeHTMLStrict } from 'entities';

const ENTITY_RE = /&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]+);/i;

// Feeds often escape a title twice (`&amp;#8217;`) and the XML parser undoes only the XML layer, so up to two
// HTML passes. Strict decoding needs the semicolon, which keeps "AT&T" and "R&D" intact. Tags are left alone:
// a title like "On the <dl>" is text.
export function decodeTextEntities(value: string): string {
  let text = value;
  for (let pass = 0; pass < 2 && ENTITY_RE.test(text); pass += 1) text = decodeHTMLStrict(text);
  return text;
}

// Straight quotes set as the curly ones most feeds already send, so one list never mixes the two: an apostrophe
// inside a word ("1.4's", "O'Brien"), a dropped decade ("'90s"), and a pair that opens and closes at word edges
// ('Cheap', "The Rocky Horror Show"). Previews use only these; code quoted in a preview keeps its other quotes.
export function typesetApostrophes(value: string): string {
  return value
    .replace(/([\p{L}\p{N}])'(?=\p{L})/gu, '$1’')
    .replace(/(^|[\s(\[“‘])'(?=\d0s\b)/gu, '$1’')
    .replace(/(^|\s)'n'(?=\s)/gu, '$1’n’')
    .replace(/(^|[\s(\[—–-])'([^'\s][^']*?[^'\s]|[^'\s])'(?=$|[\s.,;:!?)\]—–-])/gu, '$1‘$2’')
    .replace(/(^|[\s(\[—–-])"([^"\s][^"]*?[^"\s]|[^"\s])"(?=$|[\s.,;:!?)\]—–-])/gu, '$1“$2”');
}

// In a one-line title what is left is unpaired, often the feed's own typo ("reduction" and "…"): a quote after
// text closes, one before text opens, and a plural possessive ("kids'") is an apostrophe.
function typesetStrayQuotes(value: string): string {
  return value
    .replace(/(\S)'/gu, '$1’')
    .replace(/'(?=\S)/gu, '‘')
    .replace(/(\S)"/gu, '$1”')
    .replace(/"(?=\S)/gu, '“');
}

// One line of feed text (a title, an author, a source name) as it should read on screen.
export function cleanLine(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = typesetStrayQuotes(typesetApostrophes(decodeTextEntities(value).replace(/[\s\u00a0]+/g, ' ').trim()));
  return text.length > 0 ? text : null;
}

function comparable(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

// A byline already names the source; an author who is the source (a YouTube channel, a one-person blog) adds nothing.
export function distinctAuthor(author: string | null | undefined, source: string | null | undefined): string | null {
  const name = cleanLine(author);
  if (!name) return null;
  if (!source) return name;
  const left = comparable(name);
  const right = comparable(source);
  return left.length === 0 || right.includes(left) || left.includes(right) ? null : name;
}
