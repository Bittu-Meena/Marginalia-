import { fmt } from './chapters.js';

const DETAIL = {
  concise:
    'Write crisp revision notes that still cover everything the lecture teaches. Use sentence fragments and one-line bullets, with no explanation beyond one short line and no worked-example steps (give only the result). Put parallel information (types, cases, properties, comparisons, units, symbols) in Markdown tables. Finish with "### Formulas": a table with the columns Formula | Symbols | Use or condition that lists EVERY formula from the lecture, one per row. Aim for under 10 percent of the transcript length.',
  standard:
    'Write compact study notes: every concept the teacher covers as short bullets, formulas with the meaning of each symbol, the key results of derivations (not every step), the main solved examples in one or two lines each, and tables for comparisons. Finish with "### Formulas": a table with the columns Formula | Symbols | Use or condition.',
  detailed:
    'Write thorough notes: full step-by-step derivations, every solved example with its working, conditions and special cases, and the common mistakes the teacher warns about. Finish with "### Formulas": a table with the columns Formula | Symbols | Use or condition.',
};

const LANGUAGE = {
  english: 'Write the notes in clear English. Keep standard technical terms.',
  hinglish:
    'Write the notes in Hinglish: Hindi in Roman script mixed with English technical terms, the way a teacher talks in class.',
  hindi:
    'Write the notes in Hindi (Devanagari script). Keep the standard English technical terms and all symbols and formulas as students normally use them.',
};

const DIAGRAMS_ON = [
  '- Include diagrams where a picture really helps, typically 1 to 4 per topic: the figures the teacher draws or describes, such as circuits, coils with field lines, a rod on rails, graphs of current or flux against time, or a flowchart of a law. Skip diagrams for pure theory.',
  '- Draw physical figures as inline SVG inside a fenced block that starts with ```svg and ends with ```. Draw concept maps and step-by-step flows as Mermaid inside a fenced block that starts with ```mermaid.',
  '- SVG rules: exactly one complete <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"> element, with no width or height attributes, no scripts, no images, no <style> and no CSS classes. Keep everything inside the viewBox with a 12px margin. Use stroke="#1f2a44" stroke-width="2" fill="none" for lines, #2a44b3 for the main field or current arrows and #c7372f for the induced quantity. Text: font-size="15" fill="#1f1f1f" with plain Unicode symbols (Φ ε μ₀ ΔΦ θ ω ∞ × →), never LaTeX. For arrowheads define one <marker> with orient="auto" inside <defs> and use marker-end. Label every important part (B, v, I, R, L, direction of the induced emf) and keep labels from overlapping lines. Show a magnetic field into the page with × and out of the page with a filled dot.',
  '- Mermaid rules: start with flowchart LR or flowchart TD, use at most 10 nodes, put every node label in double quotes like A["Changing flux"] --> B["Induced emf"], no LaTeX, and no parentheses outside the quotes.',
  '- Put one line directly after each diagram in the form *Figure: what it shows.*',
];

export function notesSystem({ detail = 'concise', language = 'english', practice = false, diagrams = false } = {}) {
  return [
    'You are an expert teacher who writes clear, exam-ready study notes from a lecture transcript.',
    'The transcript is auto-generated. It may be Hindi, Hinglish or English and contains recognition errors, filler words and spoken repetition. Correct obvious mistakes in technical terms, names and numbers using your subject knowledge, and drop the filler. Stay faithful to what the teacher actually taught: do not add topics the lecture does not cover. You may complete a formula or definition when the transcript clearly implies it.',
    'Be terse. Never write introductions, never restate the question, never add motivation, and never explain more than the teacher did.',
    DETAIL[detail] || DETAIL.concise,
    LANGUAGE[language] || LANGUAGE.english,
    'Formatting rules:',
    '- Output Markdown only. No preamble, no closing remarks, and do not wrap the answer in a code fence.',
    '- Do not write a title for the topic (the app adds it). Start directly with content. Use ### for sections and #### for sub-sections.',
    '- Write every formula in LaTeX: $...$ for inline and $$...$$ for display. Never use \\( \\) or \\[ \\]. Put units in \\text{}.',
    '- Bold key terms the first time they appear. Use bullet lists for properties, and a table when comparing things.',
    '- Show important formulas and exam points as blockquotes that start with **Key formula:** or **Remember:**.',
    ...(diagrams ? DIAGRAMS_ON : ['- Do not include diagrams or code blocks.']),
    practice
      ? '- End with a section "### Quick practice": 4 to 6 short questions on this topic, each followed by a brief answer.'
      : '- Do not add practice questions.',
  ].join('\n');
}

export function notesPrompt({ videoTitle, topic, transcript }) {
  const range = `${fmt(topic.start)} to ${topic.end != null ? fmt(topic.end) : 'the end'}`;
  return `Lecture: "${videoTitle}"
Topic: "${topic.title}" (${range})

Transcript, with [m:ss] time markers:
"""
${transcript}
"""

Write the notes for this topic now.`;
}

export const TOPICS_SYSTEM =
  'You split a lecture transcript into its main topics. The transcript may be Hindi, Hinglish or English. Return only JSON.';

export function topicsPrompt({ videoTitle, condensed }) {
  return `Lecture: "${videoTitle}"

Below is the lecture, one line per minute, each starting with its [time] marker.
Split it into 6 to 30 topics in the order taught (more topics for longer lectures). Use short, clear English titles that a student would recognise. The first topic must start at 0 seconds. Mark breaks as "Break".

Return a JSON array like [{"start": 0, "title": "Introduction"}, {"start": 217, "title": "Magnetic Flux"}] where start is in seconds.

"""
${condensed}
"""`;
}

export function condenseSystem({ language = 'english' } = {}) {
  return [
    'You turn study notes into a very compact revision sheet. Nothing important may be lost, but every word must earn its place.',
    'KEEP: every formula (with the meaning of its symbols), definition, law, rule, condition, unit, final result and distinct fact.',
    'REMOVE: explanations, derivation steps (keep the final formula and one line on when it is used), worked-example working (keep one line with the result), repetition, filler and practice questions.',
    'Format: Markdown only, no preamble and no closing remarks, and do not wrap the answer in a code fence. Use sentence fragments and one-line bullets. Use tables wherever information is parallel: comparisons, types, cases, properties, units, symbols.',
    'Structure: short ### sections that follow the notes, mostly tables or one-line bullets. End with "### Formula sheet": a table with the columns Formula | Symbols | Use or condition that lists EVERY formula appearing in the notes, one per row. Never leave a formula out.',
    'Math: LaTeX with $...$ inline and $$...$$ for display; inside tables always use inline $...$. Never use \\( \\) or \\[ \\].',
    'Diagrams: copy any ```svg or ```mermaid block from the notes exactly as it is, together with its *Figure:* line, and place it where it fits best. Never invent a new diagram.',
    'Length: about one third of the original or shorter.',
    language === 'hindi'
      ? 'Keep the notes in Hindi (Devanagari) with standard English technical terms.'
      : language === 'hinglish'
        ? 'Keep the notes in Hinglish (Hindi in Roman script mixed with English technical terms).'
        : 'Keep the notes in English.',
  ].join('\n');
}

export function condensePrompt({ title, markdown }) {
  return `Topic: "${title}"

Notes to shorten:
"""
${markdown}
"""

Write the short version now.`;
}
