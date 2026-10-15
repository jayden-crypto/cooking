// Text helpers shared by the parsers.

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', deg: '°', frac12: '½', frac14: '¼', frac34: '¾',
  eacute: 'é', egrave: 'è', times: '×', middot: '·', bull: '•', copy: '©', reg: '®', trade: '™',
};

export function decodeEntities(str) {
  if (!str) return '';
  return str.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (match, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      try {
        return String.fromCodePoint(n);
      } catch {
        return match;
      }
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}

/** Turns an HTML fragment into plain text, keeping line breaks. */
export function htmlToText(html) {
  if (!html) return '';
  const text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(text)
    .replace(/ /g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** "PT1H30M" -> "1 hr 30 min". Returns '' for anything it can't read. */
export function formatIsoDuration(iso) {
  if (typeof iso !== 'string') return '';
  const m = iso.trim().match(/^P(?:(\d+)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
  if (!m) return '';
  let minutes = (Number(m[1] || 0) * 24 + Number(m[2] || 0)) * 60 + Number(m[3] || 0) + Number(m[4] || 0) / 60;
  minutes = Math.round(minutes);
  return minutes > 0 ? formatMinutes(minutes) : '';
}

export function formatMinutes(total) {
  const h = Math.floor(total / 60);
  const min = total % 60;
  if (!h) return `${min} min`;
  return min ? `${h} hr ${min} min` : `${h} hr`;
}

export function cleanString(value, maxLength = 5000) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

/** Squash whitespace inside a multi-line string but keep the line breaks. */
export function tidyMultiline(value, maxLength = 20000) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxLength);
}
