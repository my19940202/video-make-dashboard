import { spawn } from 'node:child_process';

export async function runCommand(command: string, args: string[], cwd: string, timeoutMs = 600_000, input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    if (input !== undefined) child.stdin?.end(input);
    let output = '';
    const capture = (chunk: Buffer) => { output = (output + chunk.toString()).slice(-24_000); };
    child.stdout?.on('data', capture);
    child.stderr?.on('data', capture);
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else reject(new Error(`${command} exited ${code}: ${output.slice(-4000)}`));
    });
  });
}
