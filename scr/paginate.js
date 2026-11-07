// Plans where to cut a long page into A4 pages without slicing through a paragraph,
// table row, formula or diagram. Pure maths, so it can be tested in Node.
//
// blocks: [{ top, bottom }] in px from the top of the sheet. total: sheet height. pageH: px per page.
// Returns [[start, end], ...]

export function planPages(blocks, total, pageH) {
  const sorted = [...blocks].sort((a, b) => a.top - b.top);
  const pages = [];
  let start = 0;

  for (let guard = 0; guard < 1000 && start < total - 1; guard++) {
    let end = start + pageH;
    if (end >= total) {
      pages.push([start, total]);
      break;
    }
    // If the cut would fall inside a block, move it up to the start of that block.
    for (let pass = 0, moved = true; moved && pass < 50; pass++) {
      moved = false;
      for (const b of sorted) {
        if (b.top > start && b.top < end && b.bottom > end) {
          end = b.top;
          moved = true;
        }
      }
    }
    // A block taller than most of a page cannot be kept whole: cut at the page edge.
    if (end - start < pageH * 0.3) end = start + pageH;
    pages.push([start, end]);
    start = end;
  }
  return pages;
}
