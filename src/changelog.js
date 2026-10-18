// Turns CHANGELOG.md into the "What's new" page at /changes.
// Handles the simple Markdown used there: headings, bullet lists, paragraphs,
// **bold**, `code`, and [links](https://...).

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function inline(text) {
  return esc(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]*)\)/g, '<a href="$2">$1</a>')
    .replace(/&quot;([^&]*?)&quot;/g, "“$1”")
    .replace(/'/g, "’");
}

export function renderMarkdown(md) {
  const out = [];
  let list = null, para = [];
  const flushPara = () => { if (para.length) out.push(`<p>${inline(para.join(" "))}</p>`); para = []; };
  const flushList = () => { if (list) out.push(`<ul>${list.map((li) => `<li>${inline(li)}</li>`).join("")}</ul>`); list = null; };
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) { flushPara(); flushList(); const n = h[1].length; out.push(`<h${n}>${inline(h[2])}</h${n}>`); continue; }
    const li = line.match(/^\s*[-*]\s+(.*)$/);
    if (li) { flushPara(); (list ||= []).push(li[1]); continue; }
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if (list) { list[list.length - 1] += ` ${line.trim()}`; continue; } // wrapped bullet
    para.push(line.trim());
  }
  flushPara(); flushList();
  return out.join("\n");
}

export function changesPage(md) {
  const body = renderMarkdown(md.replace(/^#\s+.*\n/, "")); // the page supplies its own title
  const nav = [["/", "Divisions"], ["/conferences", "Conferences"], ["/league", "League"], ["/odds", "Playoff odds"], ["/trends", "Trends"]]
    .map(([href, label]) => `      <li><a href="${href}">${label}</a></li>`).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>What’s new: AHL standings</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🏒</text></svg>">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Barlow:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<div class="wrap">
  <header>
    <div>
      <h1>What’s new</h1>
      <p class="updated">Changes to this site, newest first.</p>
    </div>
  </header>
  <nav class="pages" aria-label="Pages">
    <ul>
${nav}
    </ul>
  </nav>
  <main class="changelog">
${body}
  </main>
</div>
</body>
</html>
`;
}
