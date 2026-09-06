// Ambient declaration so the runtime system prompt (remote-agent/prompt.md)
// can be imported as a string. esbuild provides the actual text via
// `--loader:.md=text` on every esbuild invocation that bundles packager.ts.
declare module "*.md" {
  const content: string;
  export default content;
}
