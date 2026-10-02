declare const __MANABI_BASE_PATH__: string;
interface ImportMeta { readonly env: Record<string, string | boolean | undefined>; }

declare module '*.wasm' { const url: string; export default url; }
declare module '*.onnx' { const url: string; export default url; }
declare module '*.css';

declare module '*.woff2' { const url: string; export default url; }
declare module '*.ttf' { const url: string; export default url; }
declare module '*.otf' { const url: string; export default url; }
