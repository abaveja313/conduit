import { createLogger } from '@conduit/shared';

const logger = createLogger('document-extractor');

/**
 * Extracts text content from various document formats
 */
export class DocumentExtractor {
    private static readonly SUPPORTED_EXTENSIONS = ['.pdf', '.docx'];

    /**
     * Check if a file is a supported document type
     */
    static isSupported(path: string): boolean {
        const extension = path.toLowerCase().substring(path.lastIndexOf('.'));
        return this.SUPPORTED_EXTENSIONS.includes(extension);
    }

    /**
     * Extract text from a PDF file as simple text
     */
    static async extractPdfHtml(arrayBuffer: ArrayBuffer): Promise<string> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let pdf: any = null;

        try {
            // Dynamic import to avoid bundling issues
            const pdfjsLib = await import('pdfjs-dist');

            // Set worker source for browser environment
            if (typeof window !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
                // Use unpkg CDN with HTTPS for better reliability
                // Version must match the installed pdfjs-dist version
                pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
            }

            const loadingTask = pdfjsLib.getDocument({
                data: arrayBuffer,
                useSystemFonts: true,
                disableFontFace: true,
                cMapPacked: true
            });

            pdf = await loadingTask.promise;
            const textParts: string[] = [];

            // Extract text from all pages
            for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                const page = await pdf.getPage(pageNum);

                try {
                    const textContent = await page.getTextContent();

                    // Simply join all text items with spaces
                    const pageText = textContent.items
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        .map((item: any) => item.str || '')
                        .filter((text: string) => text.trim())
                        .join(' ');

                    if (pageText) {
                        textParts.push(`Page ${pageNum}:\n${pageText}`);
                    }

                    // Clean up page resources
                    page.cleanup();
                } catch (pageError) {
                    logger.warn(`Failed to extract text from page ${pageNum}:`, pageError);
                    // Continue with other pages even if one fails
                }
            }

            return textParts.join('\n\n');
        } catch (error) {
            logger.error('Failed to extract PDF text:', error);
            throw new Error(`PDF extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
            // Clean up PDF resources
            if (pdf) {
                try {
                    pdf.cleanup();
                    pdf.destroy();
                } catch (cleanupError) {
                    logger.warn('Failed to cleanup PDF resources:', cleanupError);
                }
            }
        }
    }

    /**
     * Extract content from a DOCX file as HTML
     */
    static async extractDocxHtml(arrayBuffer: ArrayBuffer): Promise<string> {
        try {
            // Dynamic import to avoid bundling issues
            const mammoth = await import('mammoth');

            const htmlResult = await mammoth.convertToHtml({ arrayBuffer });

            if (htmlResult.messages.length > 0) {
                const significantMessages = htmlResult.messages.filter(
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (msg: any) => !msg.message.includes('Unrecognised paragraph style')
                );
                if (significantMessages.length > 0) {
                    logger.warn('DOCX extraction warnings:', significantMessages);
                }
            }

            // Return the HTML content with proper line breaks
            // Add line breaks after block elements to make it more readable
            return htmlResult.value
                .replace(/<\/(p|h[1-6]|div|section|article|header|footer|li|blockquote|pre)>/gi, '</$1>\n')
                .replace(/<br\s*\/?>/gi, '<br>\n')
                .replace(/(<ul>|<ol>|<table>)/gi, '\n$1\n')
                .replace(/(<\/ul>|<\/ol>|<\/table>)/gi, '\n$1\n');
        } catch (error) {
            logger.error('Failed to extract DOCX content:', error);
            throw new Error(`DOCX extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Extract text content from a document based on its extension
     */
    static async extractHtml(path: string, arrayBuffer: ArrayBuffer): Promise<string | null> {
        const extension = path.toLowerCase().substring(path.lastIndexOf('.'));

        try {
            switch (extension) {
                case '.pdf':
                    return await this.extractPdfHtml(arrayBuffer);
                case '.docx':
                    return await this.extractDocxHtml(arrayBuffer);
                default:
                    return null;
            }
        } catch (error) {
            logger.error(`Failed to extract content from ${path}:`, error);
            // Return null to indicate extraction failed, but don't throw
            // This allows the file to still be indexed even if extraction fails
            return null;
        }
    }

    /**
     * Legacy method for backward compatibility - redirects to extractHtml
     */
    static async extractText(path: string, arrayBuffer: ArrayBuffer): Promise<string | null> {
        return this.extractHtml(path, arrayBuffer);
    }
}
