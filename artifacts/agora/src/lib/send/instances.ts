/**
 * Public Send instances. Sourced from https://github.com/timvisee/send-instances/
 * (the canonical list maintained by the Send protocol author). Instances are
 * selected randomly; a failed upload retries against a different instance
 * before giving up. Public Send servers go up and down frequently — the
 * canonical list includes live uptime status badges at:
 *   https://tdulcet.github.io/send-instances-status/
 */
export const SEND_INSTANCES: readonly string[] = [
  "https://send.vis.ee",       // 2.5GiB / 3 days / 10 DL  (maintainer instance)
  "https://send.mni.li",       // 8GiB   / 7 days / 25 DL
  "https://send.monks.tools",  // 5GiB   / 7 days / 50 DL
  "https://send.adminforge.de", // 8GiB  / 7 days / 1000 DL
  "https://send.turingpoint.de", // 10GiB / 7 days / 10 DL
];

export function pickRandomSendInstance(): string {
  const i = Math.floor(Math.random() * SEND_INSTANCES.length);
  return SEND_INSTANCES[i];
}
