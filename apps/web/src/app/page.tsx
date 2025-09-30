import FileUploader from '../components/FileUploader';

export default function Home() {
  return (
    <div className="font-sans min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <div className="container mx-auto px-4 py-8">
        <header className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2">Conduit WASM File System</h1>
          <p className="text-gray-600 dark:text-gray-400">
            Test file loading and indexing with WebAssembly
          </p>
        </header>

        <main>
          <FileUploader />
        </main>

        <footer className="mt-12 text-center text-sm text-gray-500 dark:text-gray-400">
          <p>Powered by Rust WASM + Next.js</p>
        </footer>
      </div>
    </div>
  );
}