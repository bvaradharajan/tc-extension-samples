# Trimble Connect sample extensions

Eight static Trimble Connect extensions for testing custom manifests and access token consent. They come in two identical sets, so you can test more than one custom extension at a time.

| Folder | extensionType | Calls `requestPermission("accesstoken")` |
| --- | --- | --- |
| `set1/viewer-basic`, `set2/viewer-basic` | `3dviewer` | no |
| `set1/viewer-consent`, `set2/viewer-consent` | `3dviewer` | yes, automatically when the viewer panel is visible |
| `set1/project-basic`, `set2/project-basic` | `project` | no |
| `set1/project-consent`, `set2/project-consent` | `project` | yes, automatically when opened from project navigation |

Every page has a **Token scope** section. It decodes the JWT payload of any access token the page receives and shows `scope` (or `scp`), `aud`, `azp`, `sub`, `iss`, `iat` and `exp`. The claims are also logged to the browser console. A token can arrive from `requestPermission`, from `getPermission`, or from an `extension.accessToken` event. Basic pages never call `requestPermission` or `getPermission`, because in tcweb both can open the consent dialog. They only show a scope if the host pushes a token on its own.

All pages load `shared/extension.js`. Each page's `window.EXT_CONFIG` picks the behaviour: `kind` is `"viewer"` or `"project"`, and `requestPermission` is `true` or `false`.

## Build

Trimble Connect uses the manifest `url` and `icon` exactly as written, so they must be absolute https URLs. Templates use `{{BASE_URL}}`, and the build fills it in:

```
node build.mjs https://<user>.github.io/tc-extension-samples
```

The output is written to `dist/`, with one `manifest.json` per extension. Node 18 or later is required, with no dependencies.

## Deploy (free hosts)

The host must serve over https, send `Access-Control-Allow-Origin` (tcweb loads the manifest with `fetch`), and allow iframing.

### GitHub Pages (recommended)

1. Push this folder to a new GitHub repository named `tc-extension-samples`, on the `main` branch.
2. In the repository, go to Settings → Pages → Build and deployment, and set Source to **GitHub Actions**.
3. `.github/workflows/pages.yml` runs `build.mjs` with the Pages URL and deploys `dist/`. Every push to `main` redeploys.

GitHub Pages already sends `Access-Control-Allow-Origin: *`.

### Netlify

Run `node build.mjs https://<site-name>.netlify.app`, then drag `dist/` onto https://app.netlify.com/drop. The `_headers` file adds CORS.

### Cloudflare Pages

Run `node build.mjs https://<project>.pages.dev`, then run `npx wrangler pages deploy dist --project-name <project>`, or upload `dist/` in the dashboard. `_headers` adds CORS.

### Vercel

Run `node build.mjs https://<project>.vercel.app`, then run `npx vercel deploy dist --prod`. `vercel.json` adds CORS.

## Local check

```
node build.mjs http://localhost:8080
npx http-server dist -p 8080 --cors
```

Open http://localhost:8080 for the manifest list. Trimble Connect needs the https build to embed the extensions.

## Add to Trimble Connect

1. Open the hosted root `index.html`. It lists all 8 manifest URLs with Copy buttons.
2. In a project, go to Settings → Apps & Capabilities → Add custom capability, and paste a manifest URL.
3. Check each extension:
   - **Project basic:** has a navigation entry and shows no consent dialog.
   - **Project consent:** shows the Allow/Deny dialog when opened from navigation.
   - **Viewer basic:** appears as a 3D viewer panel, with no dialog.
   - **Viewer consent:** shows the dialog when its panel opens.
   - **Set 2:** its extensions appear as separate rows next to Set 1.
4. To prompt again after Allow or Deny, go to Apps & Capabilities → row menu → **Reset permission**.

The pages contain no secrets and show only a masked token. Check your company's policy before hosting on a public personal account.
