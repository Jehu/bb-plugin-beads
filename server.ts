// bb-plugin-beads — integrate the beads issue tracker (https://beads.gascity.com)
// into BB.
//
// Headless plugin with three surfaces:
//  1. The `beads` agent tool: runs `bd` commands in the thread's environment
//     checkout through the plugin's bb.host worker.
//  2. The `bb beads` CLI: same passthrough from a shell.
//  3. skills/beads/SKILL.md: standing instructions for agents.
import { PLUGIN_CLI_OUTPUT_MAX_BYTES, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { hostContract, hostSignals } from "./contract.js";

const BD_TIMEOUT_MS = 5 * 60_000;
const TOOL_OUTPUT_MAX = 20_000;

interface ThreadEnv {
  cwd: string;
  hostId: string;
}

function truncate(text: string, max: number): string {
  return text.length > max
    ? `${text.slice(0, max)}\n... [output truncated at ${max} characters]`
    : text;
}

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");

  const settings = bb.settings.define({
    bdPath: {
      type: "string",
      label: "Path to the `bd` beads CLI",
      default: "bd",
    },
  });
  const { bdPath } = await settings.get();

  const host = bb.hosts.experimental_client({
    contract: hostContract,
    experimental_signals: hostSignals,
  });

  // Environment path + host per thread, captured at turn start by
  // bb.agents.configure so tool executions (which only carry threadId) can
  // run bd in the right checkout on the right machine.
  const threadEnvs = new Map<string, ThreadEnv>();
  bb.onDispose(() => threadEnvs.clear());

  async function resolveEnv(
    threadId: string | null,
    fallbackCwd?: string,
  ): Promise<ThreadEnv | null> {
    if (threadId !== null) {
      const env = threadEnvs.get(threadId);
      if (env !== undefined) return env;
    }
    // CLI without thread context: run in the invoking shell's directory on
    // the first known host (the local machine). Never fall back to a bare
    // cwd — `bd init` would mutate whatever directory the host worker sits in.
    if (fallbackCwd != null && fallbackCwd !== "") {
      try {
        const hosts = await bb.sdk.hosts.list();
        const first = hosts[0];
        if (first != null) return { cwd: fallbackCwd, hostId: first.id };
      } catch {
        // ignore
      }
    }
    return null;
  }

  interface BdRun {
    exitCode: number;
    stdout: string;
    stderr: string;
    timedOut: boolean;
  }

  const noCwdError =
    "No working directory to run `bd` in. Run the command from a BB thread " +
    "(uses the thread's environment checkout) or from inside a project " +
    "directory with `bb beads -- <args...>`.";

  async function runBd(
    args: readonly string[],
    options: { threadId: string | null; signal?: AbortSignal; fallbackCwd?: string },
  ): Promise<{ result: BdRun | null; error: string | null }> {
    if (args.length === 0) return { result: null, error: "No bd arguments given." };
    const env = await resolveEnv(options.threadId, options.fallbackCwd);
    if (env === null) return { result: null, error: noCwdError };
    let result: BdRun;
    try {
      result = await host.call(
        "bd_run",
        { args: [...args], cwd: env.cwd, bdPath, timeoutMs: BD_TIMEOUT_MS },
        { hostId: env.hostId, signal: options.signal, timeoutMs: BD_TIMEOUT_MS + 30_000 },
      );
    } catch (error) {
      return {
        result: null,
        error: `\`bd\` failed to start: ${error instanceof Error ? error.message : String(error)}
Check the "Path to the \`bd\` beads CLI" setting (currently "${bdPath}") with \`bb plugin config beads\`,
and install beads from https://beads.gascity.com if needed.`,
      };
    }
    return { result, error: null };
  }

  bb.agents.registerTool({
    name: "beads",
    description:
      "Run a `bd` (beads issue tracker, https://beads.gascity.com) command in this thread's environment checkout and return its output. " +
      'Start a session with args=["prime"] for the workflow context, find work with args=["ready"], query with ' +
      'args=["list","--open"] or args=["show","bd-a1b2"], plan with args=["create", ...], and record progress with ' +
      'args=["status","bd-a1b2","in_progress"] / args=["close","bd-a1b2"]. Many commands accept --json for structured output.',
    instructions:
      "Use the `beads` tool to manage the beads issue graph (https://beads.gascity.com) via the `bd` CLI. " +
      "Run `prime` first in a repo for the workflow protocol; pick work with `ready`; create work as children of an epic; " +
      "set status to in_progress before starting and close when done, adding a comment. Pass --json when parsing results.",
    parameters: z.object({
      args: z
        .array(z.string().min(1))
        .min(1)
        .max(32)
        .describe('bd CLI arguments, e.g. ["list"]'),
    }),
    async execute({ args }, ctx) {
      const { result, error } = await runBd(args, {
        threadId: ctx.threadId ?? null,
        signal: ctx.signal,
      });
      if (error !== null) {
        return { content: [{ type: "text", text: error }], isError: true };
      }
      const text = [result!.stdout.trim(), result!.stderr.trim()]
        .filter((part) => part !== "")
        .join("\n");
      const suffix = result!.timedOut ? "\n[bd timed out]" : "";
      return {
        content: [{ type: "text", text: `${truncate(text, TOOL_OUTPUT_MAX)}${suffix}` }],
        isError: result!.exitCode !== 0,
      };
    },
  });

  bb.agents.configure((context) => {
    const { path } = context.environment;
    if (path != null) {
      threadEnvs.set(context.thread.id, { cwd: path, hostId: context.host.id });
    } else {
      threadEnvs.delete(context.thread.id);
    }
    return { tools: ["beads"], skills: [] };
  });

  const usage = [
    "Usage:",
    "  bb beads -- <bd-args...>     Run any bd command, e.g. bb beads -- list",
    "  bb beads check               Verify the bd CLI is reachable and print its version",
    "",
    "Full command reference: https://beads.gascity.com/cli-reference/index.md",
  ].join("\n");

  bb.cli.register({
    name: "beads",
    summary: "Run beads (`bd`) issue-tracker commands through the plugin's host worker",
    commands: [
      {
        name: "check",
        summary: "Verify the bd CLI is reachable",
        usage: "bb beads check",
      },
      {
        name: "--",
        summary: "Pass arguments to bd",
        usage: "bb beads -- <bd-args...>",
      },
    ],
    async run(argv, ctx) {
      const json = argv.includes("--json");
      const positional = argv.filter((arg) => arg !== "--json");
      if (positional[0] === "check") {
        const env = await resolveEnv(ctx.threadId ?? null, ctx.cwd);
        if (env === null) return { exitCode: 1, stderr: noCwdError };
        try {
          const result = await host.call(
            "bd_check",
            { bdPath },
            { hostId: env.hostId, timeoutMs: 30_000 },
          );
          const text = result.ok
            ? `bd ${result.version}`
            : `bd not usable (${result.error ?? "unknown error"})`;
          return {
            exitCode: result.ok ? 0 : 1,
            stdout: json ? JSON.stringify(result) : text,
          };
        } catch (error) {
          return {
            exitCode: 1,
            stderr: `bd check failed: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }
      if (positional[0] === "--") positional.shift();
      if (positional.length === 0) return { exitCode: 0, stdout: usage };
      const { result, error } = await runBd(positional, {
        threadId: ctx.threadId ?? null,
        fallbackCwd: ctx.cwd,
      });
      if (error !== null) return { exitCode: 1, stderr: error };
      const out = `${result!.stdout}${result!.stderr}`;
      return {
        exitCode: result!.exitCode,
        stdout:
          out.length > PLUGIN_CLI_OUTPUT_MAX_BYTES
            ? `${out.slice(0, PLUGIN_CLI_OUTPUT_MAX_BYTES)}\n... [truncated]`
            : out,
      };
    },
  });

  bb.onDispose(() => {
    bb.log.info("disposed");
  });
}
