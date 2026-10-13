# Dependency patches

`npm install` and `npm ci` apply these with [patch-package](https://github.com/ds300/patch-package)
(the root `postinstall` script). Both Dockerfiles copy this directory in before installing. Drop
a patch once the dependency ships the change; `patch-package` warns when a patch no longer
applies to the installed version.

## `@librechat+agents+4.0.4.patch`: mask Langfuse trace content

With `piiMasking` set, trace content is masked with its Bedrock guardrail
(`packages/api/src/langfuse/mask.ts`), through a `LangfuseConfig.mask` option that
`@librechat/agents` 4.0.4 doesn't have. `@langfuse/otel`'s own `mask` isn't enough: it sees
only the input, output and whole metadata of traces and observations, never per-key metadata
(where tool results also land), model parameters, status messages or exceptions. The patch
applies the mask to all of these in the library's span processor.
`packages/api/src/langfuse/maskPatch.spec.ts` exports a span through the patched processor
and fails if any of them reach the exporter unmasked.

The patch is the built `dist/` of v4.0.4 plus one change, proposed upstream on
`feat/langfuse-mask` in `Vidminas/librechat-agents` (stacked there on
LibreChat-AI/agents#440, which the patch leaves out). Source maps are left out, so stack
traces in the patched files point at the unpatched sources. A local build of v4.0.4 matches
the published `dist/` byte for byte, so the patch holds only this change. To regenerate it:

```bash
cd ../librechat-agents
git switch tmp/patch-mask-only # v4.0.4 plus the change, without #440
npm run build
rm -rf ../plastic-ai/node_modules/@librechat/agents/dist
cp -R dist ../plastic-ai/node_modules/@librechat/agents/dist
cd ../plastic-ai && npx patch-package @librechat/agents --exclude 'package\.json$|\.map$'
```

Drop the patch once a release includes `LangfuseConfig.mask`.
