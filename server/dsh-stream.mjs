// A native Cordis observation plugin: the SDK persists session events, while
// these transient frames let Nota render tokens before a message is committed.
export const name = 'nota-stream';
export const inject = ['agents'];
export function apply(ctx) {
  ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    process.stdout.write(JSON.stringify({ method: 'nota.stream', params: { sessionId: String(agent.session.id), frame } }) + '\n');
  });
}
