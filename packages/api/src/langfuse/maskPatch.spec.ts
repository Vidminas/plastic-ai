import path from 'path';
import { createRequire } from 'module';
import { createGuardrailTraceMask } from './mask';

/**
 * Guards patches/@librechat+agents+*.patch: without it, @librechat/agents has no `mask`
 * option, and traces would be exported unmasked while `piiMasking` is set.
 * Exports a span through the patched span processor and checks what reaches the exporter,
 * including the fields `@langfuse/otel`'s own `mask` never sees.
 */
describe('@librechat/agents Langfuse mask patch', () => {
  const entry = require.resolve('@librechat/agents');
  const dist = path.join(entry.slice(0, entry.lastIndexOf(`${path.sep}dist${path.sep}`)), 'dist');
  /** Resolves modules as @librechat/agents does, so the test uses the copies it uses. */
  const agentsRequire = createRequire(entry);
  const { createLangfuseSpanProcessor } = agentsRequire(
    path.join(dist, 'cjs', 'langfuseToolOutputTracing.cjs'),
  );
  const { getLangfuseSpanProcessorParams } = agentsRequire(
    path.join(dist, 'cjs', 'langfuseSpanRegistry.cjs'),
  );
  const { BasicTracerProvider } = agentsRequire('@opentelemetry/sdk-trace-base');
  const { LangfuseOtelSpanAttributes: attr } = agentsRequire('@langfuse/tracing');

  it('masks every content field of an exported span', async () => {
    const exported: Array<{
      attributes: Record<string, unknown>;
      status: { message?: string };
      events: Array<{ name: string; attributes?: Record<string, unknown> }>;
    }> = [];
    const exporter = {
      export: (spans: typeof exported, done: (result: { code: number }) => void) => {
        exported.push(...spans);
        done({ code: 0 });
      },
      shutdown: async () => undefined,
    };
    const mask = createGuardrailTraceMask(async (text) => text.replace(/\S+@\S+\.\w+/g, '{EMAIL}'));
    const langfuse = { publicKey: 'pk', secretKey: 'sk', baseUrl: 'https://langfuse.test', mask };
    const processor = createLangfuseSpanProcessor(
      { ...getLangfuseSpanProcessorParams(langfuse), exporter, shouldExportSpan: () => true },
      langfuse,
    );
    const provider = new BasicTracerProvider({ spanProcessors: [processor] });
    const span = provider.getTracer('mask-patch').startSpan('llm');
    span.setAttributes({
      [attr.OBSERVATION_INPUT]: JSON.stringify([{ content: 'Write to sam@example.com' }]),
      [`${attr.OBSERVATION_METADATA}.toolArtifact`]: 'found sam@example.com',
      [attr.OBSERVATION_MODEL]: 'claude',
    });
    span.recordException(new Error('failed for sam@example.com'));
    span.setStatus({ code: 2, message: 'rejected sam@example.com' });
    span.end();
    await processor.forceFlush();
    await provider.shutdown();

    const [result] = exported;
    expect(JSON.stringify(result.attributes)).not.toContain('sam@example.com');
    expect(result.attributes[`${attr.OBSERVATION_METADATA}.toolArtifact`]).toBe('found {EMAIL}');
    expect(JSON.parse(result.attributes[attr.OBSERVATION_INPUT] as string)).toEqual([
      { content: 'Write to {EMAIL}' },
    ]);
    expect(result.attributes[attr.OBSERVATION_MODEL]).toBe('claude');
    expect(result.status.message).toBe('rejected {EMAIL}');
    const exception = result.events.find((event) => event.name === 'exception');
    expect(JSON.stringify(exception?.attributes)).not.toContain('sam@example.com');
  });
});
