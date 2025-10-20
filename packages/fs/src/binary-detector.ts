
const TEXT_EXTENSIONS = new Set([
    'txt', 'md', 'json', 'xml', 'html', 'css', 'js', 'ts', 'jsx', 'tsx',
    'py', 'java', 'c', 'cpp', 'h', 'cs', 'php', 'rb', 'go', 'rs',
    'yml', 'yaml', 'toml', 'ini', 'sh', 'sql', 'csv', 'log', 'env',
]);

const BINARY_EXTENSIONS = new Set([
    'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'ico', 'svg',
    'pdf', 'zip', 'tar', 'gz', 'rar', '7z',
    'exe', 'dll', 'so',
    'mp3', 'mp4', 'avi', 'mov', 'wav', 'flac', 'ogg', 'webm',
    'ttf', 'otf', 'woff', 'woff2', 'eot',
    'db', 'sqlite',
]);

export async function isBinaryFile(file: File): Promise<boolean> {
    const ext = file.name.toLowerCase().split('.').pop() || '';

    if (TEXT_EXTENSIONS.has(ext)) return false;
    if (BINARY_EXTENSIONS.has(ext)) return true;

    const sample = new Uint8Array(await file.slice(0, 8192).arrayBuffer());

    if (sample.indexOf(0x00) !== -1) return true;

    try {
        new TextDecoder('utf-8', { fatal: true }).decode(sample);
        return false;
    } catch {
        return true;
    }
}

export function isBinaryFromContent(content: Uint8Array, filename: string): boolean {
    const ext = filename.toLowerCase().split('.').pop() || '';

    if (TEXT_EXTENSIONS.has(ext)) return false;
    if (BINARY_EXTENSIONS.has(ext)) return true;

    const sample = content.slice(0, Math.min(8192, content.length));

    if (sample.indexOf(0x00) !== -1) return true;

    try {
        new TextDecoder('utf-8', { fatal: true }).decode(sample);
        return false;
    } catch {
        return true;
    }
}
