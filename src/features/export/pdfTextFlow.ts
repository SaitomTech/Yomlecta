// Run after images load and again before printing, using the actual text-column width.
export const PDF_TEXT_FLOW_SCRIPT = String.raw`
function arrangePdfText() {
  for (const article of document.querySelectorAll('.pdf-slide')) {
    if (article.dataset.arranged) continue;
    const start = article.querySelector('.slide-start');
    const lead = start.querySelector('.prose');
    const remainder = article.querySelector('.slide-remainder .prose');
    const figure = start.querySelector('figure');
    if (!figure) continue;
    const image = figure.querySelector('img');
    if (!image.complete || !image.naturalWidth) continue;
    // Restore the whole source body before choosing its display split.
    while (remainder.firstChild) lead.appendChild(remainder.firstChild);
    const nodes = Array.from(lead.children);
    // Fill through the first complete text line below the image and caption.
    // Otherwise the table row keeps a fractional line of image height as a gap.
    const lineHeight = parseFloat(getComputedStyle(lead).lineHeight);
    const target = figure.getBoundingClientRect().height + lineHeight;
    lead.replaceChildren();
    let overflow = false;
    for (const node of nodes) {
      if (overflow) { remainder.appendChild(node); continue; }
      lead.appendChild(node);
      if (lead.getBoundingClientRect().height <= target) continue;
      const characters = Array.from(node.textContent);
      let low = 0, high = characters.length;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        node.textContent = characters.slice(0, middle).join('');
        if (lead.getBoundingClientRect().height <= target) low = middle;
        else high = middle - 1;
      }
      if (low === 0) node.remove();
      else node.textContent = characters.slice(0, low).join('');
      const tail = node.cloneNode(false);
      tail.textContent = characters.slice(low).join('');
      if (low > 0) {
        node.style.marginBottom = '0';
        tail.classList.add('paragraph-continuation');
      }
      remainder.appendChild(tail);
      overflow = true;
    }
    article.dataset.arranged = 'true';
  }
}
window.addEventListener('load', arrangePdfText);
window.addEventListener('beforeprint', arrangePdfText);
`
