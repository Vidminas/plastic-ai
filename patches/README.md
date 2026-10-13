# Dependency patches

`npm install` and `npm ci` apply these with [patch-package](https://github.com/ds300/patch-package)
(the root `postinstall` script). Both Dockerfiles copy this directory in before installing. Drop
a patch once the dependency ships the change; `patch-package` warns when a patch no longer
applies to the installed version.

## `@librechat+agents+4.0.4.patch`

The patch is the built `dist/` of v4.0.4 plus two changes: masking Langfuse trace content, and
reading Nova's `<thinking>` tags as reasoning. Regenerate it as described under the first one,
from `tmp/patch-mask-thinking`, which carries both.

### Mask Langfuse trace content

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
git switch tmp/patch-mask-thinking # v4.0.4 plus both changes, without #440
npm run build
rm -rf ../plastic-ai/node_modules/@librechat/agents/dist
cp -R dist ../plastic-ai/node_modules/@librechat/agents/dist
cd ../plastic-ai && npx patch-package @librechat/agents --exclude 'package\.json$|\.map$'
```

Drop the patch once a release includes `LangfuseConfig.mask`.

### Read Nova's `<thinking>` tags as reasoning

Amazon Nova models on Bedrock write their reasoning inline as `<thinking>...</thinking>`,
notably before a tool call such as `ask_user_question`. v4.0.4 recognises only `<think>`, and
only when one streamed chunk holds the whole tag, but Bedrock streams Nova's tags in pieces
(`"<thinking"`, then `">"`). So Nova's reasoning showed as answer text, tags and all. The patch:

- joins tags split across text deltas in the Converse stream, and emits each whole tag as one
  piece the smoother can't cut (`llm/bedrock/thinkTags.ts`; a fragment that never becomes a tag
  is released before the next stream event and at the end, so no text is lost);
- reads `<thinking>` and `</thinking>` as `<think>` and `</think>` in the stream handler
  (`normalizeThinkTags` in `stream.ts`).

The reasoning becomes a `think` part and shows as Thoughts; the model's own messages keep their
original text. Tested in `src/llm/bedrock/thinkTags.test.ts` and `src/specs/reasoning.test.ts`
on `tmp/patch-mask-thinking` in `Vidminas/librechat-agents`, and against Nova Lite in the
sandbox. Drop this change once a release reads Nova's `<thinking>` tags.
