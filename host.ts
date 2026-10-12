// bb.host entry for bb-plugin-beads: full-trust Node worker that spawns the
// `bd` (beads) CLI on this machine. The server entry reaches it through the
// shared contract in contract.ts.
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { spawn } from "node:child_process";
import { hostContract, hostSignals } from "./contract.js";

const MAX_CAPTURE = 128 * 1024;

function cap(text: string): string {
  return text.length > MAX_CAPTURE
    ? `${text.slice(0, MAX_CAPTURE)}\n... [truncated]`
    : text;
}

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function runCommand(
  command: string,
  args: readonly string[],
  cwd: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<RunResult> {
  const { promise, resolve, reject } = Promise.withResolvers<RunResult>();
  if (signal.aborted) {
    reject(new Error("aborted before start"));
    return promise;
  }
    const child = spawn(command, [...args], {
      cwd,
      env: process.env,
      signal,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (stdout.length < MAX_CAPTURE) stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < MAX_CAPTURE) stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: timedOut ? 124 : (code ?? 1),
        stdout: cap(stdout),
        stderr: timedOut ? `${cap(stderr)}\n... [timed out after ${timeoutMs}ms]` : cap(stderr),
        timedOut,
      });
    });
  return promise;
}

export default experimental_defineHostEntry({
  contract: hostContract,
  experimental_signals: hostSignals,
  handlers: {
    bd_check: async ({ bdPath }, context) => {
      try {
        const result = await runCommand(
          bdPath,
          ["--version"],
          ".",
          10_000,
          context.signal,
        );
        const version = result.stdout.trim() || result.stderr.trim();
        return { ok: result.exitCode === 0, version, error: result.exitCode === 0 ? null : version };
      } catch (error) {
        return {
          ok: false,
          version: "",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    bd_run: async ({ args, cwd, bdPath, timeoutMs }, context) => {
      const result = await runCommand(bdPath, args, cwd, timeoutMs, context.signal);
      return result;
    },
  },
});
