#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { glob } = require('glob');

/**
 * Removes inline comments from TypeScript and Rust source files
 * while preserving docstrings, multi-line comments, and important annotations
 */

class CommentRemover {
    constructor() {
        this.stats = {
            filesProcessed: 0,
            filesModified: 0,
            commentsRemoved: 0
        };
    }

    /**
     * Process TypeScript/JavaScript files
     */
    processTypeScriptFile(content) {
        const lines = content.split('\n');
        const processedLines = [];
        let inMultiLineComment = false;
        let inJsDoc = false;
        let inString = false;
        let stringChar = null;
        let modified = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            let processedLine = '';
            let j = 0;

            while (j < line.length) {
                // Handle multi-line comment start
                if (!inString && !inMultiLineComment && !inJsDoc && 
                    j < line.length - 1 && line[j] === '/' && line[j + 1] === '*') {
                    
                    // Check if it's a JSDoc comment
                    if (j < line.length - 2 && line[j + 2] === '*') {
                        inJsDoc = true;
                        processedLine += line.substring(j);
                        break;
                    } else {
                        inMultiLineComment = true;
                        processedLine += line.substring(j);
                        break;
                    }
                }

                // Handle multi-line comment end
                if ((inMultiLineComment || inJsDoc) && j < line.length - 1 && 
                    line[j] === '*' && line[j + 1] === '/') {
                    processedLine += '*/';
                    j += 2;
                    inMultiLineComment = false;
                    inJsDoc = false;
                    continue;
                }

                // If in multi-line comment or JSDoc, keep everything
                if (inMultiLineComment || inJsDoc) {
                    processedLine += line.substring(j);
                    break;
                }

                // Handle string literals
                if (!inString && (line[j] === '"' || line[j] === "'" || line[j] === '`')) {
                    inString = true;
                    stringChar = line[j];
                    processedLine += line[j];
                    j++;
                    continue;
                } else if (inString && line[j] === stringChar) {
                    // Check for escaped quotes
                    let escapeCount = 0;
                    let k = j - 1;
                    while (k >= 0 && line[k] === '\\') {
                        escapeCount++;
                        k--;
                    }
                    if (escapeCount % 2 === 0) {
                        inString = false;
                        stringChar = null;
                    }
                    processedLine += line[j];
                    j++;
                    continue;
                }

                // Handle single-line comments
                if (!inString && j < line.length - 1 && line[j] === '/' && line[j + 1] === '/') {
                    const restOfLine = line.substring(j);
                    
                    // Preserve special comments
                    if (restOfLine.match(/^\s*\/\/\s*@ts-/i) ||           // TypeScript directives
                        restOfLine.match(/^\s*\/\/\s*@jsx/i) ||           // JSX pragma
                        restOfLine.match(/^\s*\/\/\s*eslint-/i) ||        // ESLint directives
                        restOfLine.match(/^\s*\/\/\s*prettier-/i) ||      // Prettier directives
                        restOfLine.match(/^\s*\/\/\s*#/)) {               // Source map URLs
                        processedLine += restOfLine;
                        break;
                    }
                    
                    // Check if this is a standalone comment line (preserve if module/file level)
                    const trimmedBefore = processedLine.trim();
                    if (trimmedBefore === '' && i < 10) {
                        // Keep top-of-file comments (likely module comments)
                        processedLine = line;
                        break;
                    }
                    
                    // Remove inline comment
                    if (trimmedBefore !== '') {
                        // This is an inline comment after code
                        processedLine = processedLine.trimEnd();
                        modified = true;
                        this.stats.commentsRemoved++;
                    } else {
                        // This is a standalone comment line in the middle of the file - remove it
                        modified = true;
                        this.stats.commentsRemoved++;
                        processedLine = '';
                    }
                    break;
                }

                processedLine += line[j];
                j++;
            }

            processedLines.push(processedLine);
        }

        return { content: processedLines.join('\n'), modified };
    }

