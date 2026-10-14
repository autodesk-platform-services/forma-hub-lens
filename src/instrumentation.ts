/** Keep Node-only imports inside the runtime branch so Next can build Edge code. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerNodeInstrumentation } = await import("./instrumentation-node");
    await registerNodeInstrumentation();
  }
}
