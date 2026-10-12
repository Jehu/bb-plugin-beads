import { defineRpcContract, type ExperimentalHostSignals } from "@get-bb/plugin-sdk";
import { z } from "zod";

// The server entry and the bb.host entry share this contract.
export const hostContract = defineRpcContract({
  bd_check: {
    input: z.object({ bdPath: z.string().min(1) }).strict(),
    output: z
      .object({
        ok: z.boolean(),
        version: z.string(),
        error: z.string().nullable(),
      })
      .strict(),
  },
  bd_run: {
    input: z
      .object({
        args: z.array(z.string()).min(1).max(32),
        cwd: z.string().min(1),
        bdPath: z.string().min(1),
        timeoutMs: z.number().int().min(1000).max(1_800_000),
      })
      .strict(),
    output: z
      .object({
        exitCode: z.number().int(),
        stdout: z.string(),
        stderr: z.string(),
        timedOut: z.boolean(),
      })
      .strict(),
  },
});

export const hostSignals = {} satisfies ExperimentalHostSignals;

