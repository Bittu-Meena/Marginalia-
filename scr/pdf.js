// Makes an A4 PDF of the notes on the phone and hands it to Android's share sheet
// (Save to Files or Drive, send on WhatsApp, and so on).
//
// The notes are drawn page by page (small canvases, so long notes do not run out of memory),
// and each page is cut between paragraphs, table rows, formulas and diagrams, never through them.

import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { planPages } from './paginate.js';

const PAGE_W = 740; // width in px of the sheet while it is drawn
const MM_W = 182; // printable width of an A4 page, in mm
const MM_H = 267; // printable height, in mm
const PAGE_H = Math.floor((PAGE_W * MM_H) / MM_W);

const UNBREAKABLE = 'p, li, tr, blockquote, pre, hr, .katex-display, .diagram, h3, h4, .n-head, .sheet-head';
const KEEP_WITH_NEXT = 'h3, h4, .n-head, .sheet-head';

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

export async function buildPdfBase64(sheet, onProgress = () => {}) {
  const html2canvas = window.html2canvas;
  const jsPDF = window.jspdf && window.jspdf.jsPDF;
  if (!html2canvas || !jsPDF) throw new Error('The PDF tools did not load. Check your internet connection and reopen the app.');

  // Draw a clean copy off-screen so the phone screen does not flicker.
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-99999px;top:0;width:${PAGE_W}px;pointer-events:none;`;
  const clone = sheet.cloneNode(true);
  clone.removeAttribute('hidden');
  clone.classList.add('pdf-mode');
  clone.querySelectorAll('.no-pdf').forEach((n) => n.remove());
  clone.querySelectorAll('.n-sec:not([data-status="done"])').forEach((n) => n.remove());
  host.appendChild(clone);
  document.body.appendChild(host);

  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    await nextFrame();

    const box = clone.getBoundingClientRect();
    const blocks = [];
    clone.querySelectorAll(UNBREAKABLE).forEach((el) => {
      if (el.matches('li') && el.querySelector('ul, ol')) return; // only the innermost list items
      const r = el.getBoundingClientRect();
      if (r.height < 1) return;
      blocks.push({ top: r.top - box.top, bottom: r.bottom - box.top + (el.matches(KEEP_WITH_NEXT) ? 64 : 0) });
    });

    const pages = planPages(blocks, Math.ceil(box.height), PAGE_H);
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });

    for (let i = 0; i < pages.length; i++) {
      onProgress(i + 1, pages.length);
      const [start, end] = pages[i];
      const canvas = await html2canvas(clone, {
        scale: 1.75,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
        x: 0,
        y: start,
        width: PAGE_W,
        height: end - start,
        windowWidth: PAGE_W,
        scrollX: 0,
        scrollY: 0,
      });
      if (i > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 14, 14, MM_W, ((end - start) * MM_W) / PAGE_W, undefined, 'FAST');
      pdf.setFontSize(9);
      pdf.setTextColor(130);
      pdf.text(`${i + 1} / ${pages.length}`, 105, 290, { align: 'center' });
      canvas.width = 0; // let the phone free this page's memory
      canvas.height = 0;
      await new Promise((r) => setTimeout(r, 0));
    }

    const uri = pdf.output('datauristring');
    return uri.slice(uri.indexOf('base64,') + 7);
  } finally {
    host.remove();
  }
}

export async function savePdf(base64, filename, title) {
  if (Capacitor.isNativePlatform()) {
    const file = await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache });
    await Share.share({ title, text: title, url: file.uri, dialogTitle: 'Save or send your notes' });
    return;
  }
  // In a normal browser (testing): a plain download.
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function shareText(text, title) {
  await Share.share({ title, text, dialogTitle: 'Send notes' });
}
