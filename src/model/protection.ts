import type { Device, DeviceState } from './types';

/** One relay model, with a configurable protection function. Values are persisted. */
export const protectionFunctions = [
  { value: 0, label: 'Dòng điện cực đại', symbol: 'I>' },
  { value: 1, label: 'Dòng điện cực tiểu', symbol: 'I<' },
  { value: 2, label: 'Điện áp cực đại', symbol: 'U>' },
  { value: 3, label: 'Điện áp cực tiểu', symbol: 'U<' },
  { value: 4, label: 'Mất pha', symbol: 'L×' },
  { value: 5, label: 'Thứ tự pha', symbol: 'L↔' },
  { value: 6, label: 'Mất cân bằng pha', symbol: 'L≠' },
  { value: 7, label: 'Dòng rò / chạm đất', symbol: 'IΔ>' },
  { value: 8, label: 'Tần số cực đại', symbol: 'f>' },
  { value: 9, label: 'Tần số cực tiểu', symbol: 'f<' },
] as const;

export const getProtectionFunction = (value = 0) => protectionFunctions.find(item => item.value === value) ?? protectionFunctions[0];

/**
 * The current engine models continuity, not measured current/voltage/frequency.
 * `enabled=false` explicitly injects a test fault; it is never inferred from the
 * solver's unit potentials. A relay still requires its real A1–A2 supply loop.
 * Advance time once per tick, even if contact feedback needs multiple passes.
 */
export function protectionRelayState(device: Device, supplied: boolean, previous: DeviceState | undefined, dt: number) {
  const protectionFunction = getProtectionFunction(device.params.protectionFunction).value;
  const activeFault = supplied && !device.enabled;
  if (!activeFault) return { protectionFunction, tripped: false, timerElapsed: 0, timerPending: false };
  const delay = Math.max(0, device.params.delaySeconds ?? 0);
  const continued = previous?.protectionFunction === protectionFunction && (previous.tripped || previous.timerPending);
  const timerElapsed = Math.min(delay, (continued ? previous.timerElapsed ?? 0 : 0) + dt);
  const tripped = timerElapsed + 1e-9 >= delay;
  return { protectionFunction, tripped, timerElapsed, timerPending: !tripped };
}
