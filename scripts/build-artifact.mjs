// Собирает версию AI COURT для claude.ai: одна HTML-страница, которая вызывает
// Claude через подписку зрителя (capability `sample`) и хранит дела в хранилище
// артефакта (capability `db`). React подключается с cdnjs, остальное — внутри файла.
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const src = (p) => path.join(root, "src", p);
const REACT_VERSION = "18.3.1";

/** Подмены модулей: серверный API → локальный, React → глобальные UMD-объекты. */
const artifactPlugin = {
  name: "ai-court-artifact",
  setup(b) {
    const localApi = { path: src("artifact/localApi.ts") };
    b.onResolve({ filter: /^@\/client\/api$/ }, () => localApi);
    b.onResolve({ filter: /^\.\/api$/ }, (a) => (path.resolve(a.resolveDir) === src("client") ? localApi : undefined));
    b.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "stub" }));
    b.onResolve({ filter: /^react(-dom)?(\/client|\/jsx-runtime)?$/ }, (a) => ({ path: a.path, namespace: "global" }));
    b.onResolve({ filter: /^@\// }, (a) => {
      const base = src(a.path.slice(2));
      for (const ext of ["", ".ts", ".tsx", "/index.ts"]) if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return { path: base + ext };
      return undefined;
    });
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export {};", loader: "js" }));
    b.onLoad({ filter: /.*/, namespace: "global" }, (a) => {
      if (a.path === "react/jsx-runtime") {
        return {
          loader: "js",
          contents: `const R = window.React;
export const Fragment = R.Fragment;
export function jsx(type, props, key) { return R.createElement(type, key === undefined ? props : { ...props, key }); }
export const jsxs = jsx;`,
        };
      }
      const g = a.path.startsWith("react-dom") ? "window.ReactDOM" : "window.React";
      return { loader: "js", contents: `module.exports = ${g};` };
    });
  },
};

const result = await build({
  entryPoints: [src("artifact/main.tsx")],
  bundle: true,
  write: false,
  outfile: "out.js",
  format: "iife",
  platform: "browser",
  target: ["safari16", "chrome115"],
  jsx: "automatic",
  minify: true,
  legalComments: "none",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [artifactPlugin],
  logLevel: "warning",
  metafile: true,
});

// Страница не должна обращаться к серверному API: такие вызовы означают, что подмена не сработала.
if (result.outputFiles[0].text.includes("/api/cases")) throw new Error("В сборку попал серверный API-клиент");
const js = result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const css = fs.readFileSync(src("app/globals.css"), "utf8");

const html = `<title>AI COURT</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap">
<style>
${css}
</style>
<div id="root"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react/${REACT_VERSION}/umd/react.production.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/${REACT_VERSION}/umd/react-dom.production.min.js"></script>
<script>
${js}
</script>
`;

const out = path.join(root, "dist", "ai-court.html");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`dist/ai-court.html — ${(html.length / 1024).toFixed(0)} KB`);

if (process.env.ANALYZE) {
  const sizes = {};
  for (const [file, info] of Object.entries(result.metafile.outputs[Object.keys(result.metafile.outputs)[0]].inputs)) {
    const key = file.includes("node_modules/") ? file.split("node_modules/")[1].split("/").slice(0, file.includes("node_modules/@") ? 2 : 1).join("/") : "src";
    sizes[key] = (sizes[key] ?? 0) + info.bytesInOutput;
  }
  console.log(Object.entries(sizes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${(v / 1024).toFixed(0)} KB`).join("\n"));
}
