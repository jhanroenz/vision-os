/**
 * Client-side PDF export for research documents using html2pdf.js.
 */

async function preloadImageAsDataUrl(url: string): Promise<string> {
  try {
    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) return url;
    const blob = await response.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return url;
  }
}

async function preloadImagesInElement(root: HTMLElement): Promise<void> {
  const images = [...root.querySelectorAll('img')];
  await Promise.all(
    images.map(async (img) => {
      const src = img.getAttribute('src');
      if (!src || src.startsWith('data:')) return;
      const dataUrl = await preloadImageAsDataUrl(src);
      if (dataUrl !== src) img.setAttribute('src', dataUrl);
    })
  );
}

function sanitizeFilename(title: string): string {
  return (
    title
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 60)
      .toLowerCase() || 'research'
  );
}

export interface ExportResearchPdfOptions {
  element: HTMLElement;
  title: string;
  onProgress?: (message: string) => void;
}

/**
 * Export a research document DOM subtree to PDF.
 */
export async function exportResearchPdf({
  element,
  title,
  onProgress
}: ExportResearchPdfOptions): Promise<void> {
  onProgress?.('Preparing images…');
  const clone = element.cloneNode(true) as HTMLElement;
  clone.style.visibility = 'visible';
  clone.style.position = 'static';
  clone.style.left = 'auto';
  clone.classList.add('research-document--print');

  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-10000px';
  container.style.top = '0';
  container.style.width = '210mm';
  container.appendChild(clone);
  document.body.appendChild(container);

  try {
    await preloadImagesInElement(clone);
    onProgress?.('Generating PDF…');

    const html2pdf = (await import('html2pdf.js')).default;
    const filename = `${sanitizeFilename(title)}-research.pdf`;

    await html2pdf()
      .set({
        margin: [12, 14, 14, 14],
        filename,
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          logging: false,
          backgroundColor: '#ffffff'
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
      })
      .from(clone)
      .save();
  } finally {
    document.body.removeChild(container);
  }
}
