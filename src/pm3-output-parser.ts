// Strip ANSI escape codes from pm3 output
// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?\x07/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, "");
}