    /**
     * Process Rust files
     */
    processRustFile(content) {
        const lines = content.split('\n');
        const processedLines = [];
        let inMultiLineComment = false;
        let inDocComment = false;
        let inString = false;
        let inRawString = false;
        let rawStringHashes = 0;
        let modified = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            let processedLine = '';
            let j = 0;

            while (j < line.length) {
                // Handle multi-line comment start
                if (!inString && !inRawString && !inMultiLineComment && !inDocComment && 
                    j < line.length - 1 && line[j] === '/' && line[j + 1] === '*') {
                    
                    // Check if it's a doc comment
                    if (j < line.length - 2 && (line[j + 2] === '!' || line[j + 2] === '*')) {
                        inDocComment = true;
                        processedLine += line.substring(j);
                        break;
                    } else {
                        inMultiLineComment = true;
                        processedLine += line.substring(j);
                        break;
                    }
                }

                // Handle multi-line comment end
                if ((inMultiLineComment || inDocComment) && j < line.length - 1 && 
                    line[j] === '*' && line[j + 1] === '/') {
                    processedLine += '*/';
                    j += 2;
                    inMultiLineComment = false;
                    inDocComment = false;
                    continue;
                }

                // If in multi-line comment or doc comment, keep everything
                if (inMultiLineComment || inDocComment) {
                    processedLine += line.substring(j);
                    break;
                }

                // Handle raw string literals (r#"..."#)
                if (!inString && !inRawString && line[j] === 'r') {
                    let hashes = 0;
                    let k = j + 1;
                    while (k < line.length && line[k] === '#') {
                        hashes++;
                        k++;
                    }
                    if (k < line.length && line[k] === '"') {
                        inRawString = true;
                        rawStringHashes = hashes;
                        processedLine += line.substring(j, k + 1);
                        j = k + 1;
                        continue;
                    }
                }

                // Handle raw string end
                if (inRawString && line[j] === '"') {
                    let hashes = 0;
                    let k = j + 1;
                    while (k < line.length && line[k] === '#' && hashes < rawStringHashes) {
                        hashes++;
                        k++;
                    }
                    if (hashes === rawStringHashes) {
                        inRawString = false;
                        processedLine += line.substring(j, k);
                        j = k;
                        continue;
                    }
                }

                // Handle regular string literals
                if (!inString && !inRawString && line[j] === '"') {
                    inString = true;
                    processedLine += line[j];
                    j++;
                    continue;
                } else if (inString && line[j] === '"') {
                    // Check for escaped quotes
                    let escapeCount = 0;
                    let k = j - 1;
                    while (k >= 0 && line[k] === '\\') {
                        escapeCount++;
                        k--;
                    }
                    if (escapeCount % 2 === 0) {
                        inString = false;
                    }
                    processedLine += line[j];
                    j++;
                    continue;
                }

                // Handle single-line comments
                if (!inString && !inRawString && j < line.length - 1 && 
                    line[j] === '/' && line[j + 1] === '/') {
                    const restOfLine = line.substring(j);
                    
                    // Preserve doc comments
                    if (restOfLine.match(/^\s*\/\/[/!]/)) {
                        processedLine += restOfLine;
                        break;
                    }
                    
                    // Preserve special attributes and directives
                    if (restOfLine.match(/^\s*\/\/\s*#\[/) ||            // Attributes
                        restOfLine.match(/^\s*\/\/\s*clippy::/i) ||      // Clippy directives
                        restOfLine.match(/^\s*\/\/\s*rustfmt::/i)) {     // Rustfmt directives
                        processedLine += restOfLine;
                        break;
                    }
                    
                    // Check if this is a standalone comment line
                    const trimmedBefore = processedLine.trim();
                    if (trimmedBefore === '' && i < 10) {
                        // Keep top-of-file comments (likely module comments)
                        processedLine = line;
                        break;
                    }
                    
                    // Remove inline comment
                    if (trimmedBefore !== '') {
                        // This is an inline comment after code
                        processedLine = processedLine.trimEnd();
                        modified = true;
                        this.stats.commentsRemoved++;
                    } else {
                        // This is a standalone comment line - remove it
                        modified = true;
                        this.stats.commentsRemoved++;
                        processedLine = '';
                    }
                    break;
                }

                processedLine += line[j];
                j++;
            }

            processedLines.push(processedLine);
        }

        return { content: processedLines.join('\n'), modified };
    }

