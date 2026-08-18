import { getDocumentProxy, extractText } from "unpdf";

/**
 * Error type thrown when PDF text extraction fails.
 *
 * The error is thin wrapper around {@link Error} that preserves the original
 * cause when available.
 */
export class PdfTextExtractionError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "PdfTextExtractionError";
    if (cause) {
      // Attach the original error stack or stringified representation to the
      // message for debugging purposes.
      const causeStr =
        cause instanceof Error ? cause.stack ?? cause.message : String(cause);
      this.message += `\nCaused by: ${causeStr}`;
    }
  }
}

/**
 * Representation of extracted text for a single PDF page.
 */
export interface PageText {
  pageNumber: number;
  text: string;
}

/**
 * Result of the PDF extraction process.
 */
export interface ExtractedPdfText {
  pageCount: number;
  pages: PageText[];
  /**
   * Optional full‑text string concatenated from all pages. Useful when a single
   * string is needed for downstream processing.
   */
  fullText?: string;
}

/**
 * Extracts text from a PDF file represented as a {@link Buffer} or
 * {@link Uint8Array}.
 *
 * The function validates that the input is non‑empty, creates a PDFDocumentProxy
 * using `unpdf.getDocumentProxy`, and then calls `unpdf.extractText` with
 * `mergePages: false` to obtain an array of strings, one per page. The order of
 * the pages is preserved. If the extraction fails, a {@link PdfTextExtractionError}
 * is thrown.
 *
 * @param pdfBytes - Raw PDF bytes as `Buffer` or `Uint8Array`.
 * @returns Extracted text data including per‑page information and an
 *          optional concatenated full text.
 */
export async function extractPdfText(
  pdfBytes: Uint8Array | Buffer,
): Promise<ExtractedPdfText> {
  if (!pdfBytes || pdfBytes.length === 0) {
    throw new PdfTextExtractionError("PDF data is empty");
  }

  // Ensure we are working with a Uint8Array.
  const bytes = pdfBytes instanceof Buffer ? new Uint8Array(pdfBytes) : pdfBytes;

  try {
    // Create a proxy that represents the PDF document.
    const pdf = await getDocumentProxy(bytes);
    // Extract text per page.
    const { totalPages, text } = await extractText(pdf, {
      mergePages: false,
    });

    if (!Array.isArray(text) || text.length !== totalPages) {
      throw new Error("Unexpected text extraction result format");
    }

    const pages: PageText[] = text.map((txt, idx) => ({
      pageNumber: idx + 1,
      text: txt,
    }));

    const fullText = pages.map((p) => p.text).join("\n");

    return {
      pageCount: totalPages,
      pages,
      fullText,
    };
  } catch (err) {
    throw new PdfTextExtractionError("Failed to extract text from PDF", err);
  }
}