    /**
     * Process a single file
     */
    processFile(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        const content = fs.readFileSync(filePath, 'utf8');
        let result;

        if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
            result = this.processTypeScriptFile(content);
        } else if (ext === '.rs') {
            result = this.processRustFile(content);
        } else {
            return;
        }

        this.stats.filesProcessed++;

        if (result.modified) {
            if (!this.dryRun) {
                fs.writeFileSync(filePath, result.content, 'utf8');
            }
            this.stats.filesModified++;
            console.log(`✓ Modified: ${filePath}`);
        } else if (this.verbose) {
            console.log(`- Skipped: ${filePath} (no inline comments found)`);
        }
    }

    /**
     * Process all files matching the pattern
     */
    async processFiles(pattern, options = {}) {
        this.dryRun = options.dryRun || false;
        this.verbose = options.verbose || false;

        const files = await glob(pattern, {
            ignore: [
                '**/node_modules/**',
                '**/target/**',
                '**/dist/**',
                '**/build/**',
                '**/.git/**',
                '**/vendor/**'
            ]
        });

        if (files.length === 0) {
            console.log('No files found matching the pattern.');
            return;
        }

        console.log(`Found ${files.length} files to process...\n`);

        for (const file of files) {
            try {
                this.processFile(file);
            } catch (error) {
                console.error(`✗ Error processing ${file}: ${error.message}`);
            }
        }

        console.log('\n=== Summary ===');
        console.log(`Files processed: ${this.stats.filesProcessed}`);
        console.log(`Files modified: ${this.stats.filesModified}`);
        console.log(`Comments removed: ${this.stats.commentsRemoved}`);
        
        if (this.dryRun) {
            console.log('\n(Dry run - no files were actually modified)');
        }
    }
}

// CLI interface
async function main() {
    const args = process.argv.slice(2);
    
    if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
        console.log(`
Usage: node remove-inline-comments.js [options] [pattern]

Options:
  -h, --help      Show this help message
  -d, --dry-run   Preview changes without modifying files
  -v, --verbose   Show all processed files, even if not modified
  --ts-only       Process only TypeScript/JavaScript files
  --rust-only     Process only Rust files

Examples:
  node remove-inline-comments.js                     # Process all TS and Rust files
  node remove-inline-comments.js --dry-run          # Preview changes
  node remove-inline-comments.js --ts-only          # Process only TS files
  node remove-inline-comments.js "src/**/*.ts"      # Process specific pattern
`);
        process.exit(0);
    }

    const remover = new CommentRemover();
    const options = {
        dryRun: args.includes('--dry-run') || args.includes('-d'),
        verbose: args.includes('--verbose') || args.includes('-v')
    };

    let pattern = '**/*.{ts,tsx,js,jsx,rs}';
    
    if (args.includes('--ts-only')) {
        pattern = '**/*.{ts,tsx,js,jsx}';
    } else if (args.includes('--rust-only')) {
        pattern = '**/*.rs';
    } else {
        // Check if a custom pattern was provided
        const customPattern = args.find(arg => !arg.startsWith('-'));
        if (customPattern) {
            pattern = customPattern;
        }
    }

    console.log(`Processing files matching: ${pattern}`);
    if (options.dryRun) {
        console.log('(DRY RUN MODE - no files will be modified)\n');
    }

    await remover.processFiles(pattern, options);
}

main().catch(error => {
    console.error('Error:', error);
    process.exit(1);
});
